// GET /admin/whisk/stripe: whether the shop can switch Stripe between live and test, and which it
// is in. POST {"mode": "live" | "test"} switches it, kept in the store's metadata (stripe_mode),
// so the next payment uses it within fifteen seconds and no deploy is needed (src/lib/stripe-mode.ts).
// The admin's Store page shows the switch (src/admin/widgets/stripe-mode.tsx).
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { modeFrom, pairsFrom, switchable } from "../../../../lib/stripe-mode"

const refuse = (res: MedusaResponse, status: number, code: string, message: string, fix: string) =>
  res.status(status).json({ error: { code, message, fix } })

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const pairs = pairsFrom(process.env)
  const [store] = await req.scope.resolve(Modules.STORE).listStores({}, { take: 1 })
  return res.json({ switchable: switchable(pairs), mode: modeFrom(store?.metadata, pairs) === "test" ? "test" : "live" })
}

export const POST = async (req: MedusaRequest<{ mode?: unknown }>, res: MedusaResponse) => {
  const mode = (req.body as { mode?: unknown } | undefined)?.mode
  if (mode !== "live" && mode !== "test") return refuse(res, 400, "INVALID_REQUEST", "The mode is live or test.", 'Send {"mode": "live"} or {"mode": "test"}.')
  const pairs = pairsFrom(process.env)
  if (mode === "test" && !switchable(pairs)) {
    return refuse(res, 400, "INVALID_REQUEST", "The shop has no Stripe test keys.", "Set STRIPE_TEST_API_KEY and STRIPE_TEST_PUBLISHABLE_KEY beside the shop's Stripe keys, then deploy.")
  }
  const stores = req.scope.resolve(Modules.STORE)
  const [store] = await stores.listStores({}, { take: 1 })
  await stores.updateStores(store.id, { metadata: { ...(store.metadata ?? {}), stripe_mode: mode } })
  return res.json({ switchable: switchable(pairs), mode })
}
