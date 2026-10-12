// The CMS (Payload, in cms/) runs beside Medusa in the same app: the shop's server starts it on a
// port of this machine's own, keeps it running, and passes /cms (the editor and its API) and
// /_next (the editor's own files) to it (src/api/middlewares.ts). The storefront reads pages from
// it there too (storefront/src/lib/cms.ts). Nothing outside the app reaches that port.
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import http from "node:http"
import path from "node:path"

export const CMS_PORT = Number(process.env.CMS_PORT ?? 9100)
export const cmsAddress = () => `http://127.0.0.1:${CMS_PORT}`

// Where the CMS is: cms/ beside the built server (.medusa/server/cms), or the source's on a
// laptop running `medusa develop` from the shop's folder.
export const cmsDir = (cwd = process.cwd()) => path.resolve(cwd, "cms")

// How long to wait before starting the CMS again after it stops: a second, doubling to a
// minute, so a CMS that cannot start does not spin.
export const restartDelay = (failures: number) => Math.min(60_000, 1_000 * 2 ** Math.max(0, failures - 1))

// The editor's pages are for the business's team; its API answers anyone, and decides itself
// what each may read (published pages) or change (the team, cms/src/access.ts).
export const isEditorPage = (pathname: string) => /^\/cms(\/|$)/.test(pathname) && !/^\/cms\/api(\/|$)/.test(pathname)

// The editor lives inside the shop's admin (src/admin/routes/): opening it on its own goes to the
// admin's section for what was asked for, keeping the page.
export const adminSection = (pathname: string) => {
  const m = /^\/cms\/(collections|globals)\/([a-z-]+)/.exec(pathname)
  if (!m) return "pages"
  if (m[1] === "globals") return "menu"
  return m[2] === "product-pages" || m[2] === "media" ? m[2] : "pages"
}
export const insideAdmin = (url: string) => `/app/${adminSection(url.split("?")[0])}?to=${encodeURIComponent(url)}`

// The headers passed to the CMS: the request's own, less the connection's.
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"])
export const forwardHeaders = (h: http.IncomingHttpHeaders): http.OutgoingHttpHeaders =>
  Object.fromEntries(Object.entries(h).filter(([k, v]) => v !== undefined && !HOP.has(k.toLowerCase())))

let child: ChildProcess | undefined
let failures = 0
let stopping = false

// startCms starts the CMS once per server, and again whenever it stops.
export const startCms = (log: (line: string) => void = (l) => console.log(l)) => {
  if (child || stopping) return
  const dir = cmsDir()
  const next = path.join(dir, "node_modules", "next", "dist", "bin", "next")
  if (!existsSync(next)) return log(`cms: ${dir} has no built CMS, so /cms is not served`)
  const develop = process.argv.includes("develop")
  const started = Date.now()
  child = spawn(process.execPath, [next, develop ? "dev" : "start", "-p", String(CMS_PORT), "-H", "127.0.0.1"], {
    cwd: dir,
    env: { ...process.env, PORT: String(CMS_PORT), NODE_ENV: develop ? "development" : "production", NEXT_TELEMETRY_DISABLED: "1", CMS_SHOP: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  })
  child.on("exit", (code, signal) => {
    child = undefined
    if (stopping) return
    failures = Date.now() - started > 120_000 ? 1 : failures + 1
    log(`cms: stopped (${signal ?? code}); starting again in ${restartDelay(failures) / 1000} s`)
    setTimeout(() => startCms(log), restartDelay(failures)).unref()
  })
}

const stop = () => {
  stopping = true
  child?.kill("SIGTERM")
}
process.once("exit", stop)
process.once("SIGTERM", stop)
process.once("SIGINT", stop)

// cmsReady says whether the CMS answers, within the time given.
export const cmsReady = (ms = 5_000) =>
  new Promise<void>((ok, fail) => {
    const req = http.get(`${cmsAddress()}/cms/api/globals/menus?depth=0`, { timeout: ms }, (res) => {
      res.resume()
      if (res.statusCode === 200) ok()
      else fail(new Error(`answered ${res.statusCode}`))
    })
    req.on("timeout", () => req.destroy(new Error(`no answer in ${ms} ms`)))
    req.on("error", fail)
  })

// proxy passes one request to the CMS and its answer back, streamed both ways. A request that
// waits more than two minutes (a large upload) is cut off.
export const proxy = (req: http.IncomingMessage, res: http.ServerResponse, url: string) =>
  new Promise<void>((done) => {
    const out = http.request(
      `${cmsAddress()}${url}`,
      { method: req.method, headers: forwardHeaders(req.headers), timeout: 120_000 },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
        answer.on("end", done)
        answer.on("error", () => done())
      },
    )
    out.on("timeout", () => out.destroy(new Error("the CMS took too long")))
    out.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(503, { "content-type": "application/json", "retry-after": "5" })
        res.end(JSON.stringify({ error: { code: "CMS_UNAVAILABLE", message: "The site editor is starting.", fix: "Try again in a few seconds.", docs: "https://skill.whisk.run/errors/CMS_UNAVAILABLE" } }))
      } else res.destroy()
      done()
    })
    req.pipe(out)
  })
