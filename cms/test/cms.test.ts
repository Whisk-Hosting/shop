// The editor's own pure parts (cms/src): page addresses, starting content, settings, sign-in.
import { test } from "node:test"
import assert from "node:assert/strict"
import { pathProblem } from "../src/paths"
import { fileRefs, insideContent, isFileRef, mimeOf, resolved } from "../src/content"
import { platformUploads, poolFrom, secretFrom } from "../src/settings"
import { isStaff, personFrom } from "../src/whisk"

test("a page may have any address but the shop's and the server's", () => {
  for (const p of ["/", "/about", "/about/", "/services/fleet-hire", "/v1.2/notes", "/shopping-guide", "/products-we-love", "/te-reo/kia%20ora"]) assert.equal(pathProblem(p), null, p)
  for (const p of ["about", "", "/a//b", "/a?b=1", "/a#b", "/a b"]) assert.match(pathProblem(p) ?? "", /path only|starts with/, p)
  for (const p of ["/shop", "/products/x", "/Cart", "/checkout/", "/account", "/app", "/cms/x", "/store", "/sitemap.xml", "/robots.txt", "/_astro/a.css", "/forms/contact", "/.whisk/img/1"]) {
    assert.match(pathProblem(p) ?? "", /belongs to the shop/, p)
  }
})

test("starting content names files, which become media", () => {
  const page = {
    path: "/",
    image: { file: "media/og.jpg", alt: "Our shop" },
    layout: [
      { blockType: "hero", heading: "Hi", image: { file: "media/team.jpg", alt: "The team" } },
      { blockType: "columns", items: [{ image: { file: "media/team.jpg", alt: "The team" } }, { image: { file: "media/van.png" } }] },
      { blockType: "content", html: "<p>Words</p>" },
      { blockType: "html", html: "<b>kept</b>" },
    ],
  }
  assert.deepEqual(fileRefs(page).map((r) => r.file), ["media/og.jpg", "media/team.jpg", "media/van.png"])
  assert.equal(isFileRef({ file: "a.jpg", alt: "x", other: 1 }), false)
  const ids = new Map<string, number>([["media/og.jpg", 1], ["media/team.jpg", 2]])
  const out = resolved(page, ids, (html) => ({ root: html })) as any
  assert.equal(out.image, 1)
  assert.equal(out.layout[0].image, 2)
  assert.equal(out.layout[1].items[1].image, null)
  assert.deepEqual(out.layout[2], { blockType: "content", content: { root: "<p>Words</p>" } })
  assert.deepEqual(out.layout[3], { blockType: "html", html: "<b>kept</b>" })
})

test("starting content's files stay inside content/", () => {
  assert.equal(insideContent("/srv/cms/content", "media/a.jpg"), "/srv/cms/content/media/a.jpg")
  assert.equal(insideContent("/srv/cms/content", "../payload.config.ts"), null)
  assert.equal(insideContent("/srv/cms/content", "/etc/passwd"), null)
  assert.equal(mimeOf("a/B.JPG"), "image/jpeg")
  assert.equal(mimeOf("brochure.pdf"), "application/pdf")
  assert.equal(mimeOf("x.bin"), "application/octet-stream")
})

test("the CMS's settings come from the app's environment", () => {
  assert.deepEqual(poolFrom("postgres://u:p@db:5432/app?sslmode=require"), { connectionString: "postgres://u:p@db:5432/app", ssl: { rejectUnauthorized: false } })
  assert.deepEqual(poolFrom("postgres://u:p@db:5432/app?sslmode=verify-full"), { connectionString: "postgres://u:p@db:5432/app", ssl: { rejectUnauthorized: true } })
  assert.deepEqual(poolFrom("postgres://u:p@db:5432/app"), { connectionString: "postgres://u:p@db:5432/app", ssl: false })
  const key = Buffer.alloc(32, 7).toString("base64")
  const a = secretFrom({ WHISK_DELIVERY_KEY: key, NODE_ENV: "production" })
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(secretFrom({ WHISK_DELIVERY_KEY: key }), a)
  assert.equal(secretFrom({ NODE_ENV: "production", SHOP_STEP: "migrate" }), "development-only")
  assert.equal(secretFrom({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }), "development-only")
  assert.throws(() => secretFrom({ NODE_ENV: "production" }), /WHISK_DELIVERY_KEY/)
  assert.equal(platformUploads({ WHISK_SERVICE_TOKEN: "t", WHISK_QUEUE_URL: "https://api/v1/orgs/o/apps/a/events" }), true)
  assert.equal(platformUploads({ WHISK_SERVICE_TOKEN: "t" }), false)
})

test("the business's team may edit the site, a guest or customer may not", () => {
  const h = (o: Record<string, string>) => new Headers(o)
  const team = { "x-whisk-user-id": "u1", "x-whisk-email": "JANE@EXAMPLE.COM", "x-whisk-name": "Jane", "x-whisk-audience": "team", "x-whisk-roles": "owner" }
  assert.deepEqual(personFrom(h(team)), { id: "u1", email: "jane@example.com", name: "Jane", audience: "team", roles: ["owner"] })
  assert.equal(isStaff(personFrom(h(team))), true)
  assert.equal(isStaff(personFrom(h({ ...team, "x-whisk-roles": "guest" }))), false)
  assert.equal(isStaff(personFrom(h({ ...team, "x-whisk-audience": "customer" }))), false)
  assert.equal(isStaff(personFrom(h({}))), false)
})
