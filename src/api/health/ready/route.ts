// GET /health/ready: the platform's health check (whisk.yaml). The shop is ready when it can
// reach its database and its cache, and the site editor (src/lib/cms.ts) answers, each within a
// few seconds. Medusa's own /health answers
// as soon as the server listens, before either is known to work.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { kv } from "../../../lib/kv"
import { cmsReady } from "../../../lib/cms"

const within = <T>(ms: number, work: Promise<T>) =>
  Promise.race([work, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`no answer in ${ms} ms`)), ms).unref())])

export const AUTHENTICATE = false

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const checks = await Promise.allSettled([
    within(5_000, pg.raw("select 1")),
    within(5_000, kv().get("health")),
    cmsReady(5_000),
  ])
  const failed = checks.flatMap((c, i) => (c.status === "rejected" ? [`${["database", "cache", "cms"][i]}: ${(c.reason as Error).message}`] : []))
  if (failed.length) return res.status(503).json({ ok: false, failed })
  return res.status(200).json({ ok: true })
}
