import { test } from "node:test"
import assert from "node:assert/strict"
import { decodeContent, imageUrl, isUploadKey, uploadId, uploadKey } from "../src/lib/files"
import { channelFor, linkedTo, missingProviders, storeName } from "../src/lib/setup"

test("uploads are told apart from bucket keys", () => {
  assert.equal(uploadKey("01J"), "upload:01J")
  assert.equal(isUploadKey("upload:01J"), true)
  assert.equal(isUploadKey("products/a.png"), false)
  assert.equal(uploadId(uploadKey("01J")), "01J")
})

test("pictures are served resized, other files by their media address", () => {
  assert.equal(imageUrl("https://kiwi.whisk.page/", "01J", "image/png"), "https://kiwi.whisk.page/.whisk/img/01J")
  assert.equal(imageUrl("https://kiwi.whisk.page", "01J", "application/pdf"), "https://kiwi.whisk.page/.whisk/media/01J")
})

test("decodeContent reads base64, text and binary strings", () => {
  assert.deepEqual(decodeContent(Buffer.from("hello").toString("base64"), "image/png"), Buffer.from("hello"))
  assert.deepEqual(decodeContent("a,b\n1,2", "text/csv"), Buffer.from("a,b\n1,2"))
  assert.deepEqual(decodeContent("ÿ\u0001!", "image/png"), Buffer.from([0xff, 0x01, 0x21]))
})

test("setup names a new store after its app and adds missing providers", () => {
  const cases: [string | null, string | undefined, string][] = [
    ["Medusa Store", "acme-tools", "Acme Tools"],
    [null, "kiwi-goods", "Kiwi Goods"],
    ["Our Shop", "kiwi-goods", "Our Shop"],
    ["Medusa Store", undefined, "Medusa Store"],
    [null, undefined, "Shop"],
  ]
  for (const [current, app, want] of cases) assert.equal(storeName(current, app), want)
  assert.deepEqual(missingProviders(["pp_system_default"], ["pp_system_default", "pp_stripe_stripe"]), ["pp_stripe_stripe"])
  assert.deepEqual(missingProviders(["pp_x", "pp_system_default"], ["pp_system_default"]), [])
})

test("channelFor", () => {
  const nz = { key: "nz", currency: "nzd" }
  const au = { key: "au", currency: "aud" }
  const plain = [{ id: "sc_1", metadata: null }]
  const cases: [string, { key: string; currency: string }, { id: string; metadata?: any }[], { channelId: string; currency: string | null; first: boolean }, { id: string; tag: boolean } | null][] = [
    ["a new shop's first market takes the default channel", nz, plain, { channelId: "sc_1", currency: null, first: true }, { id: "sc_1", tag: true }],
    ["a later market gets its own", au, plain, { channelId: "sc_1", currency: null, first: false }, null],
    ["an Australian shop adding New Zealand keeps its channel for Australia, listed second", au, plain, { channelId: "sc_1", currency: "aud", first: false }, { id: "sc_1", tag: true }],
    ["and New Zealand, listed first, does not take it", nz, plain, { channelId: "sc_1", currency: "aud", first: true }, null],
    ["a tagged channel is found", au, [{ id: "sc_1", metadata: { market: "nz" } }, { id: "sc_2", metadata: { market: "au" } }], { channelId: "sc_1", currency: "nzd", first: false }, { id: "sc_2", tag: false }],
    ["a tagged default is not taken again", au, [{ id: "sc_1", metadata: { market: "nz" } }], { channelId: "sc_1", currency: "aud", first: false }, null],
  ]
  for (const [name, market, channels, defaults, want] of cases) assert.deepEqual(channelFor(market, channels, defaults), want, name)
})

test("linkedTo", () => {
  const rows = [{ id: "k1", sales_channels: [{ id: "sc_1" }] }, { id: "k2", sales_channels: [{ id: "sc_2" }] }, { id: "k3", sales_channels: null }]
  assert.equal(linkedTo(rows, "sc_2")?.id, "k2")
  assert.equal(linkedTo(rows, "sc_3"), undefined)
})
