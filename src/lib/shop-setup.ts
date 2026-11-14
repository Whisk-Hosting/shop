// What a shop needs from the business before it opens, and what it should have soon after. The
// business's own details live in the store's metadata, entered in the admin (the setup card,
// src/admin/widgets/shop-setup.tsx) or by an agent through /admin/whisk/setup, so they change
// without a deploy; the rest are whisk.yaml and the dashboard's. Checkout stays closed until every
// required item is done, so no order is taken that nobody hears of or can be paid for. Pure.
import { bankAccountOf, staffAddresses } from "./orders"
import { paymentProvidersFrom } from "./settings"

type Env = Record<string, string | undefined>
type Metadata = Record<string, unknown> | null | undefined

// The details the business enters, each a key of the store's metadata.
export const FIELDS = [
  "orders_email",
  "enquiries_email",
  "business_name",
  "gst_number",
  "business_phone",
  "business_address",
  "bank_account_name",
  "bank_account_number",
] as const
export type Field = (typeof FIELDS)[number]
export type Values = Record<Field, string>

// Where an item is done: the admin, whisk.yaml with the dashboard, the dashboard alone, or the
// website's editor.
export type Where = "admin" | "whisk.yaml" | "dashboard" | "editor"
// done is null for what the shop cannot check itself, such as what a page says.
export type Item = { key: string; label: string; required: boolean; done: boolean | null; where: Where; fix: string; steps: string[] }
export type Setup = { ready: boolean; items: Item[]; values: Values }
// What the shop reads from its own records for the check: the markets with no delivery a customer
// can choose (src/lib/shop.ts, setupFacts).
export type Facts = { undelivered: string[] }

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

export const valuesOf = (metadata: Metadata): Values =>
  Object.fromEntries(FIELDS.map((f) => [f, text(metadata?.[f])])) as Values

// Who is emailed each new order: the addresses entered in the admin, then SHOP_ORDERS_TO's.
export const ordersTo = (metadata: Metadata, env: Env, envValue = env["SHOP_ORDERS_TO"]): string[] =>
  [...new Set([...staffAddresses(text(metadata?.orders_email)), ...staffAddresses(envValue)])]

// Who is emailed each enquiry from the website's forms; customers' replies to the shop's emails go
// to the first of them.
export const enquiriesTo = (metadata: Metadata): string[] => staffAddresses(text(metadata?.enquiries_email))

// Whether a customer has a way to pay: the business's bank account, or a provider's keys.
export const canBePaid = (metadata: Metadata, env: Env): boolean => !!bankAccountOf(metadata) || paymentProvidersFrom(env).length > 0

type ShippingOption = { rules?: { attribute: string; value: string }[] | null; service_zone?: { geo_zones?: { country_code?: string | null }[] | null } | null }

// The markets (by name) where no delivery a customer can choose reaches the market's country.
export const undeliveredMarkets = (markets: readonly { name: string; country: string }[], options: readonly ShippingOption[]): string[] => {
  const rule = (o: ShippingOption, attribute: string) => (o.rules ?? []).find((r) => r.attribute === attribute)?.value
  const offered = options.filter((o) => rule(o, "enabled_in_store") !== "false" && rule(o, "is_return") !== "true")
  return markets
    .filter((m) => !offered.some((o) => (o.service_zone?.geo_zones ?? []).some((g) => (g.country_code ?? "").toLowerCase() === m.country)))
    .map((m) => m.name)
}

const onWhisk = (url: string | undefined) => {
  try {
    return new URL(url ?? "").hostname.endsWith(".whisk.page")
  } catch {
    return true
  }
}

const SET_IN_ADMIN = "Enter it on the shop's setup card in the admin (/app, Orders), or have the agent send it: whisk call POST /admin/whisk/setup --data '{...}'."

export const setupOf = (metadata: Metadata, env: Env, facts: Facts): Setup => {
  const v = valuesOf(metadata)
  const items: Item[] = [
    {
      key: "orders_email", label: "Who is emailed each new order", required: true, where: "admin",
      done: ordersTo(metadata, env).length > 0,
      fix: "Enter the address (or several, separated by commas) that hears of each new order.",
      steps: ["Ask who at the business should hear of each new order, and at which address.", SET_IN_ADMIN.replace("{...}", '{"orders_email": "orders@example.co.nz"}')],
    },
    {
      key: "enquiries_email", label: "Who is emailed each enquiry", required: true, where: "admin",
      done: enquiriesTo(metadata).length > 0,
      fix: "Enter the address that gets each enquiry from the website's forms; customers' replies to the shop's emails go there too.",
      steps: ["Ask which address customers' questions should reach: each enquiry from the website goes there, and a customer who replies to an order email reaches it too.", SET_IN_ADMIN.replace("{...}", '{"enquiries_email": "hello@example.co.nz"}')],
    },
    {
      key: "payment", label: "A way for customers to pay", required: true, where: "whisk.yaml",
      done: canBePaid(metadata, env),
      fix: "Connect Stripe for cards, Apple Pay, Google Pay and Afterpay, or enter the bank account customers pay into by transfer.",
      steps: [
        "Cards (recommended): the person creates a Stripe account at https://dashboard.stripe.com/register, then completes Activate payments with the business's details and the bank account Stripe pays out to.",
        "In Stripe, Developers, API keys, they copy the publishable key (pk_live_...) and the secret key (sk_live_...). The agent never asks for them in chat.",
        "The agent adds STRIPE_API_KEY and STRIPE_PUBLISHABLE_KEY under secrets in whisk.yaml, runs whisk secrets set STRIPE_API_KEY STRIPE_PUBLISHABLE_KEY, and gives the person the link it prints to paste both; then deploys.",
        "To try a payment first, add the test keys too (pk_test_..., sk_test_...) as STRIPE_TEST_PUBLISHABLE_KEY and STRIPE_TEST_API_KEY: the admin's Store page then has a Test mode switch.",
        "Bank transfer, with or without cards: " + SET_IN_ADMIN.replace("{...}", '{"bank_account_name": "Example Ltd", "bank_account_number": "12-3456-7890123-00"}'),
      ],
    },
    {
      key: "delivery", label: "Delivery rates", required: true, where: "admin",
      done: facts.undelivered.length === 0,
      fix: facts.undelivered.length
        ? `Add at least one delivery option customers can choose in ${facts.undelivered.join(" and ")}.`
        : "Every market has a delivery option.",
      steps: [
        "Ask how the business delivers and what it charges: a flat rate, free over an amount, pick-up, or several options.",
        "In the admin: Settings, Locations & Shipping, the market's location, then Create option under its delivery zone, with a name customers see and its price.",
      ],
    },
    {
      key: "business_name", label: "The business's legal name", required: true, where: "admin",
      done: !!v.business_name,
      fix: "Enter the business's legal or trading name, as it goes on tax invoices.",
      steps: [SET_IN_ADMIN.replace("{...}", '{"business_name": "Example Ltd"}')],
    },
    {
      key: "gst_number", label: "GST number (ABN in Australia)", required: false, where: "admin",
      done: !!v.gst_number,
      fix: "Enter the business's GST number, which order confirmations show so they serve as tax invoices; leave it empty only when the business is not registered for GST.",
      steps: [SET_IN_ADMIN.replace("{...}", '{"gst_number": "123-456-789"}')],
    },
    {
      key: "business_phone", label: "A phone number for customers", required: false, where: "admin",
      done: !!v.business_phone,
      fix: "Enter the phone number customers can call about an order.",
      steps: [SET_IN_ADMIN.replace("{...}", '{"business_phone": "09 123 4567"}')],
    },
    {
      key: "business_address", label: "The business's address", required: false, where: "admin",
      done: !!v.business_address,
      fix: "Enter the business's address, which order confirmations show.",
      steps: [SET_IN_ADMIN.replace("{...}", '{"business_address": "1 Queen Street, Auckland 1010"}')],
    },
    {
      key: "policies", label: "Privacy, returns and terms pages", required: false, where: "editor", done: null,
      fix: "Add pages saying how the business uses customers' details, how returns and refunds work, and its terms of sale, and link them from the footer.",
      steps: ["In the admin: Pages, Create, for each of /privacy, /returns and /terms, then add them to the footer under Menu. The agent can draft them from what the business tells it."],
    },
    {
      key: "email_from", label: "Emails sent from the business's own domain", required: false, where: "whisk.yaml",
      done: !!text(env["SHOP_EMAIL_FROM"]),
      fix: "Send the shop's emails from an address on the business's domain rather than whisk.page.",
      steps: ["An owner adds the domain: whisk email domains add <domain>, creates the DNS records it prints, then whisk email domains verify <domain>.", "The agent sets SHOP_EMAIL_FROM in whisk.yaml, such as \"Example <orders@example.co.nz>\", and deploys."],
    },
    {
      key: "domain", label: "The shop on the business's own domain", required: false, where: "dashboard",
      done: !onWhisk(env["WHISK_PUBLIC_URL"]),
      fix: "Put the shop on the business's own domain.",
      steps: ["Ask the agent to point the domain at this shop; it adds the domain to the app and gives the DNS record to create."],
    },
  ]
  return { ready: items.every((i) => !i.required || i.done === true), items, values: v }
}

// Whether checkout is open: every required item done.
export const openForOrders = (metadata: Metadata, env: Env, facts: Facts): boolean => setupOf(metadata, env, facts).ready

const EMAIL_FIELDS: readonly Field[] = ["orders_email", "enquiries_email"]
const MAX = 300

// The metadata to save from the values given: each field given replaces the one kept, an empty one
// removes it. Refused, with every problem found, when an address is not one or a value is too long.
export const changesFrom = (given: unknown): { set: Partial<Record<Field, string | null>> } | { problems: string[] } => {
  if (!given || typeof given !== "object" || Array.isArray(given)) return { problems: ["Send the details as an object, such as {\"orders_email\": \"orders@example.co.nz\"}."] }
  const problems: string[] = []
  const set: Partial<Record<Field, string | null>> = {}
  for (const [key, raw] of Object.entries(given as Record<string, unknown>)) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      problems.push(`${key} is not a detail the shop keeps; it keeps ${FIELDS.join(", ")}.`)
      continue
    }
    if (raw !== null && typeof raw !== "string") {
      problems.push(`${key} is text.`)
      continue
    }
    const value = (raw ?? "").trim()
    if (value.length > MAX) problems.push(`${key} is longer than ${MAX} characters.`)
    else if (value && EMAIL_FIELDS.includes(key as Field)) {
      const parts = value.split(/[,;\s]+/).filter(Boolean)
      const bad = parts.filter((p) => staffAddresses(p).length === 0)
      if (bad.length) problems.push(`${key}: ${bad.join(", ")} is not an email address.`)
    }
    set[key as Field] = value || null
  }
  return problems.length ? { problems } : { set }
}
