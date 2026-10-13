import { test } from "node:test"
import assert from "node:assert/strict"
import { adminOrderUrl, orderView, staffAddresses, type OrderLike } from "../src/lib/orders"
import { newOrder } from "../src/lib/emails"

test("the addresses told of each order", () => {
  const cases: [string | undefined, string[]][] = [
    [undefined, []],
    ["", []],
    ["orders@example.com", ["orders@example.com"]],
    [" Orders@Example.com , ops@example.com;ops@example.com ", ["orders@example.com", "ops@example.com"]],
    ["not an address, sales@example.com", ["sales@example.com"]],
  ]
  for (const [value, want] of cases) assert.deepEqual(staffAddresses(value), want, String(value))
})

test("the order's page in the admin", () => {
  assert.equal(adminOrderUrl("https://shop.example.com/", "order_01"), "https://shop.example.com/app/orders/order_01")
})

test("the business's copy says who ordered, how they paid, and links to the order", () => {
  const order: OrderLike = {
    id: "order_1",
    display_id: 7,
    email: "jane@example.com",
    currency_code: "nzd",
    metadata: { po_number: "<PO-9>" },
    total: 120,
    items: [{ title: "Work Gloves", quantity: 2, total: 110 }],
    shipping_address: { first_name: "Jane", last_name: "Doe", company: "Acme Corp", address_1: "100 Main Street", city: "Springfield" },
    payment_collections: [{ payments: [{ provider_id: "pp_stripe_stripe" }] }],
  }
  const view = orderView(order, { name: "Acme Supply", url: "https://shop.example.com" }, null)
  const m = newOrder({ ...view, adminUrl: adminOrderUrl(view.shopUrl, order.id) })
  assert.equal(m.subject, "New order #7, $120.00")
  assert.match(m.text, /Customer: Jane Doe, Acme Corp, jane@example.com/)
  assert.match(m.text, /Payment: Card/)
  assert.match(m.text, /https:\/\/shop\.example\.com\/app\/orders\/order_1/)
  assert.match(m.html, /href="https:\/\/shop\.example\.com\/app\/orders\/order_1"/)
  assert.match(m.html, /&lt;PO-9&gt;/)
  assert.doesNotMatch(m.html, /<PO-9>/)
})
