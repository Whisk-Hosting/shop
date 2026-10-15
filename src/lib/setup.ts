// Pure decisions for src/scripts/setup.ts.

// The store's name: Medusa names a new store "Medusa Store"; a shop starts with its app's name
// in words ("acme-tools" is "Acme Tools"). A name staff have set is kept.
export const storeName = (current: string | null | undefined, appName: string | undefined): string => {
  if (current && current !== "Medusa Store") return current
  if (!appName) return current || "Shop"
  return appName.split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
}

// Providers to add to the region: those configured that it does not take yet. One staff have
// added is kept, and one whose keys were removed stays listed (Medusa skips a provider it has
// not loaded) so putting the keys back needs nothing else.
export const missingProviders = (have: string[], wanted: string[]): string[] => wanted.filter((p) => !have.includes(p))

type Channel = { id: string; metadata?: Record<string, unknown> | null }

// The sales channel each market sells through: the one whose metadata names the market, or, for
// the market the shop first sold in (its store's default currency), the store's default channel
// from before markets were named. A market without one gets a new channel; null says so.
export const channelFor = (
  market: { key: string; currency: string },
  channels: readonly Channel[],
  defaults: { channelId: string | null | undefined; currency: string | null | undefined; first: boolean },
): { id: string; tag: boolean } | null => {
  const named = channels.find((c) => c.metadata?.market === market.key)
  if (named) return { id: named.id, tag: false }
  const original = channels.find((c) => c.id === defaults.channelId && !c.metadata?.market)
  const isOriginal = defaults.currency ? defaults.currency === market.currency : defaults.first
  return original && isOriginal ? { id: original.id, tag: true } : null
}

// The first linked record of each kind for a channel: its storefront key, its stock location.
export const linkedTo = <T extends { id: string; sales_channels?: { id: string }[] | null }>(rows: readonly T[], channelId: string): T | undefined =>
  rows.find((r) => (r.sales_channels ?? []).some((c) => c.id === channelId))
