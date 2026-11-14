// Shaping an entry from one of the website's forms into the business's email about it. Pure.
import type { EnquiryView } from "./emails"
import { staffAddresses } from "./orders"

// Fields a form carries for its own workings, never the customer's words: names starting "_"
// (the form's own, and Contact Form 7's in a copied WordPress form) and bot checks.
const INTERNAL = /^(_|cf-turnstile|g-recaptcha|h-captcha)/i

// "your-email" is "Your email".
export const fieldLabel = (key: string): string => {
  const words = key.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : key
}

const value = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).trim()

// The customer's address: the first field named for an email that holds one.
export const replyToOf = (fields: Record<string, unknown>): string | null => {
  for (const [k, v] of Object.entries(fields)) {
    if (!/mail/i.test(k)) continue
    const [address] = staffAddresses(value(v))
    if (address) return address
  }
  return null
}

const nameOf = (fields: Record<string, unknown>): string | null => {
  const key = Object.keys(fields).find((k) => /(^|[-_ ])name$|^name/i.test(k) && !INTERNAL.test(k) && !/product|company|business/i.test(k))
  return key ? value(fields[key]) || null : null
}

export const enquiryView = (form: string, page: string | null, fields: Record<string, unknown>, shop: { name: string; url: string }): EnquiryView => ({
  shop: shop.name,
  shopUrl: shop.url,
  title: fieldLabel(form),
  from: nameOf(fields) ?? replyToOf(fields) ?? "the website",
  page,
  fields: Object.entries(fields)
    .filter(([k, v]) => !INTERNAL.test(k) && value(v) !== "")
    .map(([k, v]) => ({ label: fieldLabel(k), value: value(v).slice(0, 5000) })),
})
