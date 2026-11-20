import assert from "node:assert/strict"
import { test } from "node:test"
import { fixes } from "./admin-fixes.mjs"

const list = (zone) => `return jsx3(
    LayoutComposer,
    {
      widgetsZonePrefix: "${zone}",
      preferredLayoutId: CORE_LAYOUT_IDS.SINGLE_COLUMN,`

test("the product and promotion lists draw their drawers once", () => {
  for (const [zone, file] of [["product.list", "product-list-22CKIVMD.mjs"], ["promotion.list", "promotion-list-KU5UYTBL.mjs"]]) {
    const fixed = fixes(list(zone), `/app/node_modules/@medusajs/dashboard/dist/${file}`)
    assert.match(fixed, new RegExp(`widgetsZonePrefix: "${zone.replace(".", "\\.")}",\\n\\s+hasOutlet: false,`))
  }
})

test("other files are left as they are", () => {
  assert.equal(fixes(list("customer.list"), "/app/node_modules/@medusajs/dashboard/dist/customer-list-X.mjs"), null)
  assert.equal(fixes(list("product.list"), "/app/src/admin/routes/products/page.tsx"), null)
  assert.equal(fixes("export const x = 1", "/app/node_modules/@medusajs/dashboard/dist/product-list-X.mjs"), null)
})

test("a newer dashboard that changed the list is named", () => {
  assert.throws(() => fixes(`widgetsZonePrefix: "product.list",`, "/n/@medusajs/dashboard/dist/product-list-Y.mjs"), /drop the fix/)
})
