import { test } from "node:test"
import assert from "node:assert/strict"
import { anyFilled, CMS, formFields, formName, formReturn, isMedusaPath, limitFor, redirectFor, staticFile, STOREFRONT } from "../src/lib/routes"
import { adminReturn, isStaff, sessionHolds, splitName, personFrom } from "../src/lib/staff"

test("Medusa's paths, the editor's and the storefront's", () => {
  const cases: [string, "medusa" | "cms" | "storefront"][] = [
    ["/store/products", "medusa"], ["/admin", "medusa"], ["/admin/orders", "medusa"], ["/auth/whisk", "medusa"], ["/hooks/windcave", "medusa"], ["/app", "medusa"], ["/app/pages", "medusa"], ["/health", "medusa"], ["/erp-link/v1/orders", "medusa"],
    ["/cms", "cms"], ["/cms/collections/pages", "cms"], ["/cms/api/pages", "cms"], ["/_next/static/chunks/a.js", "cms"],
    ["/", "storefront"], ["/about/", "storefront"], ["/products/beanie", "storefront"], ["/storefront", "storefront"], ["/application", "storefront"], ["/account", "storefront"], ["/healthy", "storefront"], ["/erp-linked", "storefront"], ["/cmsx", "storefront"], ["/_nextgen", "storefront"],
  ]
  for (const [p, owner] of cases) {
    assert.equal(isMedusaPath(p), owner === "medusa", p)
    assert.equal(CMS.test(p), owner === "cms", p)
    assert.equal(STOREFRONT.test(p), owner === "storefront", p)
  }
})

test("a moved website's old addresses answer in one hop", () => {
  const list = [
    { from: "/old", to: "/new" },
    { from: "/gone", status: 410 },
    { from: "/page?id=7", to: "/seven", status: 301 },
    { from: "/page", to: "/pages/" },
    { from: "/temp", to: "/later", status: 302 },
    { from: "/odd", to: "/x", status: 200 },
    { from: "/broken" },
  ]
  const cases: [string, string, ReturnType<typeof redirectFor>][] = [
    ["/old", "", { status: 301, location: "/new" }],
    ["/old", "?utm=1", { status: 301, location: "/new" }],
    ["/gone", "", { status: 410 }],
    ["/page", "?id=7", { status: 301, location: "/seven" }],
    ["/page", "?id=8", { status: 301, location: "/pages/" }],
    ["/temp", "", { status: 302, location: "/later" }],
    ["/odd", "", { status: 301, location: "/x" }],
    ["/broken", "", null],
    ["/new", "", null],
  ]
  for (const [p, q, want] of cases) assert.deepEqual(redirectFor(list, p, q), want, p + q)
  assert.equal(redirectFor([], "/", ""), null)
})

test("forms", () => {
  assert.equal(formName("/forms/contact"), "contact")
  assert.equal(formName("/forms/get-a-quote-2"), "get-a-quote-2")
  for (const p of ["/forms/", "/forms/Contact", "/forms/a/b", "/forms/" + "x".repeat(41), "/form/contact"]) assert.equal(formName(p), null, p)
  assert.deepEqual(formFields("application/x-www-form-urlencoded", "name=Mary&email=mary%40example.com"), { name: "Mary", email: "mary@example.com" })
  assert.deepEqual(formFields("application/json", '{"name":"Mary"}'), { name: "Mary" })
  assert.equal(formFields("application/json", "[1]"), null)
  assert.equal(formFields("application/json", "{"), null)
  assert.equal(anyFilled({ name: " ", altcha: "" }), false)
  assert.equal(anyFilled({}), false)
  assert.equal(anyFilled({ name: "Mary" }), true)
  assert.equal(formReturn("https://example.com/contact?x=1", "contact"), "/contact?x=1&sent=contact")
  assert.equal(formReturn(undefined, "contact"), "/?sent=contact")
  assert.equal(formReturn("https://example.com//evil.com/x", "contact"), "/?sent=contact")
  assert.equal(formReturn("https://evil.com/x", "contact"), "/x?sent=contact")
})

test("password routes are limited, sign-up and reset more tightly", () => {
  assert.deepEqual(limitFor("/auth/customer/emailpass"), { perEmail: 10, perIp: 60 })
  assert.deepEqual(limitFor("/auth/customer/emailpass/register"), { perEmail: 3, perIp: 20 })
  assert.deepEqual(limitFor("/auth/customer/emailpass/reset-password"), { perEmail: 3, perIp: 20 })
})

test("staticFile serves built files and nothing outside them", () => {
  assert.deepEqual(staticFile("/srv/client", "/_astro/shop.a1b2.css"), { file: "/srv/client/_astro/shop.a1b2.css", type: "text/css; charset=utf-8", cache: "public, max-age=31536000, immutable" })
  assert.deepEqual(staticFile("/srv/client/", "/favicon.svg"), { file: "/srv/client/favicon.svg", type: "image/svg+xml", cache: "public, max-age=86400, stale-while-revalidate=604800" })
  assert.equal(staticFile("/srv/client", "/whisk-forms.js")!.cache, "public, max-age=3600, stale-while-revalidate=86400")
  assert.equal(staticFile("/srv/client", "/fonts/a.woff2")!.cache, "public, max-age=86400, stale-while-revalidate=604800")
  const refused = ["/", "/products/beanie", "/../etc/passwd.txt", "/_astro/%2e%2e/x.js", "/.env", "/a/.git/config.json", "/x.php", "/bad%E0%A4%A.js", "/a%00.js"]
  for (const p of refused) assert.equal(staticFile("/srv/client", p), null, p)
})

test("who may run the shop", () => {
  const p = (audience: string, roles: string, id = "u1", email = "a@b.com") => personFrom({ "x-whisk-audience": audience, "x-whisk-roles": roles, "x-whisk-user-id": id, "x-whisk-email": email })
  assert.equal(isStaff(p("team", "owner")), true)
  assert.equal(isStaff(p("team", "member,billing")), true)
  assert.equal(isStaff(p("team", "member,guest")), true)
  assert.equal(isStaff(p("team", "guest")), false)
  assert.equal(isStaff(p("customer", "")), false)
  assert.equal(isStaff(p("anonymous", "")), false)
  assert.equal(isStaff(p("team", "owner", "")), false)
  assert.equal(isStaff(p("team", "owner", "u1", "")), false)
  assert.equal(sessionHolds("u1", p("team", "owner")), true)
  assert.equal(sessionHolds("u2", p("team", "owner")), false)
  assert.equal(sessionHolds("u1", p("anonymous", "")), false)
  assert.equal(sessionHolds(undefined, p("team", "owner")), false)
})

test("the admin sign-in returns only to the admin", () => {
  const cases: [string, string][] = [
    ["/app", "/app"], ["/app/orders", "/app/orders"], ["/app/orders?q=1", "/app/orders?q=1"], ["/app?x", "/app?x"],
    ["", "/app"], ["/", "/app"], ["/application", "/app"], ["//evil.com", "/app"], ["https://evil.com/app", "/app"], ["/app//evil.com", "/app"], ["/app/\\evil", "/app"],
  ]
  for (const [to, want] of cases) assert.equal(adminReturn(to), want, to)
})

test("names split into first and last", () => {
  assert.deepEqual(splitName("Mary Smith"), { first_name: "Mary", last_name: "Smith" })
  assert.deepEqual(splitName("  Mary  Ann  Smith "), { first_name: "Mary", last_name: "Ann Smith" })
  assert.deepEqual(splitName(""), { first_name: "", last_name: "" })
})
