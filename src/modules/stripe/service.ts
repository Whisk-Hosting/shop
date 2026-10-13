// Medusa's Stripe provider, with two additions. It makes its own webhook when nobody set its secret
// (src/lib/stripe-webhook.ts): on start it finds the endpoint whose secret the shop holds, or
// makes one at /hooks/payment/stripe_stripe, and each delivery is checked with that secret. If
// Stripe or the database cannot be reached, the shop starts anyway and tries again at the next
// delivery, a minute later at the soonest. And with test keys beside the shop's own, it runs a
// provider for each and sends each call to the right one (src/lib/stripe-mode.ts).
import { Pool } from "pg"
import StripeProviderService from "@medusajs/payment-stripe/dist/services/stripe-provider"
import type {
  AuthorizePaymentInput, CancelPaymentInput, CapturePaymentInput, CreateAccountHolderInput, DeleteAccountHolderInput,
  DeletePaymentInput, GetPaymentStatusInput, InitiatePaymentInput, ListPaymentMethodsInput, ProviderWebhookPayload,
  RefundPaymentInput, RetrievePaymentInput, SavePaymentMethodInput, UpdateAccountHolderInput, UpdatePaymentInput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { databaseFrom } from "../../lib/settings"
import {
  endpointForm, managesWebhook, sealKeyFrom, secretName, seal, unseal, webhookPlan, webhookUrl, STRIPE_EVENTS,
  type Endpoint, type Kept,
} from "../../lib/stripe-webhook"
import { eventLivemode, livemodeOf, modeFrom, pairFor, pairsFrom, switchable, type Pairs, type Which } from "../../lib/stripe-mode"

type Logger = { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }

const STRIPE = "https://api.stripe.com/v1"
const RETRY_MS = 60_000
// Deadlines on the shop's own queries are pg's query_timeout, kept by the client: a pooler in front
// of the database may refuse statement_timeout as a startup parameter.

const stripe = async <T>(base: string, apiKey: string, method: "GET" | "POST" | "DELETE", path: string, body?: string): Promise<T> => {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) {
    const why = json.error?.message ?? `HTTP ${res.status}`
    throw new Error(res.status === 401 || res.status === 403
      ? `Stripe refused the ${apiKey.includes("_live_") ? "live" : "test"} key for webhook endpoints (${why}). Use the secret key, or give a restricted key Webhook Endpoints: Write.`
      : `Stripe ${method} ${path} answered ${res.status}: ${why}`)
  }
  return json
}

// Makes sure the account has the shop's endpoint and returns its secret. One server at a time,
// under a row lock, so two starting together make one endpoint.
export const ensureWebhook = async (env: Record<string, string | undefined>, apiKey: string, logger: Logger, base = STRIPE): Promise<string> => {
  const key = sealKeyFrom(env.WHISK_DELIVERY_KEY)!
  const url = webhookUrl(env.WHISK_PUBLIC_URL!)
  const name = secretName(apiKey)
  const db = databaseFrom(env.DATABASE_URL!)
  const ssl = (db.driverOptions.connection as { ssl: unknown }).ssl
  const pool = new Pool({ connectionString: db.url, ssl: ssl as never, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 30_000 })
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query("insert into shop_secrets (name) values ($1) on conflict (name) do nothing", [name])
    const row = await client.query<{ value: string | null }>("select value from shop_secrets where name = $1 for update", [name])
    const stored = unseal(key, row.rows[0]?.value)
    const { data } = await stripe<{ data: Endpoint[] }>(base, apiKey, "GET", "/webhook_endpoints?limit=100")
    const plan = webhookPlan(data, url, stored?.id ?? null)
    for (const id of plan.remove) {
      await stripe(base, apiKey, "DELETE", `/webhook_endpoints/${encodeURIComponent(id)}`)
      logger.info(`stripe: removed webhook endpoint ${id} at ${url}, whose secret the shop does not hold`)
    }
    let kept: Kept
    if (plan.keep && stored) {
      if (plan.update) {
        await stripe(base, apiKey, "POST", `/webhook_endpoints/${encodeURIComponent(plan.keep)}`, endpointForm(plan.update))
        logger.info(`stripe: updated webhook endpoint ${plan.keep} to ${url}`)
      }
      kept = stored
    } else {
      const made = await stripe<{ id: string; secret: string }>(base, apiKey, "POST", "/webhook_endpoints",
        endpointForm({ url, enabled_events: STRIPE_EVENTS, description: "Whisk shop" }))
      kept = { id: made.id, secret: made.secret }
      await client.query("update shop_secrets set value = $2, updated_at = now() where name = $1", [name, seal(key, kept)])
      logger.info(`stripe: made webhook endpoint ${made.id} at ${url}`)
    }
    await client.query("commit")
    return kept.secret
  } catch (e) {
    await client.query("rollback").catch(() => {})
    throw e
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

type Options = { apiKey: string; webhookSecret?: string; [k: string]: unknown }

// The mode the shop is in, from the store's metadata, read at most every fifteen seconds; while
// the database cannot say, the last answer, or the shop's own keys.
let mode: { which: Which; at: number } = { which: "main", at: 0 }
let modePool: Pool | null = null
const currentMode = async (pairs: Pairs, logger: Logger): Promise<Which> => {
  if (!switchable(pairs) || Date.now() - mode.at < 15_000) return switchable(pairs) ? mode.which : "main"
  try {
    if (!modePool) {
      const db = databaseFrom(process.env.DATABASE_URL ?? "")
      const ssl = (db.driverOptions.connection as { ssl: unknown }).ssl
      modePool = new Pool({ connectionString: db.url, ssl: ssl as never, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 5_000, idleTimeoutMillis: 30_000 })
    }
    const r = await modePool.query<{ metadata: Record<string, unknown> | null }>("select metadata from store where deleted_at is null order by created_at limit 1")
    mode = { which: modeFrom(r.rows[0]?.metadata, pairs), at: Date.now() }
  } catch (e) {
    logger.warn(`stripe: the shop's mode could not be read, so it stays ${mode.which}: ${(e as Error).message}`)
    mode = { ...mode, at: Date.now() }
  }
  return mode.which
}

// One mode's provider: Medusa's own, with the webhook the shop keeps for that key.
class ModeProvider extends StripeProviderService {
  private secret_: Promise<string> | null = null
  private failedAt = 0

  constructor(cradle: Record<string, unknown>, options: Options, private readonly logger_: Logger, private readonly manual: string | undefined) {
    super(cradle, options as never)
    if (managesWebhook(process.env, manual, process.argv.includes("build"))) void this.webhookSecret()
  }

  private webhookSecret(): Promise<string> {
    if (!this.secret_ && Date.now() - this.failedAt >= RETRY_MS) {
      this.secret_ = ensureWebhook(process.env, (this.options_ as Options).apiKey, this.logger_).catch((e: Error) => {
        this.logger_.error(`stripe: the shop's webhook could not be set up: ${e.message}`)
        this.secret_ = null
        this.failedAt = Date.now()
        return ""
      })
    }
    return this.secret_ ?? Promise.resolve("")
  }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    const options = this.options_ as Options
    options.webhookSecret = managesWebhook(process.env, this.manual) ? await this.webhookSecret() : this.manual ?? ""
    return super.getWebhookActionAndData(payload)
  }
}

export default class WhiskStripeService extends StripeProviderService {
  private readonly pairs: Pairs
  private readonly providers: Record<Which, ModeProvider | null>
  private readonly logger_: Logger

  constructor(cradle: Record<string, unknown>, options: Options) {
    super(cradle, options as never)
    this.logger_ = (cradle.logger as Logger) ?? console
    this.pairs = pairsFrom(process.env)
    const env = process.env
    const manualMain = env.STRIPE_API_KEY ? env.STRIPE_WEBHOOK_SECRET : env.STRIPE_TEST_WEBHOOK_SECRET
    this.providers = {
      main: new ModeProvider(cradle, { ...options, apiKey: this.pairs.main?.secret ?? options.apiKey }, this.logger_, manualMain || undefined),
      test: this.pairs.test ? new ModeProvider(cradle, { ...options, apiKey: this.pairs.test.secret }, this.logger_, env.STRIPE_TEST_WEBHOOK_SECRET || undefined) : null,
    }
  }

  private async current(): Promise<ModeProvider> {
    return this.providers[await currentMode(this.pairs, this.logger_)] ?? this.providers.main!
  }

  // The provider of the mode a payment, customer or event was made in.
  private async of(livemode: unknown): Promise<ModeProvider> {
    const which = pairFor(livemode, await currentMode(this.pairs, this.logger_), this.pairs)
    return this.providers[which] ?? this.providers.main!
  }

  async initiatePayment(input: InitiatePaymentInput) {
    const p = await this.current()
    // A customer is kept per mode: one made in the other mode is left out of this payment.
    const holder = input.context?.account_holder?.data
    const mine = await this.of(livemodeOf(holder))
    const context = holder && mine !== p ? { ...input.context, account_holder: undefined } : input.context
    return p.initiatePayment({ ...input, context } as InitiatePaymentInput)
  }
  async getPaymentStatus(input: GetPaymentStatusInput) { return (await this.of(livemodeOf(input.data))).getPaymentStatus(input) }
  async authorizePayment(input: AuthorizePaymentInput) { return (await this.of(livemodeOf(input.data))).authorizePayment(input) }
  async cancelPayment(input: CancelPaymentInput) { return (await this.of(livemodeOf(input.data))).cancelPayment(input) }
  async capturePayment(input: CapturePaymentInput) { return (await this.of(livemodeOf(input.data))).capturePayment(input) }
  async deletePayment(input: DeletePaymentInput) { return (await this.of(livemodeOf(input.data))).deletePayment(input) }
  async refundPayment(input: RefundPaymentInput) { return (await this.of(livemodeOf(input.data))).refundPayment(input) }
  async retrievePayment(input: RetrievePaymentInput) { return (await this.of(livemodeOf(input.data))).retrievePayment(input) }
  async updatePayment(input: UpdatePaymentInput) { return (await this.of(livemodeOf(input.data))).updatePayment(input) }
  async createAccountHolder(input: CreateAccountHolderInput) {
    const p = await this.current()
    const held = input.context?.account_holder?.data
    // A customer from the other mode is made again in this one.
    const context = held && (await this.of(livemodeOf(held))) !== p ? { ...input.context, account_holder: undefined } : input.context
    return p.createAccountHolder({ ...input, context } as CreateAccountHolderInput)
  }
  async updateAccountHolder(input: UpdateAccountHolderInput) { return (await this.of(livemodeOf(input.context?.account_holder?.data))).updateAccountHolder(input) }
  async deleteAccountHolder(input: DeleteAccountHolderInput) { return (await this.of(livemodeOf(input.context?.account_holder?.data))).deleteAccountHolder(input) }
  async listPaymentMethods(input: ListPaymentMethodsInput) { return (await this.of(livemodeOf(input.context?.account_holder?.data))).listPaymentMethods(input) }
  async savePaymentMethod(input: SavePaymentMethodInput) { return (await this.of(livemodeOf(input.context?.account_holder?.data))).savePaymentMethod(input) }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    return (await this.of(eventLivemode(payload.rawData))).getWebhookActionAndData(payload)
  }
}
