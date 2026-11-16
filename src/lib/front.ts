// What the shop's front reads from Whisk's commerce engine (src/front.ts): the storefront's
// context (StorefrontContext, src/lib/shop.ts). An engine inside the
// app sends it with every request it passes on, as base64url JSON in X-Whisk-Storefront; the
// engine a server shares among its shops answers it when the front asks (engineContext). Pure.
import type { StorefrontContext } from "./shop"

export const STOREFRONT_HEADER = "x-whisk-storefront"

// The header that names the shop to an engine shared among shops; the engine checks it is the
// asking app's own.
export const SHOP_APP_HEADER = "x-whisk-shop-app"

// The value as a context the storefront can use, or null.
const contextOf = (value: any): StorefrontContext | null =>
  value && typeof value === "object" && typeof value.api === "string" && typeof value.publishableKey === "string" &&
  typeof value.regionId === "string" && typeof value.currency === "string" && value.market && typeof value.market.key === "string"
    ? (value as StorefrontContext)
    : null

// The context the header carries, or null when it carries none that the storefront can use.
export const storefrontFrom = (header: string | string[] | undefined): StorefrontContext | null => {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  try {
    return contextOf(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")))
  } catch {
    return null
  }
}

// The context a shared engine answered, reached at its address as the app: the storefront then
// calls the engine there, naming the app. Null when the answer is not a context.
export const engineContext = (body: unknown, engine: string, app: string): StorefrontContext | null => {
  const value = contextOf(body)
  return value ? { ...value, api: engine.replace(/\/+$/, ""), app } : null
}
