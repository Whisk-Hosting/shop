import { test } from "node:test"
import assert from "node:assert/strict"
import { shopAddress } from "../src/lib/routes"
import { absoluteUrl, breadcrumbLd, canonicalUrl, firstPicture, productLd, shareImage, siteLd, withTax } from "../storefront/src/lib/seo"

test("each shop page has one address", () => {
  const cases: [string, string | null][] = [
    ["/shop", "/products"],
    ["/shop/", "/products"],
    ["/products/", "/products"],
    ["/products", null],
    ["/products/work-gloves/", "/products/work-gloves"],
    ["/products/work-gloves//", "/products/work-gloves"],
    ["/categories/gloves/", "/categories/gloves"],
    ["/categories/tools/gloves/", "/categories/tools/gloves"],
    ["/collections/new/", "/collections/new"],
    ["/cart/", "/cart"],
    ["/account/orders/", "/account/orders"],
    ["/", null],
    ["/about-us/", null],
    ["/products-guide/", null],
    ["//products/", null],
    ["/products//evil.example/", null],
  ]
  for (const [path, want] of cases) assert.equal(shopAddress(path), want, path)
})

test("a page's address for search engines keeps only its page number", () => {
  assert.equal(canonicalUrl(new URL("https://shop.example.com/products?page=2&q=x")), "https://shop.example.com/products?page=2")
  assert.equal(canonicalUrl(new URL("https://shop.example.com/products?page=1")), "https://shop.example.com/products")
  assert.equal(canonicalUrl(new URL("https://shop.example.com/products?page=abc")), "https://shop.example.com/products")
  assert.equal(canonicalUrl(new URL("https://shop.example.com/products/gloves?option_1=red")), "https://shop.example.com/products/gloves")
})

test("pictures beside links are whole addresses, stored ones as 1200 px JPEGs", () => {
  const o = "https://shop.example.com"
  assert.equal(absoluteUrl(o, "/catalogue/a.jpg"), "https://shop.example.com/catalogue/a.jpg")
  assert.equal(absoluteUrl(o, "https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg")
  assert.equal(absoluteUrl(o, null), null)
  assert.equal(shareImage(o, "/.whisk/img/01J?w=300&format=auto"), "https://shop.example.com/.whisk/img/01J?w=1200&format=jpeg")
  assert.equal(shareImage(o, "https://shop.example.com/.whisk/img/01J"), "https://shop.example.com/.whisk/img/01J?w=1200&format=jpeg")
  assert.equal(shareImage(o, "https://acme.whisk.page/.whisk/img/01J"), "https://shop.example.com/.whisk/img/01J?w=1200&format=jpeg")
  assert.equal(shareImage(o, undefined), null)
})

test("prices for search engines include the tax", () => {
  assert.equal(withTax(100, { taxRate: 10, taxInclusive: false }), 110)
  assert.equal(withTax(19.99, { taxRate: 15, taxInclusive: false }), 22.99)
  assert.equal(withTax(110, { taxRate: 10, taxInclusive: true }), 110)
})

test("a product's structured data", () => {
  const p = {
    title: "Work Gloves",
    handle: "work-gloves",
    description: "Tough gloves.",
    metadata: { brand: "Acme" },
    images: [{ url: "/.whisk/img/01J" }, { url: "/catalogue/b.jpg" }],
    variants: [
      { sku: "G-S", manage_inventory: true, inventory_quantity: 0, calculated_price: { calculated_amount: 100, currency_code: "aud" } },
      { sku: "G-L", manage_inventory: false, calculated_price: { calculated_amount: 120, currency_code: "aud" } },
      { sku: "G-X" },
    ],
  }
  const ld = productLd(p, { origin: "https://shop.example.com", shop: "Acme Supply", market: { taxRate: 10, taxInclusive: false }, sku: "G-S" })
  assert.equal(ld.url, "https://shop.example.com/products/work-gloves")
  assert.deepEqual(ld.brand, { "@type": "Brand", name: "Acme" })
  assert.deepEqual(ld.image, ["https://shop.example.com/.whisk/img/01J?w=1200&format=jpeg", "https://shop.example.com/catalogue/b.jpg"])
  assert.deepEqual(ld.offers.map((o) => [o.price, o.priceCurrency, o.availability, o.url]), [
    [110, "AUD", "https://schema.org/OutOfStock", "https://shop.example.com/products/work-gloves"],
    [132, "AUD", "https://schema.org/InStock", "https://shop.example.com/products/work-gloves"],
  ])
  const plain = productLd({ title: "Cap", handle: "cap", metadata: null, thumbnail: null }, { origin: "https://shop.example.com", shop: "Acme Supply", market: { taxRate: 15, taxInclusive: true } })
  assert.deepEqual(plain.brand, { "@type": "Brand", name: "Acme Supply" })
  assert.equal(plain.image, undefined)
  assert.deepEqual(plain.offers, [])
})

test("the business, the site and the trail to a page", () => {
  const [org, site] = siteLd("https://shop.example.com", "Acme Supply")
  assert.equal(org["@type"], "Organization")
  assert.equal(site.url, "https://shop.example.com/")
  const trail = breadcrumbLd("https://shop.example.com", [{ name: "Acme Supply", path: "/" }, { name: "Gloves", path: "/categories/gloves" }])
  assert.deepEqual(trail.itemListElement[1], { "@type": "ListItem", position: 2, name: "Gloves", item: "https://shop.example.com/categories/gloves" })
})

test("the first picture on a page, for a page that names none", () => {
  const layout = [
    { blockType: "content", text: "Hello" },
    { blockType: "media", image: { url: "/.whisk/media/V", mimeType: "video/mp4" } },
    { blockType: "columns", items: [{ heading: "One" }, { image: { url: "/.whisk/img/COL", mimeType: "image/png" } }] },
    { blockType: "hero", image: { url: "/.whisk/img/HERO" } },
  ]
  assert.equal(firstPicture(layout), "/.whisk/img/COL")
  assert.equal(firstPicture([{ blockType: "hero", image: 12 }]), null)
  assert.equal(firstPicture(null), null)
})
