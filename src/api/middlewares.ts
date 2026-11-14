// What sits in front of Medusa's own routes:
// - the admin API is for the business's Whisk team only, signed in through Whisk (/auth/whisk),
//   or an agent acting for one of them, which needs no session;
// - password sign-ins are rate-limited, since Medusa does not limit them itself;
// - /cms is the site editor (Payload, cms/), which runs beside Medusa (src/lib/cms.ts) and is
//   shown inside the admin at /app; /cms/edit?path= opens it at the page with that path (the
//   Whisk bar's Edit page);
// - every other address is the storefront (Astro, storefront/): the website's pages, drawn from
//   the CMS, and the shop's, drawn from Medusa, on one address.
import { ApiLoader, defineMiddlewares, type MedusaNextFunction, type MedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { pathToFileURL } from "node:url"
import { kv } from "../lib/kv"
import { personFrom, sessionHolds, sessionless, staffFor } from "../lib/staff"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { anyFilled, CMS, formFields, formName, formReturn, isMedusaPath, limitFor, STOREFRONT } from "../lib/routes"
import { requestHost, shopSetup, storefrontContext } from "../lib/shop"
import { sendEnquiry } from "../lib/notify"
import { cmsRequest, sendRedirect, sendStatic, storefrontServer } from "../lib/pages"
import { startCms } from "../lib/cms"

// The CMS starts with the shop's server, not with its other commands (migrate, exec).
if (process.argv.includes("start") || process.argv.includes("develop")) startCms()

const refuse = (res: MedusaResponse, status: number, code: string, message: string, fix: string) =>
  res.status(status).json({ error: { code, message, fix } })

// The admin API answers only someone on the business's Whisk team. Medusa has already checked
// the session (made by /auth/whisk); this checks it still belongs to whoever Whisk says is here,
// and ends it when not. A secret API key (for a link to another system) is the business's own
// and passes.
const staffOnly = async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  const context = (req as any).auth_context
  // No one signed in: Medusa has already turned this away unless the route is open to all (the
  // admin's feature flags, read before sign-in).
  if (!context || context.actor_type === "api-key") return next()
  if (sessionHolds(context?.app_metadata?.whisk_user_id, personFrom(req.headers))) return next()
  await new Promise<void>((ok) => req.session.destroy(() => ok()))
  return refuse(res, 401, "AUTH_REQUIRED", "The shop's admin is for its team.", "Open /app while signed in to Whisk as a member of the business that runs this shop.")
}

// Medusa checks who is signed in to the admin API (a session, a token or a secret API key) before
// any middleware of the shop's runs, and turns away a request with none. An agent acting for a
// team member has none, nor has a member's browser reading the setup list for the Whisk bar, so
// each is signed in here as that member, for this request only, in front
// of Medusa's check. The check is reached through Medusa's hook for wrapping its middlewares,
// which Medusa reads as it puts the API together, after loading this file.
type Middleware = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => unknown
const agentSignIn = (check: Middleware): Middleware =>
  async function agentSignIn(req, res, next) {
    const person = personFrom(req.headers)
    if (!sessionless(person, req.method, String(req.originalUrl ?? req.url ?? "").split("?")[0]!)) return check(req, res, next)
    try {
      ;(req as any).auth_context = await staffFor(req.scope, person)
    } catch (e) {
      return next(e)
    }
    next()
  }

const traced = ApiLoader.traceMiddleware
ApiLoader.traceMiddleware = (handler, route) => {
  const own = route.route === "/admin" && handler.name === "authMiddleware" ? (agentSignIn(handler as Middleware) as typeof handler) : handler
  return traced ? traced(own, route) : own
}

// A shop takes no order until the business has said who hears of it, where enquiries go, how it
// is paid and its name (src/lib/shop-setup.ts).
const openShop = async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  if ((await shopSetup(req.scope)).setup.ready) return next()
  return refuse(res, 409, "SHOP_NOT_READY", "The shop is not taking orders yet.", "The business finishes setting the shop up in its admin (/app); GET /admin/whisk/setup lists what is missing.")
}

// Password sign-in, sign-up and reset requests, counted per address and per network address.
const rateLimited = async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  const email = String((req.body as any)?.email ?? (req.body as any)?.identifier ?? "").trim().toLowerCase()
  const window = Math.floor(Date.now() / 900_000)
  const [byEmail, byIp] = await Promise.all([
    email ? kv().incr(`login:${email}:${window}`, 900) : Promise.resolve(0),
    kv().incr(`login-ip:${req.ip}:${window}`, 900),
  ])
  const limit = limitFor(req.originalUrl.split("?")[0])
  if (byEmail > limit.perEmail || byIp > limit.perIp) {
    res.set("retry-after", "900")
    return refuse(res, 429, "RATE_LIMITED", "Too many tries.", "Wait fifteen minutes, or sign in with an emailed code.")
  }
  // The password email links back to the site it was asked for on (src/subscribers/password-reset.ts).
  const host = requestHost(req.headers)
  if (email && host && req.originalUrl.includes("/reset-password")) await kv().set(`reset-host:${email}`, host, 900)
  next()
}

let astro: Promise<{ handler: (req: unknown, res: unknown, next: unknown, locals?: unknown) => unknown }> | undefined
const storefrontEntry = () => (astro ??= import(pathToFileURL(storefrontServer()).href))

// The site editor (src/lib/pages.ts); this request's own session is left alone.
const cms = async (req: MedusaRequest, res: MedusaResponse) => {
  ;(req as any).session = null
  await cmsRequest(req, res, req.originalUrl)
}

// The body of a form post, up to 64 KB, read within ten seconds.
const readBody = (req: MedusaRequest, limit = 64 * 1024) =>
  new Promise<string | null>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    const timer = setTimeout(() => reject(new Error("the form took too long to arrive")), 10_000)
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > limit) {
        clearTimeout(timer)
        resolve(null)
        req.resume()
      } else chunks.push(c)
    })
    req.on("end", () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString("utf8"))
    })
    req.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })

// A form's entry, kept in the shop's form_entries table (made by src/scripts/setup.ts),
// then back to the page it came from. The edge's challenge (whisk.yaml) keeps robots out.
const formPost = async (req: MedusaRequest, res: MedusaResponse, name: string) => {
  const body = await readBody(req)
  if (body === null) return refuse(res, 413, "BODY_TOO_LARGE", "The form was too large.", "Send less than 64 KB; attach large files by email instead.")
  const fields = formFields(String(req.headers["content-type"] ?? ""), body)
  if (!fields) return refuse(res, 400, "INVALID_REQUEST", "The form could not be read.", "Post the form's fields as a form or as a JSON object.")
  if (!anyFilled(fields)) return refuse(res, 400, "INVALID_REQUEST", "The form was empty.", "Fill in at least one field.")
  const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const [row] = await db("form_entries").insert({ form: name, page: referer ?? null, data: JSON.stringify(fields) }).returning("id").timeout(5_000, { cancel: true })
  // The business hears of it by email; the entry is kept and the customer sent on even when the
  // email cannot go now (src/lib/notify.ts).
  sendEnquiry(req.scope, { id: row?.id ?? row, form: name, page: referer ?? null, fields }, requestHost(req.headers)).catch((e) =>
    req.scope.resolve(ContainerRegistrationKeys.LOGGER).error(`enquiry email: ${(e as Error).message}`),
  )
  res.status(303).set({ location: formReturn(referer, name) }).end()
}

// A middleware with a pattern is mounted the way express mounts a prefix, which takes the matched
// part off req.url; the storefront needs the address as the browser asked for it.
const storefront = async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  const pathname = req.originalUrl.split("?")[0]
  if (isMedusaPath(pathname)) return next()
  req.url = req.originalUrl
  // The storefront signs in and out through the API, whose answers carry the session cookie. This
  // request's own session is left alone, so it neither saves over that session nor sends a
  // cookie of its own after the API's.
  ;(req as any).session = null
  const form = formName(pathname)
  if (form && req.method === "POST") return formPost(req, res, form).catch(next)
  if (sendRedirect(req, res, req.originalUrl)) return
  if (await sendStatic(req, res, pathname)) return
  const [{ handler }, shop] = await Promise.all([storefrontEntry(), storefrontContext(req.scope, requestHost(req.headers))])
  return handler(req, res, next, { shop })
}

// Express mounts a pattern the way it mounts a prefix, and passes over a match that stops partway
// through a path segment, so each pattern below matches the whole of the path it is for.
export default defineMiddlewares({
  routes: [
    { matcher: /^\/admin(\/.*)?$/, middlewares: [staffOnly] },
    { matcher: /^\/auth\/user\/.*/, middlewares: [(_req, res) => refuse(res, 404, "NOT_FOUND", "Staff sign in through Whisk.", "Open /app while signed in to Whisk.")] },
    { matcher: /^\/store\/(b2b\/)?carts\/[^/]+\/complete$/, methods: ["POST"], middlewares: [(req, res, next) => openShop(req, res, next).catch(next)] },
    { matcher: /^\/auth\/customer\/emailpass(\/register|\/reset-password)?$/, methods: ["POST"], middlewares: [rateLimited] },
    { matcher: CMS, bodyParser: false, middlewares: [(req, res, next) => cms(req, res).catch(next)] },
    { matcher: STOREFRONT, bodyParser: false, middlewares: [storefront] },
  ],
})
