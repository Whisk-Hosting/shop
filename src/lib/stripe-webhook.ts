// The shop's own Stripe webhook, from STRIPE_API_KEY alone. When nobody sets
// STRIPE_WEBHOOK_SECRET, the Stripe provider (src/modules/stripe) makes the endpoint at
// /hooks/payment/stripe_stripe itself, keeps the signing secret Stripe returns sealed in the
// database (shop_secrets), and keeps that one endpoint pointed at the shop's address with the
// events Medusa acts on. These are its pure parts; nothing here reads the process or the network.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto"

// Every payment intent event Medusa's Stripe provider acts on.
export const STRIPE_EVENTS = [
  "payment_intent.amount_capturable_updated",
  "payment_intent.canceled",
  "payment_intent.created",
  "payment_intent.partially_funded",
  "payment_intent.payment_failed",
  "payment_intent.processing",
  "payment_intent.requires_action",
  "payment_intent.succeeded",
] as const

export const webhookUrl = (publicUrl: string): string => `${publicUrl.replace(/\/+$/, "")}/hooks/payment/stripe_stripe`

// A test key and a live key see different endpoints, so each keeps its own.
export const modeOf = (apiKey: string): "live" | "test" => (/^(sk|rk)_live_/.test(apiKey) ? "live" : "test")

export const secretName = (apiKey: string): string => `stripe_webhook_${modeOf(apiKey)}`

export type Endpoint = { id: string; url: string; status: string; enabled_events: string[] }

// What to do with the account's endpoints: keep the one whose secret the shop holds (moved to the
// shop's address and given the events, if it lacks them), or make a new one when it holds none
// that still exists. Any other endpoint at the shop's address is removed: its secret is unknown
// here, so each delivery to it would fail.
export type Plan = {
  keep: string | null
  update: { url?: string; enabled_events?: string[]; disabled?: false } | null
  remove: string[]
}

export const webhookPlan = (endpoints: readonly Endpoint[], url: string, storedId: string | null): Plan => {
  const kept = storedId ? endpoints.find((e) => e.id === storedId) ?? null : null
  const remove = endpoints.filter((e) => e.url === url && e.id !== kept?.id).map((e) => e.id)
  if (!kept) return { keep: null, update: null, remove }
  const missing = STRIPE_EVENTS.some((ev) => !kept.enabled_events.includes(ev) && !kept.enabled_events.includes("*"))
  const update = {
    ...(kept.url !== url ? { url } : {}),
    ...(missing ? { enabled_events: [...STRIPE_EVENTS] } : {}),
    ...(kept.status !== "enabled" ? { disabled: false as const } : {}),
  }
  return { keep: kept.id, update: Object.keys(update).length ? update : null, remove }
}

// The form body Stripe takes for an endpoint's fields.
export const endpointForm = (fields: { url?: string; enabled_events?: readonly string[]; disabled?: boolean; description?: string }): string => {
  const form = new URLSearchParams()
  if (fields.url) form.append("url", fields.url)
  for (const ev of fields.enabled_events ?? []) form.append("enabled_events[]", ev)
  if (fields.disabled !== undefined) form.append("disabled", String(fields.disabled))
  if (fields.description) form.append("description", fields.description)
  return form.toString()
}

// The secret is sealed with a key derived from WHISK_DELIVERY_KEY, the app's own key, under a
// label of its own (src/lib/settings.ts, secretsFrom), so the database alone does not reveal it.
export type Kept = { id: string; secret: string }

export const sealKeyFrom = (deliveryKey: string | undefined): Buffer | null => {
  const key = Buffer.from(deliveryKey ?? "", "base64")
  return key.length < 32 ? null : createHmac("sha256", key).update("whisk-shop:stripe-webhook").digest()
}

export const seal = (key: Buffer, kept: Kept, iv: Buffer = randomBytes(12)): string => {
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 })
  const body = Buffer.concat([c.update(JSON.stringify(kept), "utf8"), c.final()])
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".")
}

export const unseal = (key: Buffer, sealed: string | null | undefined): Kept | null => {
  const [v, iv, tag, body] = (sealed ?? "").split(".")
  if (v !== "v1" || !iv || !tag || !body) return null
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"), { authTagLength: 16 })
    d.setAuthTag(Buffer.from(tag, "base64"))
    const kept = JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8"))
    return typeof kept?.id === "string" && typeof kept?.secret === "string" ? { id: kept.id, secret: kept.secret } : null
  } catch {
    return null
  }
}

// Whether the shop makes its own endpoint: only a running server with an address to point it at
// and its own key to seal the secret with, and only when nobody set the secret by hand.
export const managesWebhook = (env: Record<string, string | undefined>, building = false): boolean =>
  !building && !env.SHOP_STEP && !!env.STRIPE_API_KEY && !env.STRIPE_WEBHOOK_SECRET && !!env.WHISK_PUBLIC_URL &&
  !!env.DATABASE_URL && !!sealKeyFrom(env.WHISK_DELIVERY_KEY)
