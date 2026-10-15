// Makes a new shop ready to sell in its markets (src/lib/market.ts: New Zealand unless
// SHOP_COUNTRY or SHOP_MARKETS says otherwise), and keeps it so on every deploy. It runs after the
// migrations (migrate.ts) and only adds what is missing, so staff changes in the admin are never
// undone. Each market gets: its currency, with tax included in prices or added on top as the
// market says; a region with the market's tax; a sales channel (metadata.market names the
// market) and the storefront key for it; a stock location; standard delivery that staff change in
// the admin; and every payment provider whose keys are set (bank transfer always). The shop gets
// the tables for its own secrets and the website's forms.
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow, createRegionsWorkflow, createSalesChannelsWorkflow, createShippingOptionsWorkflow,
  createShippingProfilesWorkflow, createStockLocationsWorkflow, createTaxRegionsWorkflow, linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow, updateRegionsWorkflow, updateSalesChannelsWorkflow, updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import { paymentProvidersFrom, providerIds, tradeOrdering } from "../lib/settings"
import { channelFor, linkedTo, missingProviders, storeName } from "../lib/setup"
import { marketsFrom, type Market } from "../lib/market"

export default async function setup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const stores = container.resolve(Modules.STORE)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  const markets = marketsFrom(process.env)
  const [store] = await stores.listStores({}, { take: 1, relations: ["supported_currencies"] })

  // Store: its name and every market's currency. The currency the shop first sold in stays the
  // default; a new store's (Medusa makes it with euros) becomes the first market's.
  const currencies = store.supported_currencies ?? []
  const firstCurrency = (currencies.find((c) => c.is_default) ?? currencies[0])?.currency_code
  const kept = markets.some((m) => m.currency === firstCurrency)
  const missing = markets.filter((m, i) => markets.findIndex((x) => x.currency === m.currency) === i && !currencies.some((c) => c.currency_code === m.currency))
  const update: Record<string, unknown> = {}
  if (missing.length || !kept) {
    // Medusa sets each listed currency's tax preference, so the ones the shop has keep theirs.
    const preferences = await container.resolve(Modules.PRICING).listPricePreferences({ attribute: "currency_code" })
    const inclusive = (code: string) => preferences.find((p) => p.value === code)?.is_tax_inclusive ?? false
    update.supported_currencies = [
      ...missing.map((m) => ({ currency_code: m.currency, is_default: !kept && m.currency === markets[0].currency, is_tax_inclusive: m.taxInclusive })),
      ...currencies.map((c) => ({
        currency_code: c.currency_code,
        is_default: kept ? c.is_default : c.currency_code === markets[0].currency,
        is_tax_inclusive: inclusive(c.currency_code),
      })),
    ]
  }
  const name = storeName(store.name, process.env.WHISK_APP_NAME)
  if (name !== store.name) update.name = name
  if (Object.keys(update).length) {
    await updateStoresWorkflow(container).run({ input: { selector: { id: store.id }, update } })
    logger.info(`setup: store ${Object.keys(update).join(", ")}`)
  }

  // Delivery's one shipping profile, shared by every market.
  let [profile] = await fulfillment.listShippingProfiles({ type: "default" }, { take: 1 })
  if (!profile) {
    const { result } = await createShippingProfilesWorkflow(container).run({ input: { data: [{ name: "Default", type: "default" }] } })
    profile = result[0]
  }

  // The market selling in the currency the shop first sold in keeps the store's original sales
  // channel; in a new shop, the first market does.
  const original = kept ? firstCurrency : null
  for (const [i, market] of markets.entries()) {
    await setupMarket(container, market, { store, profileId: profile.id, first: i === 0, currency: original })
  }
  await tables(container)
}

type StoreRow = { id: string; default_sales_channel_id?: string | null; default_location_id?: string | null }

const setupMarket = async (
  container: MedusaContainer,
  market: Market,
  ctx: { store: StoreRow; profileId: string; first: boolean; currency: string | null | undefined },
) => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const channels = container.resolve(Modules.SALES_CHANNEL)
  const regions = container.resolve(Modules.REGION)
  const taxes = container.resolve(Modules.TAX)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  // Sales channel.
  const all = await channels.listSalesChannels({}, { select: ["id", "metadata"] })
  const found = channelFor(market, all, { channelId: ctx.store.default_sales_channel_id ?? all[0]?.id, currency: ctx.currency, first: ctx.first })
  let channelId: string
  if (found) {
    channelId = found.id
    if (found.tag) {
      const was = all.find((c) => c.id === found.id)?.metadata ?? {}
      await updateSalesChannelsWorkflow(container).run({ input: { selector: { id: found.id }, update: { metadata: { ...was, market: market.key } } } })
      logger.info(`setup: the store's sales channel sells in ${market.name}`)
    }
  } else {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: all.length ? `Online shop (${market.name})` : "Online shop" }] },
    })
    channelId = result[0].id
    await updateSalesChannelsWorkflow(container).run({ input: { selector: { id: channelId }, update: { metadata: { market: market.key } } } })
    logger.info(`setup: made the ${market.name} sales channel`)
  }
  if (ctx.first && !ctx.store.default_sales_channel_id) {
    await updateStoresWorkflow(container).run({ input: { selector: { id: ctx.store.id }, update: { default_sales_channel_id: channelId } } })
  }

  // Region and its payment providers.
  const wanted = providerIds(paymentProvidersFrom(process.env, tradeOrdering()))
  let [region] = await regions.listRegions({ currency_code: market.currency }, { take: 1 })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: { regions: [{ name: market.name, currency_code: market.currency, countries: [market.country], automatic_taxes: true, is_tax_inclusive: market.taxInclusive, payment_providers: wanted }] },
    })
    region = result[0]
    logger.info(`setup: made the ${market.name} region`)
  } else {
    const { data } = await query.graph({ entity: "region", fields: ["id", "payment_providers.id"], filters: { id: region.id } })
    const have = ((data[0] as any)?.payment_providers ?? []).map((p: { id: string }) => p.id)
    const add = missingProviders(have, wanted)
    if (add.length) {
      await updateRegionsWorkflow(container).run({ input: { selector: { id: region.id }, update: { payment_providers: [...have, ...add] } } })
      logger.info(`setup: ${market.name} region now takes ${add.join(", ")}`)
    }
  }

  // The market's tax.
  const [taxRegion] = await taxes.listTaxRegions({ country_code: market.country }, { take: 1 })
  if (!taxRegion) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: market.country, provider_id: "tp_system", default_tax_rate: { rate: market.taxRate, code: market.taxName, name: market.taxName } }],
    })
    logger.info(`setup: ${market.taxName} at ${market.taxRate}% in ${market.name}`)
  }

  // Stock location, linked to the sales channel and to manual fulfilment.
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id", "sales_channels.id", "fulfillment_sets.id"] })
  let location = linkedTo(locations as any[], channelId) as { id: string; fulfillment_sets?: { id: string }[] | null } | undefined
  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: locations.length ? market.name : "Main", address: { address_1: "", city: "", country_code: market.country.toUpperCase() } }] },
    })
    location = { id: result[0].id, fulfillment_sets: [] }
    await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: location.id }, [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" } })
    await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: location.id, add: [channelId] } })
    if (!ctx.store.default_location_id) {
      await updateStoresWorkflow(container).run({ input: { selector: { id: ctx.store.id }, update: { default_location_id: location.id } } })
      ctx.store.default_location_id = location.id
    }
    logger.info(`setup: made the ${market.name} stock location`)
  }

  // Delivery from the location: one zone (the market's country), standard delivery.
  if (!location.fulfillment_sets?.length) {
    const made = await fulfillment.createFulfillmentSets({
      name: `Delivery (${market.name})`,
      type: "shipping",
      service_zones: [{ name: market.name, geo_zones: [{ country_code: market.country, type: "country" }] }],
    })
    await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: location.id }, [Modules.FULFILLMENT]: { fulfillment_set_id: made.id } })
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "Standard delivery",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: made.service_zones[0].id,
          shipping_profile_id: ctx.profileId,
          type: { label: "Standard", description: "Delivered in 1 to 5 working days.", code: "standard" },
          prices: [{ currency_code: market.currency, amount: market.delivery }, { region_id: region.id, amount: market.delivery }],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    logger.info(`setup: standard delivery across ${market.name}`)
  }

  // The key the storefront sends with every store request in this market.
  const { data: keys } = await query.graph({ entity: "api_key", fields: ["id", "sales_channels.id"], filters: { type: "publishable", revoked_at: null } as any })
  if (!linkedTo(keys as any[], channelId)) {
    const { result } = await createApiKeysWorkflow(container).run({ input: { api_keys: [{ title: keys.length ? `Storefront (${market.name})` : "Storefront", type: "publishable", created_by: "" }] } })
    await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: result[0].id, add: [channelId] } })
    logger.info(`setup: made the ${market.name} storefront's key`)
  }
}

async function tables(container: MedusaContainer) {
  // Secrets the shop makes for itself, sealed with its own key: Stripe's webhook signing secret
  // (src/modules/stripe).
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await pg.raw(`create table if not exists shop_secrets (
    name text primary key,
    value text,
    updated_at timestamptz not null default now()
  )`)

  // The website's form entries (src/api/middlewares.ts, formPost).
  await pg.raw(`create table if not exists form_entries (
    id bigint generated always as identity primary key,
    form text not null,
    page text,
    data jsonb not null,
    created_at timestamptz not null default now()
  )`)
}
