import { test } from "node:test"
import assert from "node:assert/strict"
import {
  endpointForm, managesWebhook, modeOf, seal, sealKeyFrom, secretName, unseal, webhookPlan, webhookUrl, STRIPE_EVENTS,
  type Endpoint,
} from "../src/lib/stripe-webhook"

const url = "https://shop.example.com/hooks/payment/stripe_stripe"
const ep = (id: string, over: Partial<Endpoint> = {}): Endpoint => ({ id, url, status: "enabled", enabled_events: [...STRIPE_EVENTS], ...over })

test("the webhook's address and which key it belongs to", () => {
  assert.equal(webhookUrl("https://shop.example.com/"), url)
  assert.equal(webhookUrl("https://shop.example.com"), url)
  assert.equal(modeOf("sk_live_abc"), "live")
  assert.equal(modeOf("rk_live_abc"), "live")
  assert.equal(modeOf("sk_test_abc"), "test")
  assert.equal(secretName("sk_live_abc"), "stripe_webhook_live")
  assert.equal(secretName("sk_test_abc"), "stripe_webhook_test")
})

test("the shop keeps one endpoint at its address, whose secret it holds", () => {
  const other = { id: "we_other", url: "https://elsewhere.example.com/hook", status: "enabled", enabled_events: ["*"] }
  const cases: [string, Endpoint[], string | null, ReturnType<typeof webhookPlan>][] = [
    ["none yet: make one", [], null, { keep: null, update: null, remove: [] }],
    ["one made by hand: replace it", [ep("we_hand")], null, { keep: null, update: null, remove: ["we_hand"] }],
    ["its own, as it should be", [ep("we_1"), other], "we_1", { keep: "we_1", update: null, remove: [] }],
    ["its own and a duplicate", [ep("we_1"), ep("we_2")], "we_1", { keep: "we_1", update: null, remove: ["we_2"] }],
    ["its own was deleted in Stripe", [ep("we_2")], "we_1", { keep: null, update: null, remove: ["we_2"] }],
    ["the shop moved address", [ep("we_1", { url: "https://old.example.com/hooks/payment/stripe_stripe" })], "we_1",
      { keep: "we_1", update: { url }, remove: [] }],
    ["missing events", [ep("we_1", { enabled_events: ["payment_intent.succeeded"] })], "we_1",
      { keep: "we_1", update: { enabled_events: [...STRIPE_EVENTS] }, remove: [] }],
    ["every event is enough", [ep("we_1", { enabled_events: ["*"] })], "we_1", { keep: "we_1", update: null, remove: [] }],
    ["disabled in Stripe", [ep("we_1", { status: "disabled" })], "we_1", { keep: "we_1", update: { disabled: false }, remove: [] }],
    ["another app's endpoint is left alone", [other], null, { keep: null, update: null, remove: [] }],
  ]
  for (const [name, endpoints, stored, want] of cases) assert.deepEqual(webhookPlan(endpoints, url, stored), want, name)
})

test("the form Stripe takes", () => {
  assert.equal(endpointForm({ url, enabled_events: ["a.b", "c.d"], description: "Whisk shop" }),
    "url=https%3A%2F%2Fshop.example.com%2Fhooks%2Fpayment%2Fstripe_stripe&enabled_events%5B%5D=a.b&enabled_events%5B%5D=c.d&description=Whisk+shop")
  assert.equal(endpointForm({ disabled: false }), "disabled=false")
})

test("the secret is sealed with the app's own key", () => {
  assert.equal(sealKeyFrom(undefined), null)
  assert.equal(sealKeyFrom(Buffer.alloc(16).toString("base64")), null)
  const key = sealKeyFrom(Buffer.alloc(32, 7).toString("base64"))!
  const sealed = seal(key, { id: "we_1", secret: "whsec_x" })
  assert.ok(!sealed.includes("whsec_x"))
  assert.deepEqual(unseal(key, sealed), { id: "we_1", secret: "whsec_x" })
  const other = sealKeyFrom(Buffer.alloc(32, 8).toString("base64"))!
  const [v, iv, tag, body] = sealed.split(".")
  const shortTag = [v, iv, Buffer.from(tag, "base64").subarray(0, 4).toString("base64"), body].join(".")
  for (const bad of [null, "", "v1.x.y", sealed.replace(/.$/, "A"), shortTag, seal(other, { id: "we_1", secret: "s" })]) assert.equal(unseal(key, bad), null, String(bad))
})

test("the shop makes its endpoint only on a running server that can keep the secret", () => {
  const env = { STRIPE_API_KEY: "sk_test_1", WHISK_PUBLIC_URL: "https://shop.example.com", DATABASE_URL: "postgres://db/app", WHISK_DELIVERY_KEY: Buffer.alloc(32, 7).toString("base64") }
  assert.equal(managesWebhook(env), true)
  assert.equal(managesWebhook(env, true), false)
  assert.equal(managesWebhook({ ...env, SHOP_STEP: "migrate" }), false)
  assert.equal(managesWebhook({ ...env, STRIPE_WEBHOOK_SECRET: "whsec_hand" }), false)
  for (const k of Object.keys(env)) assert.equal(managesWebhook({ ...env, [k]: undefined }), false, k)
})
