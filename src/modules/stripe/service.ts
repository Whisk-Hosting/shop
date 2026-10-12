// Medusa's Stripe provider, which also makes its own webhook when nobody set STRIPE_WEBHOOK_SECRET
// (src/lib/stripe-webhook.ts). On start it finds the endpoint whose secret the shop holds, or
// makes one at /hooks/payment/stripe_stripe, and each delivery is checked with that secret. If
// Stripe or the database cannot be reached, the shop starts anyway and tries again at the next
// delivery, a minute later at the soonest.
import { Pool } from "pg"
import StripeProviderService from "@medusajs/payment-stripe/dist/services/stripe-provider"
import type { ProviderWebhookPayload, WebhookActionResult } from "@medusajs/framework/types"
import { databaseFrom } from "../../lib/settings"
import {
  endpointForm, managesWebhook, sealKeyFrom, secretName, seal, unseal, webhookPlan, webhookUrl, STRIPE_EVENTS,
  type Endpoint, type Kept,
} from "../../lib/stripe-webhook"

type Logger = { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }

const STRIPE = "https://api.stripe.com/v1"
const RETRY_MS = 60_000

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
      ? `Stripe refused STRIPE_API_KEY for webhook endpoints (${why}). Use the secret key, or give a restricted key Webhook Endpoints: Write.`
      : `Stripe ${method} ${path} answered ${res.status}: ${why}`)
  }
  return json
}

// Makes sure the account has the shop's endpoint and returns its secret. One server at a time,
// under a row lock, so two starting together make one endpoint.
export const ensureWebhook = async (env: Record<string, string | undefined>, logger: Logger, base = STRIPE): Promise<string> => {
  const apiKey = env.STRIPE_API_KEY!
  const key = sealKeyFrom(env.WHISK_DELIVERY_KEY)!
  const url = webhookUrl(env.WHISK_PUBLIC_URL!)
  const name = secretName(apiKey)
  const db = databaseFrom(env.DATABASE_URL!)
  const ssl = (db.driverOptions.connection as { ssl: unknown }).ssl
  const pool = new Pool({ connectionString: db.url, ssl: ssl as never, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 })
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

export default class WhiskStripeService extends StripeProviderService {
  private secret_: Promise<string> | null = null
  private failedAt = 0
  private readonly logger_: Logger

  constructor(cradle: Record<string, unknown>, options: Options) {
    super(cradle, options as never)
    this.logger_ = (cradle.logger as Logger) ?? console
    if (managesWebhook(process.env, process.argv.includes("build"))) void this.webhookSecret()
  }

  private webhookSecret(): Promise<string> {
    if (!this.secret_ && Date.now() - this.failedAt >= RETRY_MS) {
      this.secret_ = ensureWebhook(process.env, this.logger_).catch((e: Error) => {
        this.logger_.error(`stripe: the shop's webhook could not be set up: ${e.message}`)
        this.secret_ = null
        this.failedAt = Date.now()
        return ""
      })
    }
    return this.secret_ ?? Promise.resolve("")
  }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    if (managesWebhook(process.env)) {
      const options = this.options_ as Options
      options.webhookSecret = await this.webhookSecret()
    }
    return super.getWebhookActionAndData(payload)
  }
}
