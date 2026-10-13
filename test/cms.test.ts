import { test } from "node:test"
import assert from "node:assert/strict"
import { adminSection, editorFor, editPath, editQuery, forwardHeaders, insideAdmin, isEditLink, isEditorPage, restartDelay } from "../src/lib/cms"
import { otherForm, reader } from "../storefront/src/lib/cms"

test("the editor's pages are the team's, its API anyone's", () => {
  for (const p of ["/cms", "/cms/", "/cms/collections/pages", "/cms/globals/menus", "/cms/apis"]) assert.equal(isEditorPage(p), true, p)
  for (const p of ["/cms/api", "/cms/api/pages", "/cmsx", "/_next/static/a.js", "/app/pages"]) assert.equal(isEditorPage(p), false, p)
})

test("opening the editor on its own goes to the admin's section for it", () => {
  const cases: [string, string][] = [
    ["/cms", "pages"], ["/cms/collections/pages/3", "pages"], ["/cms/collections/product-pages", "product-pages"],
    ["/cms/collections/media/create", "media"], ["/cms/globals/menus", "menu"], ["/cms/collections/users", "pages"], ["/cms/account", "pages"],
  ]
  for (const [p, want] of cases) assert.equal(adminSection(p), want, p)
  assert.equal(insideAdmin("/cms/collections/media?page=2"), "/app/media?to=%2Fcms%2Fcollections%2Fmedia%3Fpage%3D2")
})

test("the CMS is started again after a pause that doubles to a minute", () => {
  assert.deepEqual([1, 2, 3, 6, 7, 20].map(restartDelay), [1_000, 2_000, 4_000, 32_000, 60_000, 60_000])
  assert.equal(restartDelay(0), 1_000)
})

test("a request's own headers are passed to the CMS, the connection's are not", () => {
  assert.deepEqual(forwardHeaders({ host: "shop.example.com", connection: "keep-alive", "x-whisk-user-id": "u1", "transfer-encoding": "chunked", te: "trailers", cookie: "a=b", gone: undefined }), {
    host: "shop.example.com",
    "x-whisk-user-id": "u1",
    cookie: "a=b",
  })
})

test("a page is found at either form of its address", () => {
  assert.equal(otherForm("/"), null)
  assert.equal(otherForm("/about"), "/about/")
  assert.equal(otherForm("/about/"), "/about")
})

test("a preview is the team's only", () => {
  const req = (url: string, h: Record<string, string> = {}) => new Request(url, { headers: h })
  const team = { "x-whisk-user-id": "u1", "x-whisk-audience": "team", "x-whisk-roles": "member" }
  assert.equal(reader("http://cms", req("https://shop.example.com/a?preview=1", team)).preview, true)
  assert.equal(reader("http://cms", req("https://shop.example.com/a", team)).preview, false)
  assert.equal(reader("http://cms", req("https://shop.example.com/a?preview=1")).preview, false)
  assert.equal(reader("http://cms", req("https://shop.example.com/a?preview=1", { ...team, "x-whisk-roles": "guest" })).preview, false)
  assert.equal(reader("http://cms", req("https://shop.example.com/a?preview=1", { ...team, "x-whisk-audience": "customer" })).preview, false)
})

test("the Whisk bar's Edit page opens the editor, inside the admin, at what the path shows", () => {
  assert.equal(isEditLink("/cms/edit"), true)
  assert.equal(isEditLink("/cms/edits"), false)
  for (const [search, want] of [["?path=%2Fabout%2F", "/about/"], ["", "/"], ["?path=about", "/"], ["?path=%2F%2Fevil.example", "/"]] as const)
    assert.equal(editPath(search), want, search)

  const wheres = (q: URLSearchParams) => [...q.entries()].filter(([k]) => k.startsWith("where")).map(([k, v]) => `${k}=${v}`)
  const page = editQuery("/about")
  assert.equal(page.collection, "pages")
  assert.deepEqual(wheres(page.query), ["where[or][0][path][equals]=/about", "where[or][1][path][equals]=/about/"])
  assert.equal(page.query.get("draft"), "true")
  const product = editQuery("/products/blue%20mug")
  assert.equal(product.collection, "product-pages")
  assert.deepEqual(wheres(product.query), ["where[handle][equals]=blue mug"])

  assert.equal(editorFor("pages", { id: 7 }), insideAdmin("/cms/collections/pages/7"))
  assert.equal(editorFor("product-pages", { id: "abc" }), insideAdmin("/cms/collections/product-pages/abc"))
  assert.equal(editorFor("pages", null), insideAdmin("/cms/collections/pages"))
  assert.equal(editorFor("product-pages", null), "/app/product-pages?to=%2Fcms%2Fcollections%2Fproduct-pages")
})
