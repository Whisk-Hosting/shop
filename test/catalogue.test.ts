import { test } from "node:test"
import assert from "node:assert/strict"
import { catalogueFrom, categoriesToAdd, categoryHandle, categoryTreeFrom, handleOf, imageType, marketsOf, priceIn, productInput, productsToAdd, variantsOf } from "../src/lib/catalogue"

const goggles = { handle: "goggles", title: "Goggles", price: 325, sku: "G", categories: ["Impairment Goggles"], options: [{ title: "Type", values: ["Low", "High"] }], images: ["goggles-1.jpg"] }
const tester = { handle: "tester", title: "Tester", price: 1058, sku: "T", inStock: false, categories: ["Workplace Breathalyser"] }

test("catalogueFrom", () => {
  assert.deepEqual(catalogueFrom({ products: [goggles] }), [goggles])
  const bad: [unknown, RegExp][] = [
    [{}, /needs a products list/],
    [{ products: [{ handle: "Bad Handle", title: "x", price: 1 }] }, /handle must be/],
    [{ products: [{ handle: "a", title: "", price: 1 }] }, /title is missing/],
    [{ products: [{ handle: "a", title: "A", price: "1" }] }, /price must be/],
    [{ products: [{ handle: "a", title: "A", price: 1, options: [{ title: "T", values: [] }] }] }, /needs a title and values/],
    [{ products: [goggles, goggles] }, /goggles is used twice/],
    [{ products: [{ handle: "a", title: "A", price: 1, markets: ["us"] }] }, /markets must list/],
    [{ products: [{ handle: "a", title: "A", price: 1, markets: [] }] }, /markets must list/],
    [{ products: [{ handle: "a", title: "A", price: { nz: 1 } }] }, /no price for au/],
    [{ products: [{ handle: "a", title: "A", price: { nz: -1 } }] }, /price must be/],
  ]
  for (const [json, want] of bad) assert.throws(() => catalogueFrom(json), want)
  // One market's product needs only that market's price; a one-market shop knows only its own.
  assert.doesNotThrow(() => catalogueFrom({ products: [{ handle: "a", title: "A", price: { au: 1 }, markets: ["au"] }] }))
  assert.throws(() => catalogueFrom({ products: [{ handle: "a", title: "A", price: 1, markets: ["au"] }] }, ["nz"]), /markets must list markets the shop sells in \(nz\)/)
})

test("marketsOf and priceIn", () => {
  assert.deepEqual(marketsOf({}, ["nz", "au"]), ["nz", "au"])
  assert.deepEqual(marketsOf({ markets: ["au"] }, ["nz", "au"]), ["au"])
  assert.equal(priceIn({ price: 5 }, "au"), 5)
  assert.equal(priceIn({ price: { nz: 5, au: 4 } }, "au"), 4)
})

test("handleOf", () => {
  const cases: [string, string][] = [["Impairment Goggles", "impairment-goggles"], ["Wallmount Breathalyser – Passive Only", "wallmount-breathalyser-passive-only"], ["Workplace Passive/Active Breathalyser", "workplace-passive-active-breathalyser"]]
  for (const [name, want] of cases) assert.equal(handleOf(name), want)
})

test("productsToAdd and categoriesToAdd", () => {
  assert.deepEqual(productsToAdd([goggles, tester], ["goggles"]).map((p) => p.handle), ["tester"])
  assert.deepEqual(categoriesToAdd([goggles, tester, goggles], ["impairment-goggles"]), [{ handle: "workplace-breathalyser", name: "Workplace Breathalyser" }])
  // The list's categories come parents first, whatever order the file gives them in.
  const tree = [
    { handle: "arthroscopy", name: "Arthroscopy", parent: "endoscopy" },
    { handle: "endoscopy", name: "Endoscopy", parent: "veterinary" },
    { handle: "veterinary", name: "Veterinary" },
  ]
  const p = { handle: "scope", title: "Scope", categories: ["arthroscopy", "Spare Parts"] }
  assert.deepEqual(categoriesToAdd([p], [], tree).map((c) => c.handle), ["veterinary", "spare-parts", "endoscopy", "arthroscopy"])
  assert.deepEqual(categoriesToAdd([p], ["veterinary", "spare-parts"], tree).map((c) => c.handle), ["endoscopy", "arthroscopy"])
})

test("categoryTreeFrom and categoryHandle", () => {
  const tree = [{ handle: "human", name: "Human" }, { handle: "accessories-2", name: "Accessories", parent: "human" }]
  assert.deepEqual(categoryTreeFrom({ products: [] }), [])
  assert.deepEqual(categoryTreeFrom({ categories: tree }), tree)
  const bad: [unknown, RegExp][] = [
    [{ categories: {} }, /must be a list/],
    [{ categories: [{ handle: "A b", name: "A" }] }, /handle must be/],
    [{ categories: [{ handle: "a", name: " " }] }, /name is missing/],
    [{ categories: [{ handle: "a", name: "A", parent: "b" }] }, /parent b is not in the list/],
    [{ categories: [{ handle: "a", name: "A", parent: "b" }, { handle: "b", name: "B", parent: "a" }] }, /a is inside itself/],
    [{ categories: [{ handle: "a", name: "A" }, { handle: "a", name: "A" }] }, /a is listed twice/],
  ]
  for (const [json, want] of bad) assert.throws(() => categoryTreeFrom(json), want)
  assert.equal(categoryHandle("accessories-2", tree), "accessories-2")
  assert.equal(categoryHandle("Spare Parts", tree), "spare-parts")
})

test("a product with no price, and its metadata", () => {
  const enquiry = { handle: "scope", title: "Scope", metadata: { features: "<p>Bright</p>" } }
  assert.deepEqual(catalogueFrom({ products: [enquiry] }), [enquiry])
  assert.throws(() => catalogueFrom({ products: [{ ...enquiry, metadata: [] }] }), /metadata must be an object/)
  const ctx = { markets: [{ key: "nz", currency: "nzd", channelId: "sc_1" }], profileId: "sp_1", categoryIds: {}, imageUrls: {} }
  const got = productInput(enquiry, ctx)
  assert.deepEqual(got.variants[0].prices, [])
  assert.deepEqual(got.metadata, { features: "<p>Bright</p>" })
  assert.equal(priceIn({ price: null }, "nz"), undefined)
})

test("variantsOf", () => {
  const cases: [any, { options: string[]; variants: [string, string | undefined][] }][] = [
    [goggles, { options: ["Type"], variants: [["Low", "G-1"], ["High", "G-2"]] }],
    [tester, { options: ["Default"], variants: [["Tester", "T"]] }],
    [{ handle: "x", title: "X", price: 1 }, { options: ["Default"], variants: [["X", undefined]] }],
  ]
  for (const [p, want] of cases) {
    const got = variantsOf(p)
    assert.deepEqual(got.options.map((o) => o.title), want.options)
    assert.deepEqual(got.variants.map((v) => [v.title, v.sku]), want.variants)
  }
})

test("productInput", () => {
  const ctx = { markets: [{ key: "au", currency: "aud", channelId: "sc_1" }], profileId: "sp_1", categoryIds: { "impairment-goggles": "pcat_1" }, imageUrls: { "goggles-1.jpg": "https://shop/.whisk/img/1" } }
  const g = productInput(goggles, ctx)
  assert.equal(g.thumbnail, "https://shop/.whisk/img/1")
  assert.deepEqual(g.category_ids, ["pcat_1"])
  assert.deepEqual(g.variants[0].prices, [{ currency_code: "aud", amount: 325 }])
  assert.equal(g.variants[0].manage_inventory, false)
  const t = productInput(tester, ctx)
  assert.equal(t.thumbnail, undefined)
  assert.deepEqual(t.category_ids, [])
  assert.equal(t.variants[0].manage_inventory, true)
  // Two markets: a price and a sales channel in each the product is sold in.
  const two = { ...ctx, markets: [{ key: "nz", currency: "nzd", channelId: "sc_nz" }, { key: "au", currency: "aud", channelId: "sc_au" }] }
  const both = productInput({ ...tester, price: { nz: 20, au: 18 } }, two)
  assert.deepEqual(both.variants[0].prices, [{ currency_code: "nzd", amount: 20 }, { currency_code: "aud", amount: 18 }])
  assert.deepEqual(both.sales_channels, [{ id: "sc_nz" }, { id: "sc_au" }])
  const au = productInput({ ...tester, markets: ["au"] }, two)
  assert.deepEqual(au.variants[0].prices, [{ currency_code: "aud", amount: 1058 }])
  assert.deepEqual(au.sales_channels, [{ id: "sc_au" }])
})

test("imageType", () => {
  assert.equal(imageType("a.JPG"), "image/jpeg")
  assert.equal(imageType("a.png"), "image/png")
  assert.equal(imageType("a.txt"), undefined)
})
