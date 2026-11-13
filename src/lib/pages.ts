// What the shop answers beside its API, shared by the shop's server (src/api/middlewares.ts) and
// the front that serves the same pages when Whisk runs the shop's API itself (src/front.ts): the
// storefront's built files, a moved website's old addresses, and the site editor. Free of Medusa.
import { createReadStream, promises as fs, readFileSync } from "node:fs"
import type http from "node:http"
import path from "node:path"
import { editorFor, editPath, editQuery, findForEdit, insideAdmin, isEditLink, isEditorPage, proxy } from "./cms"
import { marketFor, marketsFrom } from "./market"
import { isStaff, personFrom } from "./person"
import { redirectFor, shopAddress, staticFile, type Redirect } from "./routes"

type Req = http.IncomingMessage
type Res = http.ServerResponse

// Where the storefront's built server and files are, under the built shop.
export const storefrontServer = (cwd = process.cwd()) => path.resolve(cwd, "storefront/dist/server/entry.mjs")
export const storefrontRoot = (cwd = process.cwd()) => path.resolve(cwd, "storefront/dist/client")

// The market whose site a request was made to, in a shop that sells in several.
export const siteMarket = (headers: http.IncomingHttpHeaders) => {
  const markets = marketsFrom(process.env)
  if (markets.length < 2) return null
  const h = headers["x-forwarded-host"] ?? headers.host
  return marketFor(markets, (Array.isArray(h) ? h[0] : h)?.split(",")[0]?.trim() || null).key
}

const redirect = (res: Res, status: number, location: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { ...headers, location })
  res.end()
}

// A built file of the storefront's, if the path names one; false when it does not.
export const sendStatic = async (req: Req, res: Res, pathname: string, root = storefrontRoot()): Promise<boolean> => {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  const found = staticFile(root, pathname)
  if (!found) return false
  const stat = await fs.stat(found.file).catch(() => null)
  if (!stat?.isFile()) return false
  res.writeHead(200, { "content-type": found.type, "content-length": String(stat.size), "cache-control": found.cache })
  if (req.method === "HEAD") {
    res.end()
    return true
  }
  await new Promise<void>((ok, fail) => createReadStream(found.file).on("error", fail).on("end", ok).pipe(res))
  return true
}

// The old addresses of a moved website (redirects.json, written by the mover): each answers with
// one hop to where it went, or 410 for a page that is gone.
let redirects: Redirect[] | undefined
const oldAddresses = (): Redirect[] =>
  (redirects ??= (() => {
    try {
      const list = JSON.parse(readFileSync(path.resolve(process.cwd(), "redirects.json"), "utf8"))
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  })())

// Then a shop page asked for at its other address (src/lib/routes.ts, shopAddress) is sent to its
// own, so each page is listed once.
export const sendRedirect = (req: Req, res: Res, url: string): boolean => {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  const pathname = url.split("?")[0]
  const search = url.includes("?") ? url.slice(url.indexOf("?")) : ""
  const own = shopAddress(pathname)
  const moved = redirectFor(oldAddresses(), pathname, search) ?? (own ? { status: 301, location: own + search } : null)
  if (!moved) return false
  if (moved.location) {
    redirect(res, moved.status, moved.location, { "cache-control": "public, max-age=300" })
    return true
  }
  res.writeHead(moved.status, { "cache-control": "public, max-age=300", "content-type": "text/plain; charset=utf-8" })
  res.end("This page has been removed.")
  return true
}

// The site editor and its API. Its pages are for the business's team, inside the shop's admin:
// anyone else is sent to sign in to Whisk, and the team opening /cms on its own is taken to the
// admin's section for it. Its API decides for itself (cms/src/access.ts).
export const cmsRequest = async (req: Req, res: Res, url: string) => {
  const pathname = url.split("?")[0]
  if (isEditLink(pathname)) {
    if (!isStaff(personFrom(req.headers))) return redirect(res, 302, `/.whisk/login?return=${encodeURIComponent(url)}`)
    const { collection, query } = editQuery(editPath(url.slice(pathname.length)))
    return redirect(res, 302, editorFor(collection, await findForEdit(req.headers, collection, query, siteMarket(req.headers))), { "cache-control": "no-store" })
  }
  if (isEditorPage(pathname)) {
    if (!isStaff(personFrom(req.headers))) return redirect(res, 302, `/.whisk/login?return=${encodeURIComponent(insideAdmin(url))}`)
    if (req.headers["sec-fetch-dest"] === "document") return redirect(res, 302, insideAdmin(url))
  }
  await proxy(req, res, url)
}
