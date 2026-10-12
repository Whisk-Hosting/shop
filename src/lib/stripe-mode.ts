// Stripe's live and test modes. STRIPE_API_KEY and STRIPE_PUBLISHABLE_KEY are the shop's keys;
// STRIPE_TEST_API_KEY and STRIPE_TEST_PUBLISHABLE_KEY, beside them, let the business's team switch
// the shop to test mode in the admin (the store's stripe_mode, src/api/admin/whisk/stripe) without
// a deploy. New payments use the mode the shop is in; anything done to a payment afterwards uses
// the mode it was made in, which Stripe records on it (livemode), so switching strands nothing.
// Pure decisions; nothing here reads the process or the network.

export type Env = Record<string, string | undefined>
export type Pair = { secret: string; publishable: string | null }
export type Pairs = { main: Pair | null; test: Pair | null }
export type Which = "main" | "test"

export const pairsFrom = (env: Env): Pairs => {
  const test = env["STRIPE_TEST_API_KEY"] ? { secret: env["STRIPE_TEST_API_KEY"], publishable: env["STRIPE_TEST_PUBLISHABLE_KEY"] || null } : null
  const main = env["STRIPE_API_KEY"] ? { secret: env["STRIPE_API_KEY"], publishable: env["STRIPE_PUBLISHABLE_KEY"] || null } : null
  return main ? { main, test } : { main: test, test: null }
}

// Whether the shop can switch: both pairs set.
export const switchable = (pairs: Pairs): boolean => !!pairs.main && !!pairs.test

// The mode the shop is in, from the store's metadata: test only when asked and possible.
export const modeFrom = (metadata: Record<string, unknown> | null | undefined, pairs: Pairs): Which =>
  switchable(pairs) && metadata?.["stripe_mode"] === "test" ? "test" : "main"

// The pair a payment, customer or event belongs to: Stripe's livemode on it when the shop holds
// keys for both, else the mode the shop is in.
export const pairFor = (livemode: unknown, current: Which, pairs: Pairs): Which => {
  if (!switchable(pairs) || typeof livemode !== "boolean") return current
  return livemode === /^(sk|rk)_live_/.test(pairs.main!.secret) ? "main" : "test"
}

export const livemodeOf = (data: unknown): unknown => (data && typeof data === "object" ? (data as { livemode?: unknown }).livemode : undefined)

// An event's livemode, read before its signature is checked, only to choose which secret checks it.
export const eventLivemode = (raw: unknown): unknown => {
  try {
    return livemodeOf(JSON.parse(typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : ""))
  } catch {
    return undefined
  }
}

// Whether an order was paid in Stripe's test mode: any of its Stripe payments says so.
type OrderPayments = { payment_collections?: { payments?: { provider_id?: string; data?: unknown }[] }[] | null }
export const testOrder = (order: OrderPayments): boolean =>
  (order.payment_collections ?? []).some((c) => (c.payments ?? []).some((p) => p.provider_id === "pp_stripe_stripe" && livemodeOf(p.data) === false))
