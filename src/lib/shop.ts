// What the storefront is drawn from: the shop's context, which Whisk's commerce engine gives the
// pages for the site a visitor asked for (src/lib/front.ts; commerce/engine api/front.go).
import type { Market } from "./market"

// The business's bank account, which customers paying by transfer are shown.
export type BankAccount = { accountName: string; accountNumber: string }

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
  open: boolean // whether checkout takes orders: the shop's setup is done
  market: Market
  alternates: { hreflang: string; origin: string }[] // the shop's sites in its other markets (src/lib/market.ts)
  app?: string // the app the storefront names to an engine its server shares among shops (src/lib/front.ts)
}
