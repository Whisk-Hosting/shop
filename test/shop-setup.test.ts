import { test } from "node:test"
import assert from "node:assert/strict"
import { changesFrom, enquiriesTo, openForOrders, ordersTo, setupOf, undeliveredMarkets } from "../src/lib/shop-setup"
import { enquiryView, fieldLabel, replyToOf } from "../src/lib/enquiries"
import { enquiry, orderPlaced } from "../src/lib/emails"

const delivered = { undelivered: [] }
const complete = {
  orders_email: "orders@example.co.nz",
  enquiries_email: "hello@example.co.nz",
  business_name: "Example Ltd",
  bank_account_name: "Example Ltd",
  bank_account_number: "12-3456-7890123-00",
}

test("a new shop is closed, and says what it needs", () => {
  const s = setupOf({}, {}, { undelivered: ["New Zealand"] })
  assert.equal(s.ready, false)
  const needed = s.items.filter((i) => i.required && !i.done).map((i) => i.key)
  assert.deepEqual(needed, ["orders_email", "enquiries_email", "payment", "delivery", "business_name"])
  assert.match(s.items.find((i) => i.key === "delivery")!.fix, /New Zealand/)
  // Every item says how to do it.
  for (const i of s.items) assert.ok(i.fix && i.steps.length > 0, i.key)
  // Stripe is walked through from signing up.
  assert.match(s.items.find((i) => i.key === "payment")!.steps.join(" "), /dashboard\.stripe\.com\/register/)
})

test("a shop opens once every required item is done, whatever is only recommended", () => {
  assert.equal(openForOrders(complete, {}, delivered), true)
  const s = setupOf(complete, {}, delivered)
  assert.deepEqual(s.items.filter((i) => !i.done).map((i) => i.key), ["gst_number", "business_phone", "business_address", "policies", "email_from", "domain"])
  assert.equal(s.items.find((i) => i.key === "policies")!.done, null)
  for (const key of ["orders_email", "enquiries_email", "business_name"] as const) {
    assert.equal(openForOrders({ ...complete, [key]: "" }, {}, delivered), false, key)
  }
  assert.equal(openForOrders(complete, {}, { undelivered: ["Australia"] }), false)
})

test("a card provider's keys or the bank account is a way to be paid", () => {
  const noBank = { ...complete, bank_account_number: "" }
  assert.equal(openForOrders(noBank, {}, delivered), false)
  assert.equal(openForOrders(noBank, { STRIPE_API_KEY: "sk_live_1" }, delivered), true)
  assert.equal(openForOrders(noBank, { WINDCAVE_USERNAME: "u", WINDCAVE_API_KEY: "k" }, delivered), true)
})

test("orders go to the setup's addresses and SHOP_ORDERS_TO's; enquiries to the setup's", () => {
  assert.deepEqual(ordersTo({ orders_email: "A@x.co, b@x.co" }, { SHOP_ORDERS_TO: "b@x.co, c@x.co" }), ["a@x.co", "b@x.co", "c@x.co"])
  assert.equal(setupOf({}, { SHOP_ORDERS_TO: "c@x.co" }, delivered).items[0].done, true)
  assert.deepEqual(enquiriesTo({ enquiries_email: "hello@x.co" }), ["hello@x.co"])
  assert.deepEqual(enquiriesTo({ enquiries_email: 7 }), [])
})

test("the own domain and email are recommended until set", () => {
  const s = setupOf(complete, { WHISK_PUBLIC_URL: "https://shop.example.co.nz", SHOP_EMAIL_FROM: "Shop <orders@example.co.nz>" }, delivered)
  assert.equal(s.items.find((i) => i.key === "domain")!.done, true)
  assert.equal(s.items.find((i) => i.key === "email_from")!.done, true)
  assert.equal(setupOf(complete, { WHISK_PUBLIC_URL: "https://shop--acme.whisk.page" }, delivered).items.find((i) => i.key === "domain")!.done, false)
})

test("a market is delivered to by an option customers can choose in its country", () => {
  const markets = [{ name: "New Zealand", country: "nz" }, { name: "Australia", country: "au" }]
  const nz = { service_zone: { geo_zones: [{ country_code: "nz" }] }, rules: [{ attribute: "enabled_in_store", value: "true" }, { attribute: "is_return", value: "false" }] }
  assert.deepEqual(undeliveredMarkets(markets, []), ["New Zealand", "Australia"])
  assert.deepEqual(undeliveredMarkets(markets, [nz]), ["Australia"])
  const hidden = { ...nz, rules: [{ attribute: "enabled_in_store", value: "false" }] }
  const ret = { ...nz, rules: [{ attribute: "is_return", value: "true" }] }
  assert.deepEqual(undeliveredMarkets(markets, [hidden, ret]), ["New Zealand", "Australia"])
})

test("details to save: an empty one removes it, and every problem is named", () => {
  assert.deepEqual(changesFrom({ orders_email: " a@x.co, b@x.co ", gst_number: "" }), { set: { orders_email: "a@x.co, b@x.co", gst_number: null } })
  const bad = changesFrom({ orders_email: "a@x.co, nope", colour: "red", business_name: 3 })
  assert.ok("problems" in bad)
  if ("problems" in bad) {
    assert.equal(bad.problems.length, 3)
    assert.match(bad.problems.join(" "), /nope is not an email address/)
  }
  assert.ok("problems" in changesFrom([]))
  assert.ok("problems" in changesFrom({ business_address: "x".repeat(301) }))
})

test("an enquiry is shaped for the business, without the form's own fields", () => {
  const fields = { _wpcf7: "1365", "_wpcf7_unit_tag": "x", "your-name": "Ana Smith", "your-email": "ana@example.com", "mobile-number": "021 000", message: "Is it in stock?\nThanks", "product-title": "Airray", "cf-turnstile-response": "t", empty: " " }
  assert.equal(replyToOf(fields), "ana@example.com")
  assert.equal(replyToOf({ message: "a@b.co" }), null)
  assert.equal(fieldLabel("product-enquiry"), "Product enquiry")
  assert.equal(fieldLabel("phoneNumber"), "Phone number")
  const v = enquiryView("product-enquiry", "https://shop.example/products/airray", fields, { name: "Imex", url: "https://shop.example" })
  assert.equal(v.title, "Product enquiry")
  assert.equal(v.from, "Ana Smith")
  assert.deepEqual(v.fields.map((f) => f.label), ["Your name", "Your email", "Mobile number", "Message", "Product title"])
  const mail = enquiry(v)
  assert.equal(mail.subject, "Product enquiry from Ana Smith")
  assert.match(mail.html, /Is it in stock\?<br>Thanks/)
  assert.match(mail.text, /Sent from https:\/\/shop\.example\/products\/airray/)
  assert.equal(enquiryView("contact", null, { message: "hi" }, { name: "S", url: "u" }).from, "the website")
})

test("a confirmation shows the business's details when it has them", () => {
  const order = { shop: "Imex", shopUrl: "https://s", displayId: "#1", email: "c@x.co", currency: "nzd", lines: [], subtotal: 0, shipping: 0, discount: 0, tax: 0, total: 0, taxIncluded: true, paymentMethod: "card" as const }
  assert.doesNotMatch(orderPlaced(order).text, /GST number/)
  const withBusiness = orderPlaced({ ...order, business: { name: "Imex Ltd", gstNumber: "123", phone: "09 1", address: "" } })
  assert.match(withBusiness.text, /Imex Ltd · GST number 123 · 09 1$/)
  assert.match(withBusiness.html, /Imex Ltd · GST number 123 · 09 1/)
})
