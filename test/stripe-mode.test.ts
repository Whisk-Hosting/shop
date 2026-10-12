import { test } from "node:test"
import assert from "node:assert/strict"
import { eventLivemode, modeFrom, pairFor, pairsFrom, switchable, testOrder } from "../src/lib/stripe-mode"
import { publishableFor } from "../storefront/src/lib/stripe"

const both = pairsFrom({ STRIPE_API_KEY: "sk_live_1", STRIPE_PUBLISHABLE_KEY: "pk_live_1", STRIPE_TEST_API_KEY: "sk_test_1", STRIPE_TEST_PUBLISHABLE_KEY: "pk_test_1" })
const liveOnly = pairsFrom({ STRIPE_API_KEY: "sk_live_1", STRIPE_PUBLISHABLE_KEY: "pk_live_1" })
const testOnly = pairsFrom({ STRIPE_TEST_API_KEY: "sk_test_1", STRIPE_TEST_PUBLISHABLE_KEY: "pk_test_1" })

test("the keys a shop has", () => {
  assert.deepEqual(both, { main: { secret: "sk_live_1", publishable: "pk_live_1" }, test: { secret: "sk_test_1", publishable: "pk_test_1" } })
  assert.deepEqual(liveOnly, { main: { secret: "sk_live_1", publishable: "pk_live_1" }, test: null })
  assert.deepEqual(testOnly, { main: { secret: "sk_test_1", publishable: "pk_test_1" }, test: null })
  assert.deepEqual(pairsFrom({}), { main: null, test: null })
  assert.equal(switchable(both), true)
  assert.equal(switchable(liveOnly), false)
  assert.equal(switchable(testOnly), false)
})

test("the shop is in test mode only when asked and it has test keys", () => {
  const cases: [Record<string, unknown> | null, typeof both, "main" | "test"][] = [
    [null, both, "main"], [{}, both, "main"], [{ stripe_mode: "live" }, both, "main"], [{ stripe_mode: "test" }, both, "test"],
    [{ stripe_mode: "TEST" }, both, "main"], [{ stripe_mode: "test" }, liveOnly, "main"], [{ stripe_mode: "test" }, testOnly, "main"],
  ]
  for (const [meta, pairs, want] of cases) assert.equal(modeFrom(meta, pairs), want, JSON.stringify(meta))
})

test("a payment stays with the mode it was made in", () => {
  const cases: [unknown, "main" | "test", typeof both, "main" | "test"][] = [
    [true, "test", both, "main"], [false, "main", both, "test"], [true, "main", both, "main"], [false, "test", both, "test"],
    [undefined, "test", both, "test"], ["yes", "main", both, "main"],
    [false, "main", liveOnly, "main"], [true, "main", testOnly, "main"],
  ]
  for (const [livemode, current, pairs, want] of cases) assert.equal(pairFor(livemode, current, pairs), want, `${livemode} ${current}`)
  const testMain = pairsFrom({ STRIPE_API_KEY: "sk_test_a", STRIPE_TEST_API_KEY: "sk_test_b" })
  assert.equal(pairFor(false, "test", testMain), "main")
})

test("an event's mode, read only to choose its secret", () => {
  assert.equal(eventLivemode('{"livemode":false}'), false)
  assert.equal(eventLivemode(Buffer.from('{"livemode":true}')), true)
  for (const raw of ["", "{", "[]", null, 7]) assert.equal(eventLivemode(raw), undefined, String(raw))
})

test("the storefront shows the publishable key of the payment's mode", () => {
  assert.equal(publishableFor(false, ["pk_live_1", "pk_test_1"]), "pk_test_1")
  assert.equal(publishableFor(true, ["pk_live_1", "pk_test_1"]), "pk_live_1")
  assert.equal(publishableFor(undefined, ["pk_live_1", "pk_test_1"]), "pk_live_1")
  assert.equal(publishableFor(true, [null, "pk_test_1"]), "pk_test_1")
  assert.equal(publishableFor(false, [null, null]), null)
})

test("an order paid in test mode is marked", () => {
  const pay = (provider_id: string, data: unknown) => ({ payment_collections: [{ payments: [{ provider_id, data }] }] })
  assert.equal(testOrder(pay("pp_stripe_stripe", { livemode: false })), true)
  assert.equal(testOrder(pay("pp_stripe_stripe", { livemode: true })), false)
  assert.equal(testOrder(pay("pp_stripe_stripe", {})), false)
  assert.equal(testOrder(pay("pp_system_default", { livemode: false })), false)
  assert.equal(testOrder({ payment_collections: null }), false)
  assert.equal(testOrder({}), false)
})
