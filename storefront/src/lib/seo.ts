// What a page tells search engines and link previews: its one address, its picture, and the
// structured data (schema.org) for the business, the site, the trail to the page and a product.
// Pure; table-tested.

type Market = { taxRate: number; taxInclusive: boolean }

// A page's address as search engines should list it: its path, with the page number of a list
// past its first page and nothing else of the query.
export const canonicalUrl = (url: URL): string => {
  const page = Number(url.searchParams.get("page"))
  return url.origin + url.pathname + (Number.isInteger(page) && page > 1 ? `?page=${page}` : "")
}

// An address on this site, made whole.
export const absoluteUrl = (origin: string, u: string | null | undefined): string | null => {
  if (!u) return null
  try {
    return new URL(u, origin + "/").toString()
  } catch {
    return null
  }
}

// A picture to show beside a link: whole, and a picture stored on Whisk as a 1200 px JPEG, which
// every site that previews links reads.
export const shareImage = (origin: string, u: string | null | undefined): string | null =>
  absoluteUrl(origin, u && u.includes("/.whisk/img/") ? `${u.slice(u.indexOf("/.whisk/img/")).split("?")[0]}?w=1200&format=jpeg` : u)

// The first picture in a page's blocks (a hero's, a picture's, a column's), for a page that names
// none to show beside links.
export const firstPicture = (value: unknown, depth = 0): string | null => {
  if (!value || typeof value !== "object" || depth > 6) return null
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = firstPicture(v, depth + 1)
      if (found) return found
    }
    return null
  }
  const o = value as Record<string, unknown>
  const m = o.image as { url?: unknown; mimeType?: unknown } | null | undefined
  if (m && typeof m === "object" && typeof m.url === "string" && !/^video\//.test(String(m.mimeType ?? ""))) return m.url
  return firstPicture(Object.values(o).filter((v) => v && typeof v === "object"), depth + 1)
}

// A price with the market's tax in it, as search engines show prices to shoppers.
export const withTax = (amount: number, market: Market): number =>
  market.taxInclusive ? amount : Math.round(amount * (100 + market.taxRate)) / 100

const LD = "https://schema.org"

// The business and its site, on the home page.
export const siteLd = (origin: string, name: string) => [
  { "@context": LD, "@type": "Organization", "@id": `${origin}/#organization`, name, url: `${origin}/` },
  { "@context": LD, "@type": "WebSite", "@id": `${origin}/#website`, name, url: `${origin}/`, publisher: { "@id": `${origin}/#organization` } },
]

export type Crumb = { name: string; path: string }

// The trail from the home page to this one.
export const breadcrumbLd = (origin: string, crumbs: Crumb[]) => ({
  "@context": LD,
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: origin + c.path })),
})

type Variant = {
  sku?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_quantity?: number | null
  calculated_price?: { calculated_amount: number; currency_code: string } | null
}
type Product = {
  title: string
  handle: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  images?: { url: string }[] | null
  thumbnail?: string | null
  variants?: Variant[] | null
}

export const inStock = (v: Variant) => !v.manage_inventory || !!v.allow_backorder || Number(v.inventory_quantity ?? 0) > 0

// A product: its brand is the one in its metadata (`brand`), else the shop's own name.
export const productLd = (p: Product, ctx: { origin: string; shop: string; market: Market; sku?: string | null }) => {
  const url = `${ctx.origin}/products/${p.handle}`
  const images = (p.images?.length ? p.images.map((i) => i.url) : p.thumbnail ? [p.thumbnail] : [])
    .map((u) => shareImage(ctx.origin, u))
    .filter((u): u is string => !!u)
  const brand = typeof p.metadata?.brand === "string" && p.metadata.brand.trim() ? p.metadata.brand.trim() : ctx.shop
  return {
    "@context": LD,
    "@type": "Product",
    name: p.title,
    url,
    description: p.description || undefined,
    image: images.length ? images : undefined,
    sku: ctx.sku || undefined,
    brand: { "@type": "Brand", name: brand },
    offers: (p.variants ?? [])
      .filter((v) => v.calculated_price)
      .map((v) => ({
        "@type": "Offer",
        url,
        price: withTax(v.calculated_price!.calculated_amount, ctx.market),
        priceCurrency: v.calculated_price!.currency_code.toUpperCase(),
        availability: inStock(v) ? `${LD}/InStock` : `${LD}/OutOfStock`,
        itemCondition: `${LD}/NewCondition`,
        sku: v.sku || undefined,
      })),
  }
}

// A page's whole <title>: its own and the shop's name, or its own alone when both together are
// longer than search results show (about 60 characters).
export const TITLE_MAX = 60
export const titleWithName = (title: string | undefined, name: string): string =>
  !title ? name : `${title} | ${name}`.length <= TITLE_MAX ? `${title} | ${name}` : title

// A list of products' description when none is written: what it holds, by the first products'
// names, cut at a whole name (or a word) to at most 155 characters, ending "and more.".
export const DESCRIPTION_MAX = 155
const MORE = " and more."
export const listDescription = (what: string, titles: readonly string[], name: string): string => {
  const lead = `${what} at ${name}`
  const all = titles.length ? `${lead}: ${titles.join(", ")}.` : `${lead}.`
  if (all.length <= DESCRIPTION_MAX) return all
  const cut = all.slice(0, DESCRIPTION_MAX - MORE.length)
  const comma = cut.lastIndexOf(",")
  const at = comma > lead.length ? comma : cut.lastIndexOf(" ")
  return `${cut.slice(0, at > 0 ? at : cut.length).replace(/[,:]$/, "")}${MORE}`
}
