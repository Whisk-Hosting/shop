import { test } from "node:test"
import assert from "node:assert/strict"
import { alternatesOf, bareHost, marketFor, marketFrom, marketOfChannel, marketsFrom, marketSetting, marketUrl, taxLabel } from "../src/lib/market"

test("marketFrom", () => {
  const cases: [Record<string, string | undefined>, Partial<ReturnType<typeof marketFrom>>][] = [
    [{}, { country: "nz", currency: "nzd", taxRate: 15, taxInclusive: true, locale: "en-NZ" }],
    [{ SHOP_COUNTRY: "AU" }, { country: "au", currency: "aud", taxRate: 10, taxInclusive: true, timeZone: "Australia/Sydney" }],
    [{ SHOP_COUNTRY: "au", SHOP_PRICES_INCLUDE_TAX: "false", SHOP_TIME_ZONE: "Australia/Perth" }, { taxInclusive: false, timeZone: "Australia/Perth" }],
    [{ SHOP_PRICES_INCLUDE_TAX: "maybe" }, { taxInclusive: true }],
  ]
  for (const [env, want] of cases) {
    const got = marketFrom(env)
    for (const [k, v] of Object.entries(want)) assert.equal((got as any)[k], v, `${JSON.stringify(env)} ${k}`)
  }
  assert.throws(() => marketFrom({ SHOP_COUNTRY: "us" }), /not one the shop sells in/)
})

test("taxLabel", () => {
  assert.equal(taxLabel({ taxName: "GST", taxInclusive: true }), "Includes GST")
  assert.equal(taxLabel({ taxName: "GST", taxInclusive: false }), "GST")
})

test("marketsFrom", () => {
  const two = marketsFrom({ SHOP_MARKETS: " nz=www.Example.co.nz , au=example.com.au", SHOP_TIME_ZONE_AU: "Australia/Perth", SHOP_PRICES_INCLUDE_TAX: "false" })
  assert.deepEqual(two.map((m) => [m.key, m.host, m.currency, m.timeZone, m.taxInclusive]), [
    ["nz", "example.co.nz", "nzd", "Pacific/Auckland", false],
    ["au", "example.com.au", "aud", "Australia/Perth", false],
  ])
  assert.deepEqual(marketsFrom({ SHOP_COUNTRY: "au" }).map((m) => [m.key, m.host]), [["au", null]])
  assert.deepEqual(marketsFrom({ SHOP_MARKETS: "au=example.com.au", SHOP_PRICES_INCLUDE_TAX: "false", SHOP_PRICES_INCLUDE_TAX_AU: "true" }).map((m) => m.taxInclusive), [true])
  const bad: [Record<string, string>, RegExp][] = [
    [{ SHOP_MARKETS: "nz=a.co.nz", SHOP_COUNTRY: "nz" }, /not both/],
    [{ SHOP_MARKETS: "us=a.com" }, /"us" is not a market/],
    [{ SHOP_MARKETS: "nz" }, /nz needs its domain/],
    [{ SHOP_MARKETS: "nz=a.co.nz, nz=b.co.nz" }, /nz is listed twice/],
    [{ SHOP_MARKETS: "nz=a.co.nz, au=www.a.co.nz" }, /a.co.nz is given to two markets/],
    [{ SHOP_MARKETS: " , " }, /at least one market/],
  ]
  for (const [env, want] of bad) assert.throws(() => marketsFrom(env), want)
})

test("marketFor and marketOfChannel", () => {
  const markets = marketsFrom({ SHOP_MARKETS: "nz=example.co.nz, au=example.com.au" })
  const cases: [string | null, string][] = [
    ["example.com.au", "au"],
    ["WWW.example.com.au:443", "au"],
    ["example.co.nz", "nz"],
    ["shop.acme.whisk.page", "nz"],
    [null, "nz"],
  ]
  for (const [host, want] of cases) assert.equal(marketFor(markets, host).key, want, String(host))
  assert.equal(marketOfChannel(markets, { market: "au" }).key, "au")
  assert.equal(marketOfChannel(markets, null).key, "nz")
  assert.equal(bareHost("www.Example.com."), "example.com")
})

test("marketUrl, alternatesOf and marketSetting", () => {
  const markets = marketsFrom({ SHOP_MARKETS: "nz=example.co.nz, au=example.com.au" })
  assert.equal(marketUrl(markets[1], "https://shop.acme.whisk.page/"), "https://example.com.au")
  assert.equal(marketUrl({ host: null }, "https://shop.acme.whisk.page/"), "https://shop.acme.whisk.page")
  assert.deepEqual(alternatesOf(markets), [{ hreflang: "en-NZ", origin: "https://example.co.nz" }, { hreflang: "en-AU", origin: "https://example.com.au" }])
  assert.deepEqual(alternatesOf(marketsFrom({})), [])
  assert.equal(marketSetting({ SHOP_ORDERS_TO: "a@x", SHOP_ORDERS_TO_AU: "b@x" }, "SHOP_ORDERS_TO", { key: "au" }), "b@x")
  assert.equal(marketSetting({ SHOP_ORDERS_TO: "a@x", SHOP_ORDERS_TO_AU: "b@x" }, "SHOP_ORDERS_TO", { key: "nz" }), "a@x")
})
