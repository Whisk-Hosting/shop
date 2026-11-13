import assert from "node:assert/strict"
import http from "node:http"
import { test } from "node:test"
import { engineContext, storefrontFrom } from "../src/lib/front"
import { adminFile } from "../src/lib/pages"
import { handle, startFront } from "../src/front"

const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url")
const context = { api: "http://127.0.0.1:8080", publishableKey: "pk_1", regionId: "reg_1", currency: "nzd", market: { key: "nz" } }

test("the storefront's context is read from the server's header", () => {
  assert.deepEqual(storefrontFrom(encode(context)), context)
  assert.deepEqual(storefrontFrom([encode(context)]), context)
  assert.equal(storefrontFrom(undefined), null)
  assert.equal(storefrontFrom("not base64!"), null)
  assert.equal(storefrontFrom(encode({ ...context, api: 1 })), null)
  assert.equal(storefrontFrom(encode([1])), null)
  assert.equal(storefrontFrom(Buffer.from("{").toString("base64url")), null)
})

test("the front answers a page without the storefront's context as unavailable", async () => {
  const server = startFront(0)
  await new Promise((ok) => server.once("listening", ok))
  const { port } = server.address() as { port: number }
  try {
    const status = await new Promise<number>((ok, fail) =>
      http.get(`http://127.0.0.1:${port}/about`, (res) => {
        res.resume()
        ok(res.statusCode ?? 0)
      }).on("error", fail),
    )
    assert.equal(status, 503)
  } finally {
    server.close()
  }
})

test("a shared engine's context has the storefront call the engine as the app", () => {
  assert.deepEqual(engineContext({ ...context, api: "" }, "http://10.0.3.1:9300/", "app_1"), { ...context, api: "http://10.0.3.1:9300", app: "app_1" })
  assert.equal(engineContext({ ...context, regionId: 1 }, "http://10.0.3.1:9300", "app_1"), null)
  assert.equal(engineContext(null, "http://10.0.3.1:9300", "app_1"), null)
})

test("the admin's built files are named plainly or not at all", () => {
  assert.equal(adminFile("/app/assets/a.js"), "assets/a.js")
  assert.equal(adminFile("/app"), null)
  assert.equal(adminFile("/app/"), null)
  assert.equal(adminFile("/app/index.html"), null)
  assert.equal(adminFile("/app/orders/1"), "orders/1")
  assert.equal(adminFile("/app/../x"), null)
  assert.equal(adminFile("/app/.env"), null)
  assert.equal(adminFile("/app/a\\b"), null)
  assert.equal(adminFile("/app/a//b"), null)
})

test("beside a shared engine the front asks it for the storefront's context as the app", async () => {
  const seen: http.IncomingHttpHeaders[] = []
  const urls: string[] = []
  const engine = http.createServer((req, res) => {
    seen.push(req.headers)
    urls.push(req.url ?? "")
    res.writeHead(req.headers["x-whisk-shop-app"] === "app_1" ? 200 : 403, { "content-type": "application/json" })
    res.end(JSON.stringify({ ...context, api: "" }))
  })
  engine.listen(0, "127.0.0.1")
  await new Promise((ok) => engine.once("listening", ok))
  const enginePort = (engine.address() as { port: number }).port
  process.env.WHISK_APP_ID = "app_1"
  const front = http.createServer((req, res) => {
    // Whether the storefront is built or not, reaching it means the context was had.
    handle(req, res, `http://127.0.0.1:${enginePort}`).catch(() => {
      if (!res.headersSent) res.writeHead(299)
      res.end()
    })
  })
  front.listen(0, "127.0.0.1")
  await new Promise((ok) => front.once("listening", ok))
  const port = (front.address() as { port: number }).port
  const get = (path: string, headers: http.OutgoingHttpHeaders = {}) =>
    new Promise<number>((ok, fail) =>
      http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
        res.resume()
        ok(res.statusCode ?? 0)
      }).on("error", fail),
    )
  try {
    assert.equal(await get("/health/ready"), 200)
    assert.notEqual(await get("/about", { "x-forwarded-host": "shop.example", "x-whisk-storefront": "forged" }), 503)
    assert.equal(urls[0], "/whisk-engine/storefront?host=shop.example")
    assert.equal(seen[0]["x-whisk-shop-app"], "app_1")
  } finally {
    front.close()
    engine.close()
    delete process.env.WHISK_APP_ID
  }
})
