import assert from "node:assert/strict"
import http from "node:http"
import { test } from "node:test"
import { storefrontFrom } from "../src/lib/front"
import { startFront } from "../src/front"

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
