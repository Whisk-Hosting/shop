// GET /admin/whisk/setup: what the shop still needs from the business, each item with where it is
// done and how, whether it is open for orders, and the details kept so far. POST the details to
// change ({"orders_email": "…", "enquiries_email": "…"}; an empty value removes one), kept in the
// store's metadata, so nothing needs a deploy (src/lib/shop-setup.ts). The admin's setup card
// (src/admin/widgets/shop-setup.tsx) and an agent setting up the shop both use it.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { changesFrom, setupOf } from "../../../../lib/shop-setup"
import { forgetContexts, setupFacts, shopSetup } from "../../../../lib/shop"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  return res.json((await shopSetup(req.scope)).setup)
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const changes = changesFrom(req.body)
  if ("problems" in changes) {
    return res.status(400).json({ error: { code: "INVALID_REQUEST", message: changes.problems.join(" "), fix: "Correct each detail named and send them again.", details: { problems: changes.problems } } })
  }
  const stores = req.scope.resolve(Modules.STORE)
  const [store] = await stores.listStores({}, { take: 1 })
  const merged: Record<string, unknown> = { ...(store.metadata ?? {}) }
  for (const [k, v] of Object.entries(changes.set)) {
    if (v === null) delete merged[k]
    else merged[k] = v
  }
  await stores.updateStores(store.id, { metadata: merged })
  forgetContexts()
  return res.json(setupOf(merged, process.env, await setupFacts(req.scope)))
}
