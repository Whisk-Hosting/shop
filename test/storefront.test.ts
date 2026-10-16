import { test } from "node:test"
import assert from "node:assert/strict"
import { addressFrom, fromPrice, lineAmount, money, picture, robotsTxt, safeReturn, sitemap, sums, variantFor, variantLabel } from "../storefront/src/lib/format"
import { mergedCookies, query } from "../storefront/src/lib/medusa"
import { passwordProblem, registerProblem } from "../storefront/src/lib/account"
import { forSite } from "../storefront/src/lib/cms"

test("money and pictures", () => {
  assert.equal(money(45, "nzd"), "$45.00")
  assert.equal(money(null, "nzd"), "")
  const img = "/.whisk/img/01J"
  assert.deepEqual(picture(`https://k.whisk.page${img}?w=1`, 300), {
    src: `${img}?w=300&format=auto`,
    srcset: [160, 300, 320, 480, 600].map((w) => `${img}?w=${w}&format=auto ${w}w`).join(", "),
    sizes: "300px",
  })
  assert.equal(picture(img, 72)!.srcset, `${img}?w=72&format=auto 72w, ${img}?w=144&format=auto 144w`)
  assert.deepEqual(picture("https://elsewhere/a.png", 300), { src: "https://elsewhere/a.png" })
  assert.equal(picture(null, 300), null)
})

test("fromPrice is the lowest price, and says when it is a sale or varies", () => {
  const p = (calculated: number, original = calculated) => ({ calculated_price: { calculated_amount: calculated, original_amount: original, currency_code: "nzd" } })
  assert.equal(fromPrice([]), null)
  assert.deepEqual(fromPrice([p(45)]), { amount: 45, original: 45, currency: "nzd", sale: false, varies: false })
  assert.deepEqual(fromPrice([p(50), p(40, 45)]), { amount: 40, original: 45, currency: "nzd", sale: true, varies: true })
})

test("variantFor matches every option chosen", () => {
  const vs = [
    { id: "a", options: [{ option_id: "colour", value: "Red" }, { option_id: "size", value: "S" }] },
    { id: "b", options: [{ option_id: "colour", value: "Red" }, { option_id: "size", value: "M" }] },
  ]
  assert.equal(variantFor(vs, { colour: "Red", size: "M" })?.id, "b")
  assert.equal(variantFor(vs, { colour: "Blue" }), null)
  assert.equal(variantFor(vs, {})?.id, "a")
})

test("addressFrom reads a form or names what is missing", () => {
  const form = new FormData()
  for (const [k, v] of Object.entries({ first_name: " Jane ", last_name: "Doe", address_1: "100 Main Street", city: "Springfield", postal_code: "1010" })) form.set(k, v)
  assert.deepEqual(addressFrom(form), { address: { first_name: "Jane", last_name: "Doe", company: undefined, address_1: "100 Main Street", address_2: undefined, city: "Springfield", postal_code: "1010", province: undefined, country_code: "nz", phone: undefined } })
  form.delete("city")
  assert.deepEqual(addressFrom(form), { missing: ["city"] })
})

test("forms send people back only to this shop", () => {
  const cases: [string | null, string][] = [["/checkout", "/checkout"], ["/account?x=1", "/account?x=1"], ["//evil.com", "/"], ["https://evil.com", "/"], ["", "/"], [null, "/"]]
  for (const [to, want] of cases) assert.equal(safeReturn(to), want, String(to))
})

test("cookies the API sets in a request are laid over the browser's", () => {
  assert.equal(mergedCookies("a=1; shop_cart=c1", ["shop_session=s2; Path=/; HttpOnly"]), "a=1; shop_cart=c1; shop_session=s2")
  assert.equal(mergedCookies("shop_session=old; a=1", ["shop_session=new; Path=/"]), "shop_session=new; a=1")
  assert.equal(mergedCookies("shop_session=old; a=1", ["shop_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]), "a=1")
  assert.equal(mergedCookies("", []), "")
})

test("query leaves out empty values and repeats lists", () => {
  assert.equal(query({ a: 1, b: "", c: undefined, d: null, id: ["x", "y"] }), "?a=1&id=x&id=y")
  assert.equal(query({}), "")
})

test("passwords and new accounts", () => {
  assert.match(passwordProblem("short") ?? "", /10 characters/)
  assert.equal(passwordProblem("long enough pass"), null)
  assert.equal(registerProblem({ email: "jane@example.com", password: "long enough pass", first_name: "Jane", last_name: "Doe" }), null)
  assert.match(registerProblem({ email: "nope", password: "long enough pass", first_name: "K", last_name: "T" }) ?? "", /email/)
  assert.match(registerProblem({ email: "k@e.com", password: "long enough pass", first_name: "", last_name: "T" }) ?? "", /name/)
})

test("the sitemap lists each page with its date, escaped", () => {
  const xml = sitemap("https://k.whisk.page", [{ path: "/" }, { path: "/products/a&b", updated: "2026-10-09T00:00:00Z" }])
  assert.match(xml, /<loc>https:\/\/k\.whisk\.page\/<\/loc>/)
  assert.match(xml, /<loc>https:\/\/k\.whisk\.page\/products\/a&amp;b<\/loc><lastmod>2026-10-09T00:00:00.000Z<\/lastmod>/)
})

test("robots.txt keeps the website's lines first, then the shop's", () => {
  const shop = "User-agent: *\nAllow: /.whisk/\nAllow: /cms/api/media/file/\nDisallow: /cart$\nDisallow: /cart/\nDisallow: /checkout$\nDisallow: /checkout/\nDisallow: /account$\nDisallow: /account/\nDisallow: /order/\nDisallow: /app\nDisallow: /cms\n\nSitemap: https://shop.example.com/sitemap.xml\n"
  assert.equal(robotsTxt("https://shop.example.com", undefined), shop)
  assert.equal(robotsTxt("https://shop.example.com", "  \n"), shop)
  assert.equal(robotsTxt("https://shop.example.com", "User-agent: *\nDisallow: /wp-admin/\n\n"), "User-agent: *\nDisallow: /wp-admin/\n\n# The shop\n" + shop)
  // The old site's sitemap line goes: the shop names its own.
  assert.equal(robotsTxt("https://shop.example.com", "User-agent: *\nAllow: /\nSitemap: https://old.example.com/sitemap_index.xml"), "User-agent: *\nAllow: /\n\n# The shop\n" + shop)
})

test("sums and lineAmount follow whether prices include the tax", () => {
  const o = { item_total: 1163.8, item_subtotal: 1058, shipping_total: 16.5, shipping_subtotal: 15, tax_total: 107.3, total: 1180.3 }
  assert.deepEqual(sums(o, true), { subtotal: 1163.8, shipping: 16.5, discount: 0, tax: 107.3, total: 1180.3 })
  assert.deepEqual(sums(o, false), { subtotal: 1058, shipping: 15, discount: 0, tax: 107.3, total: 1180.3 })
  assert.equal(lineAmount({ total: 1163.8, subtotal: 1058 }, true), 1163.8)
  assert.equal(lineAmount({ total: 1163.8, subtotal: 1058 }, false), 1058)
  assert.equal(lineAmount({ total: 10 }, false), 10)
})

test("a cart line names its variant only when it adds something", () => {
  assert.equal(variantLabel({ product_title: "LT7", variant_title: "LT7" }), null)
  assert.equal(variantLabel({ title: "Mug", variant_title: "Default variant" }), null)
  assert.equal(variantLabel({ product_title: "Goggles", variant_title: "Low" }), "Low")
  assert.equal(variantLabel({ product_title: "Goggles", variant_title: null }), null)
})

test("forSite", () => {
  const docs = [{ path: "/delivery", market: "au" }, { path: "/delivery", market: null }]
  assert.equal(forSite(docs, "au")?.market, "au")
  assert.equal(forSite(docs, "nz")?.market, null)
  assert.equal(forSite([{ path: "/x", market: "au" }], "nz"), null)
  assert.equal(forSite([{ path: "/x", market: "au" }], null), null)
})
