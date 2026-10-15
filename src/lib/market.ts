// Where the shop sells: its country, currency, tax and how it writes money and dates. One preset
// per country. A shop sells in one market, chosen by SHOP_COUNTRY (New Zealand when unset), or in
// several, one per domain, listed in SHOP_MARKETS ("nz=example.co.nz, au=example.com.au"): each
// market has its own region, sales channel, stock, delivery and storefront key (src/scripts/
// setup.ts), and a visitor gets the market of the domain they came to, or the first one listed on
// any other address. SHOP_PRICES_INCLUDE_TAX and SHOP_TIME_ZONE adjust every market, and the same
// names ending in the market's key (SHOP_TIME_ZONE_AU) adjust one. Pure, so setup, the
// storefront and the emails agree.

export type Market = {
  readonly key: string // the preset's key: nz, au
  readonly country: string // ISO 3166 alpha-2, lower case
  readonly currency: string // ISO 4217, lower case
  readonly name: string // the region's name
  readonly locale: string
  readonly timeZone: string
  readonly taxRate: number // percent
  readonly taxName: string
  readonly taxInclusive: boolean // prices entered and shown with tax included
  readonly delivery: number // the first standard delivery price, in the currency's main unit
  readonly host: string | null // the domain this market sells on, from SHOP_MARKETS; null for a one-market shop
}

type Preset = Omit<Market, "key" | "host">

export const MARKETS: Readonly<Record<string, Preset>> = {
  nz: { country: "nz", currency: "nzd", name: "New Zealand", locale: "en-NZ", timeZone: "Pacific/Auckland", taxRate: 15, taxName: "GST", taxInclusive: true, delivery: 10 },
  au: { country: "au", currency: "aud", name: "Australia", locale: "en-AU", timeZone: "Australia/Sydney", taxRate: 10, taxName: "GST", taxInclusive: true, delivery: 15 },
}

type Env = Record<string, string | undefined>

// A domain as the shop compares them: lower case, without a port, a last dot or "www.".
export const bareHost = (host: string | null | undefined): string =>
  (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "")

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/


// The setting for one market (SHOP_TIME_ZONE_AU), or for every market (SHOP_TIME_ZONE).
const setting = (env: Env, name: string, key: string) => {
  const own = env[`${name}_${key.toUpperCase()}`]?.trim()
  return own || env[name]?.trim() || ""
}

const adjusted = (env: Env, key: string, base: Preset, host: string | null): Market => {
  const inclusive = setting(env, "SHOP_PRICES_INCLUDE_TAX", key).toLowerCase()
  const timeZone = setting(env, "SHOP_TIME_ZONE", key)
  return {
    key,
    ...base,
    host,
    ...(timeZone ? { timeZone } : {}),
    ...(inclusive === "true" || inclusive === "false" ? { taxInclusive: inclusive === "true" } : {}),
  }
}

// SHOP_MARKETS read: "nz=example.co.nz, au=example.com.au". Throws with every problem found, so one
// deploy shows them all.
const listed = (env: Env, raw: string): Market[] => {
  const entries = raw.split(",").map((e) => e.trim()).filter(Boolean).map((e) => {
    const [key = "", host = ""] = e.split("=").map((s) => s.trim())
    return { key: key.toLowerCase(), host: bareHost(host) }
  })
  const keys = entries.map((e) => e.key)
  const hosts = entries.map((e) => e.host)
  const problems = [
    ...(env.SHOP_COUNTRY?.trim() ? ["set SHOP_MARKETS or SHOP_COUNTRY, not both"] : []),
    ...entries.flatMap((e) => [
      ...(MARKETS[e.key] ? [] : [`"${e.key}" is not a market the shop sells in; use one of ${Object.keys(MARKETS).join(", ")}`]),
      ...(HOST.test(e.host) ? [] : [`${e.key || "a market"} needs its domain, as ${e.key || "nz"}=example.co.nz`]),
    ]),
    ...[...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))].map((k) => `${k} is listed twice`),
    ...[...new Set(hosts.filter((h, i) => h && hosts.indexOf(h) !== i))].map((h) => `${h} is given to two markets`),
    ...(entries.length ? [] : ["list at least one market, as nz=example.co.nz"]),
  ]
  if (problems.length) throw new Error(`SHOP_MARKETS: ${problems.join("; ")}`)
  return entries.map((e) => adjusted(env, e.key, MARKETS[e.key], e.host))
}

// Every market the shop sells in, the first being the one for any address no market names.
export const marketsFrom = (env: Env): Market[] => {
  const raw = env.SHOP_MARKETS?.trim()
  if (raw) return listed(env, raw)
  const key = (env.SHOP_COUNTRY || "nz").trim().toLowerCase()
  const base = MARKETS[key]
  if (!base) throw new Error(`SHOP_COUNTRY "${env.SHOP_COUNTRY}" is not one the shop sells in; use one of ${Object.keys(MARKETS).join(", ")}`)
  return [adjusted(env, key, base, null)]
}

// The shop's first market: the only one of a one-market shop.
export const marketFrom = (env: Env): Market => marketsFrom(env)[0]

// The market a request to this domain is in: the one SHOP_MARKETS gives it, or the first.
export const marketFor = (markets: readonly Market[], host: string | null | undefined): Market => {
  const h = bareHost(host)
  return markets.find((m) => m.host === h) ?? markets[0]
}

// The market a sales channel sells in, from the key setup leaves in its metadata; the first
// market for a channel without one (a one-market shop made before markets were named).
export const marketOfChannel = (markets: readonly Market[], metadata: Record<string, unknown> | null | undefined): Market =>
  markets.find((m) => m.key === metadata?.market) ?? markets[0]

// The address of a market's site: its own domain, or the shop's address for a market without one.
export const marketUrl = (m: Pick<Market, "host">, publicUrl: string): string =>
  m.host ? `https://${m.host}` : publicUrl.replace(/\/$/, "")

// The same page in each of the shop's other markets, for search engines (hreflang). Only markets
// with their own domain have one.
export const alternatesOf = (markets: readonly Market[]): { hreflang: string; origin: string }[] =>
  markets.length > 1 ? markets.filter((m) => m.host).map((m) => ({ hreflang: m.locale, origin: `https://${m.host}` })) : []

// A setting that can be given per market (SHOP_ORDERS_TO_AU) or for the whole shop (SHOP_ORDERS_TO).
export const marketSetting = (env: Env, name: string, m: Pick<Market, "key">): string => setting(env, name, m.key)

// "Includes GST" under a total when prices carry the tax, "GST" when it is added on top.
export const taxLabel = (m: Pick<Market, "taxName" | "taxInclusive">) => (m.taxInclusive ? `Includes ${m.taxName}` : m.taxName)
