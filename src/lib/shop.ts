// The shop's name and address, as its emails and pages show them.
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { bankAccountOf, type BankAccount } from "./orders"
import { browserKeysFrom } from "./settings"
import { alternatesOf, marketFor, marketOfChannel, marketsFrom, marketUrl, type Market } from "./market"
import { linkedTo } from "./setup"
import { cmsAddress } from "./cms"

let cached: { name: string; channels: { id: string; metadata?: Record<string, unknown> | null }[]; at: number } | undefined

// The domain a request was made to: the storefront passes the visitor's on to the API it calls
// on this machine (storefront/src/lib/medusa.ts). Used only to choose among the shop's own sites.
export const requestHost = (headers: Record<string, string | string[] | undefined>): string | null => {
  const h = headers["x-forwarded-host"] ?? headers.host
  return (Array.isArray(h) ? h[0] : h)?.split(",")[0]?.trim() || null
}

export type ShopInfo = { name: string; url: string; market: Market }

// The shop's name, and the market and site an order or a customer belongs to: the market of the
// sales channel named (an order's), or the shop's first market.
export const shopInfo = async (scope: MedusaContainer, channelId?: string | null): Promise<ShopInfo> => {
  if (!cached || Date.now() - cached.at >= 60_000) {
    const [[store], channels] = await Promise.all([
      scope.resolve(Modules.STORE).listStores({}, { take: 1 }),
      scope.resolve(Modules.SALES_CHANNEL).listSalesChannels({}, { select: ["id", "metadata"] }),
    ])
    cached = { name: store?.name || process.env.WHISK_APP_NAME || "Shop", channels, at: Date.now() }
  }
  const markets = marketsFrom(process.env)
  const market = marketOfChannel(markets, cached.channels.find((c) => c.id === channelId)?.metadata)
  return { name: cached.name, url: marketUrl(market, process.env.WHISK_PUBLIC_URL ?? ""), market }
}

// The same, for the site of the domain a request was made to.
export const shopInfoAt = async (scope: MedusaContainer, host: string | null): Promise<ShopInfo> => {
  const { name } = await shopInfo(scope)
  const market = marketFor(marketsFrom(process.env), host)
  return { name, url: marketUrl(market, process.env.WHISK_PUBLIC_URL ?? ""), market }
}

export type StorefrontContext = {
  api: string
  cms: string
  publishableKey: string
  regionId: string
  currency: string
  name: string
  bank: BankAccount | null
  stripeKey: string | null
  stripeTestKey: string | null
  paypalClientId: string | null
  providers: string[]
  market: Market
  alternates: { hreflang: string; origin: string }[] // the shop's sites in its other markets (src/lib/market.ts)
}

const contexts = new Map<string, { value: StorefrontContext; at: number }>()

// What the storefront needs to know about the shop on every request (storefront/src/lib/medusa.ts),
// for the market of the domain asked for (src/lib/market.ts), read once a minute per market: where
// the store API and the CMS answer, the key it calls the store API with (the market's sales
// channel's), the market's region and the payment providers it takes, the shop's name and its bank
// account for transfers, and the market's other sites.
export const storefrontContext = async (scope: MedusaContainer, host?: string | null): Promise<StorefrontContext> => {
  const markets = marketsFrom(process.env)
  const market = marketFor(markets, host)
  const hit = contexts.get(market.key)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: stores }, { data: channels }, { data: keys }, { data: regions }, enabled] = await Promise.all([
    query.graph({ entity: "store", fields: ["name", "metadata", "default_sales_channel_id"], pagination: { take: 1 } }),
    query.graph({ entity: "sales_channel", fields: ["id", "metadata"] }),
    query.graph({ entity: "api_key", fields: ["token", "revoked_at", "created_at", "sales_channels.id"], filters: { type: "publishable" } }),
    query.graph({ entity: "region", fields: ["id", "currency_code", "created_at", "payment_providers.id"], filters: { currency_code: market.currency } }),
    scope.resolve(Modules.PAYMENT).listPaymentProviders({ is_enabled: true }),
  ])
  const store = (stores as any[])[0]
  // The market's sales channel; a one-market shop's is the store's own.
  const channel = (channels as any[]).find((c) => c.metadata?.market === market.key) ?? (markets.length === 1 ? { id: store?.default_sales_channel_id } : null)
  const live = (keys as any[]).filter((k) => !k.revoked_at).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
  const key = channel?.id ? (linkedTo(live, channel.id) ?? (markets.length === 1 ? live[0] : undefined)) : undefined
  const region = (regions as any[]).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0]
  if (!key || !region) throw new Error(`the shop is not set up to sell in ${market.name} yet: run the migrate step (node migrate.js)`)
  const loaded = new Set(enabled.map((p) => p.id))
  const value: StorefrontContext = {
    api: `http://127.0.0.1:${process.env.PORT ?? "9000"}`,
    cms: cmsAddress(),
    publishableKey: key.token,
    regionId: region.id,
    currency: region.currency_code,
    name: store?.name || process.env.WHISK_APP_NAME || "Shop",
    bank: bankAccountOf(store?.metadata),
    stripeKey: browserKeysFrom(process.env).stripe,
    stripeTestKey: browserKeysFrom(process.env).stripeTest,
    paypalClientId: browserKeysFrom(process.env).paypal,
    providers: (region.payment_providers ?? []).map((p: { id: string }) => p.id).filter((id: string) => loaded.has(id)),
    market,
    alternates: alternatesOf(markets),
  }
  contexts.set(market.key, { value, at: Date.now() })
  return value
}
