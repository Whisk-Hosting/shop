// GET /sitemap.xml: the website's pages (from the CMS), the product list, every category and collection, and every
// product, read a page at a time so a large catalogue is not held at once.
import type { APIRoute } from "astro"
import { api, query } from "../lib/medusa"
import { sitemap } from "../lib/format"
import { listedPages, reader } from "../lib/cms"

const PAGE = 200
const MAX = 50_000 // one sitemap file holds at most this many addresses

export const GET: APIRoute = async ({ request, locals, url }) => {
  const a = api(locals.shop, request)
  const all = async (path: string, key: string, fields: string) => {
    const out: any[] = []
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const page = await a.get<Record<string, any>>(`${path}${query({ fields, limit: PAGE, offset })}`)
      out.push(...page[key])
      if (page[key].length < PAGE) break
    }
    return out
  }
  const [site, products, cats, cols] = await Promise.all([
    listedPages(reader(locals.shop.cms, request)),
    all("/store/products", "products", "handle,updated_at"),
    all("/store/product-categories", "product_categories", "handle,updated_at"),
    all("/store/collections", "collections", "handle,updated_at"),
  ])
  const entries = [
    // Until the website has a home page, the shop's list is the address's home too.
    ...(site.some((p) => p.path === "/") ? [] : [{ path: "/" }]),
    ...site.map((p) => ({ path: p.path, updated: p.updatedAt })),
    { path: "/products", updated: products.reduce<string | null>((a, p) => (p.updated_at && (!a || p.updated_at > a) ? p.updated_at : a), null) },
    ...cats.map((c) => ({ path: `/categories/${c.handle}`, updated: c.updated_at })),
    ...cols.map((c) => ({ path: `/collections/${c.handle}`, updated: c.updated_at })),
    ...products.map((p) => ({ path: `/products/${p.handle}`, updated: p.updated_at })),
  ].slice(0, MAX)
  return new Response(sitemap(url.origin, entries), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } })
}
