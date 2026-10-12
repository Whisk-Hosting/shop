// The Stripe publishable key for a payment: the one of the mode it was made in (Stripe's livemode
// on it), since the shop can switch between live and test (src/lib/stripe-mode.ts).
export const publishableFor = (livemode: unknown, keys: readonly (string | null)[]): string | null => {
  const set = keys.filter((k): k is string => !!k)
  const want = livemode === true ? "pk_live_" : livemode === false ? "pk_test_" : null
  return (want && set.find((k) => k.startsWith(want))) || set[0] || null
}
