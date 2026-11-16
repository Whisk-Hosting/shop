// The shop's front, beside Whisk's commerce engine, which answers the shop's API: the storefront,
// its built files, a moved website's old addresses and the site editor.
//
// The server is either the one the app's machine shares among its shops (WHISK_COMMERCE_URL): the
// edge then sends the API and the website's forms there and everything else here, on the app's
// own port, and this front asks the server for the storefront's context itself, as the app; or
// one beside this front on the same machine (`engine serve`, on a laptop), which passes every
// request that is not the API here with the storefront's context.
import http from "node:http"
import { pathToFileURL } from "node:url"
import { cmsBuilt, cmsReady } from "./lib/cms"
import { engineContext, SHOP_APP_HEADER, storefrontFrom, STOREFRONT_HEADER } from "./lib/front"
import { cmsRequest, sendAdmin, sendRedirect, sendStatic, siteHost, storefrontServer } from "./lib/pages"
import { CMS } from "./lib/routes"
import type { StorefrontContext } from "./lib/shop"

type Astro = { handler: (req: unknown, res: unknown, next: (e?: unknown) => void, locals?: unknown) => unknown }
let astro: Promise<Astro> | undefined
const storefront = () => (astro ??= import(pathToFileURL(storefrontServer()).href))

const answer = (res: http.ServerResponse, status: number, code: string, message: string, fix: string) => {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { "content-type": "application/json", ...(status === 503 ? { "retry-after": "5" } : {}) })
  res.end(JSON.stringify({ error: { code, message, fix } }))
}

// The shared engine's answers, kept half a minute per site: the engine reads its own once a minute.
const asked = new Map<string, { value: StorefrontContext; at: number }>()

// The storefront's context from the engine the app's server shares among its shops, for the site
// the visitor asked for; null when the engine does not give one.
const fromEngine = async (engine: string, req: http.IncomingMessage): Promise<StorefrontContext | null> => {
  const host = siteHost(req.headers) ?? ""
  const hit = asked.get(host)
  if (hit && Date.now() - hit.at < 30_000) return hit.value
  const app = process.env.WHISK_APP_ID ?? ""
  try {
    const res = await fetch(`${engine.replace(/\/+$/, "")}/whisk-engine/storefront?host=${encodeURIComponent(host)}`, {
      headers: { accept: "application/json", [SHOP_APP_HEADER]: app },
      signal: AbortSignal.timeout(5_000),
    })
    const value = res.ok ? engineContext(await res.json(), engine, app) : null
    if (!value) console.error(`front: the commerce engine gave no storefront context (${res.status})`)
    if (value) asked.set(host, { value, at: Date.now() })
    return value
  } catch (e) {
    console.error("front: the commerce engine did not answer", e)
    return hit?.value ?? null
  }
}

// pagesReady is what keeps the pages from being ready, or null: the site editor, which every page
// reads, when it is built here and does not answer.
export const pagesReady = (built: boolean, ask: () => Promise<void>): Promise<string | null> =>
  built ? ask().then(() => null, (e: Error) => `cms: ${e.message}`) : Promise.resolve(null)

// ready answers the platform's health check (whisk.yaml): the pages are ready once the site
// editor answers, so a visitor waking the shop waits at the edge rather than meeting a page the
// editor did not answer in time.
const ready = async (res: http.ServerResponse) => {
  const failed = await pagesReady(cmsBuilt(), () => cmsReady(5_000))
  res.writeHead(failed ? 503 : 200, { "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify(failed ? { ok: false, failed: [failed] } : { ok: true }))
}

export const handle = async (req: http.IncomingMessage, res: http.ServerResponse, engine = process.env.WHISK_COMMERCE_URL) => {
  const url = req.url ?? "/"
  const pathname = url.split("?")[0]
  const sent = engine ? null : storefrontFrom(req.headers[STOREFRONT_HEADER])
  delete req.headers[STOREFRONT_HEADER]
  if (pathname === "/health/ready") return ready(res)
  if (CMS.test(pathname)) return cmsRequest(req, res, url)
  if (sendRedirect(req, res, url)) return
  if (await sendStatic(req, res, pathname)) return
  if (engine && (await sendAdmin(req, res, pathname))) return
  const shop = engine ? await fromEngine(engine, req) : sent
  if (!shop) return answer(res, 503, "SHOP_FRONT_UNAVAILABLE", "The shop's pages cannot be shown right now.", "Try again in a few seconds.")
  const { handler } = await storefront()
  await handler(req, res, (e?: unknown) => {
    if (e) console.error("front: the storefront failed", e)
    answer(res, e ? 500 : 404, e ? "INTERNAL" : "NOT_FOUND", e ? "The page could not be shown." : "There is no page here.", e ? "Try again." : "Check the address.")
  }, { shop })
}

// startFront serves the front on the port: on this machine only beside an engine inside the app,
// or on every address of the app's when the edge reaches it directly.
export const startFront = (port: number, address = "127.0.0.1") => {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error("front:", e)
      answer(res, 500, "INTERNAL", "The page could not be shown.", "Try again.")
    })
  })
  server.headersTimeout = 10_000
  server.listen(port, address)
  return server
}
