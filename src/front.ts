// The shop's front, when Whisk's own server answers the shop's API (start.ts): the storefront,
// its built files, a moved website's old addresses and the site editor, on a port of the app's
// own that only that server reaches. That server answers the API, the admin's pages and the
// website's forms itself and passes every other request here, with the storefront's context
// (src/lib/front.ts). Nothing here loads Medusa.
import http from "node:http"
import { pathToFileURL } from "node:url"
import { storefrontFrom, STOREFRONT_HEADER } from "./lib/front"
import { cmsRequest, sendRedirect, sendStatic, storefrontServer } from "./lib/pages"
import { CMS } from "./lib/routes"

type Astro = { handler: (req: unknown, res: unknown, next: (e?: unknown) => void, locals?: unknown) => unknown }
let astro: Promise<Astro> | undefined
const storefront = () => (astro ??= import(pathToFileURL(storefrontServer()).href))

const answer = (res: http.ServerResponse, status: number, code: string, message: string, fix: string) => {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { "content-type": "application/json", ...(status === 503 ? { "retry-after": "5" } : {}) })
  res.end(JSON.stringify({ error: { code, message, fix } }))
}

export const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const url = req.url ?? "/"
  const pathname = url.split("?")[0]
  const shop = storefrontFrom(req.headers[STOREFRONT_HEADER])
  delete req.headers[STOREFRONT_HEADER]
  if (CMS.test(pathname)) return cmsRequest(req, res, url)
  if (sendRedirect(req, res, url)) return
  if (await sendStatic(req, res, pathname)) return
  if (!shop) return answer(res, 503, "SHOP_FRONT_UNAVAILABLE", "The shop's pages cannot be shown right now.", "Try again in a few seconds.")
  const { handler } = await storefront()
  await handler(req, res, (e?: unknown) => {
    if (e) console.error("front: the storefront failed", e)
    answer(res, e ? 500 : 404, e ? "INTERNAL" : "NOT_FOUND", e ? "The page could not be shown." : "There is no page here.", e ? "Try again." : "Check the address.")
  }, { shop })
}

// startFront serves the front on the port, on this machine only.
export const startFront = (port: number) => {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error("front:", e)
      answer(res, 500, "INTERNAL", "The page could not be shown.", "Try again.")
    })
  })
  server.headersTimeout = 10_000
  server.listen(port, "127.0.0.1")
  return server
}
