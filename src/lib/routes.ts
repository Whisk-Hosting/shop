// Which addresses are Medusa's, which the site editor's and which the storefront's, and how
// often the password routes may be tried. Pure; table-tested.

// Medusa answers /store, /admin, /auth, /hooks, its admin at /app, /health, and /erp-link (the
// ERP link's calls, when trade ordering is installed). The site editor (Payload) answers /cms and
// its own files under /_next. Everything else is the storefront: the website's pages and the
// shop's.
const MEDUSA = /^\/(store|admin|auth|hooks|app|health|erp-link)(\/|$)/
export const CMS = /^\/(cms|_next)(\/.*)?$/
export const STOREFRONT = /^\/(?!(store|admin|auth|hooks|app|health|erp-link|cms|_next)(\/|$)).*/

export const isMedusaPath = (path: string) => MEDUSA.test(path)

// Tries in fifteen minutes: signing in allows a few typos per address; sign-up and reset
// emails fewer, since each sends mail or makes an account.
export const limitFor = (path: string): { perEmail: number; perIp: number } =>
  path.endsWith("/register") || path.endsWith("/reset-password") ? { perEmail: 3, perIp: 20 } : { perEmail: 10, perIp: 60 }

// The storefront's built files (storefront/dist/client): scripts and styles under /_astro, whose
// names carry a hash and so never change, and the public folder's files (the favicon, and a moved
// website's fonts, documents and the files its old addresses named).
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
}

// staticFile answers the file under root that a path names, with its type and how long it may
// be cached, or null: for a path that is not a plain file name, escapes root, or has a type the
// storefront does not serve.
export const staticFile = (root: string, urlPath: string): { file: string; type: string; cache: string } | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.split("/").some((part) => part === ".." || part.startsWith("."))) return null
  const ext = /\.[a-z0-9]+$/i.exec(decoded)?.[0].toLowerCase()
  const type = ext ? TYPES[ext] : undefined
  if (!type) return null
  return { file: root.replace(/\/$/, "") + decoded, type, cache: cacheFor(decoded, type) }
}

// How long a built file may be kept: /_astro's for a year, since a new build names them anew;
// pictures, fonts, documents and media for a day, then used while fetched again for a week, since
// they are rarely replaced under the same name; scripts, styles and the rest for an hour, since
// they change with the pages that use them.
const cacheFor = (path: string, type: string) =>
  path.startsWith("/_astro/")
    ? "public, max-age=31536000, immutable"
    : /^(image|font|video|audio)\/|^application\/pdf/.test(type)
      ? "public, max-age=86400, stale-while-revalidate=604800"
      : "public, max-age=3600, stale-while-revalidate=86400"

// The shop's pages each have one address: without a last slash, and the product list at /products
// (/shop, its other address, is sent there). The website's pages keep the address each was given.
const SHOP_PAGES = /^\/(products|categories|collections|search|cart|checkout|account|order)(\/[^/]|$)/
export const shopAddress = (path: string): string | null => {
  if (path === "/shop" || path === "/shop/") return "/products"
  if (path === "/" || !path.endsWith("/")) return null
  const trimmed = path.replace(/\/+$/, "")
  return SHOP_PAGES.test(trimmed) && !trimmed.includes("//") ? trimmed : null
}

// A moved website's old addresses (redirects.json, written by the mover): each answers with one
// hop to where it went, or 410 for a page that is gone. A redirect for an exact query wins over
// one for the path alone.
export type Redirect = { from: string; to?: string; status?: number }
export const redirectFor = (redirects: Redirect[], path: string, search: string): { status: number; location?: string } | null => {
  const hit = redirects.find((r) => search && r.from === path + search) ?? redirects.find((r) => r.from === path)
  if (!hit) return null
  if (hit.status === 410) return { status: 410 }
  if (!hit.to) return null
  return { status: hit.status === 302 || hit.status === 307 || hit.status === 308 ? hit.status : 301, location: hit.to }
}

// A form posts to /forms/<name>; the entry is kept in the shop's database.
export const formName = (path: string): string | null => /^\/forms\/([a-z0-9-]{1,40})$/.exec(path)?.[1] ?? null

// A form's fields from its body, or null when the body is not one; and whether any is filled
// (the form script first posts empty to fetch the edge's challenge, which must not
// become an entry).
export const formFields = (contentType: string, body: string): Record<string, unknown> | null => {
  try {
    const fields = contentType.includes("application/json") ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body))
    return fields && typeof fields === "object" && !Array.isArray(fields) ? fields : null
  } catch {
    return null
  }
}
export const anyFilled = (fields: Record<string, unknown>) => Object.values(fields).some((v) => String(v ?? "").trim() !== "")

// Where a form post returns: the page it came from, told which form was sent.
export const formReturn = (referer: string | undefined, name: string): string => {
  try {
    const u = new URL(referer ?? "/", "http://x")
    u.searchParams.set("sent", name)
    return u.pathname.startsWith("//") ? `/?sent=${encodeURIComponent(name)}` : u.pathname + u.search
  } catch {
    return `/?sent=${encodeURIComponent(name)}`
  }
}
