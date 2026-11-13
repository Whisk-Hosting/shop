// What the shop's front reads from the API's server (src/front.ts): the storefront's context,
// which the server sends with every request it passes on, as base64url JSON in
// X-Whisk-Storefront (the same StorefrontContext src/lib/shop.ts reads under Medusa). Pure.
import type { StorefrontContext } from "./shop"

export const STOREFRONT_HEADER = "x-whisk-storefront"

// The context the header carries, or null when it carries none that the storefront can use.
export const storefrontFrom = (header: string | string[] | undefined): StorefrontContext | null => {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    const ok =
      value && typeof value === "object" && typeof value.api === "string" && typeof value.publishableKey === "string" &&
      typeof value.regionId === "string" && typeof value.currency === "string" && value.market && typeof value.market.key === "string"
    return ok ? (value as StorefrontContext) : null
  } catch {
    return null
  }
}
