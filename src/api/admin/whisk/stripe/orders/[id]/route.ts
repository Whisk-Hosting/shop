// GET /admin/whisk/stripe/orders/:id: whether an order was paid in Stripe's test mode, which the
// admin's order page shows (src/admin/widgets/test-order.tsx).
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { testOrder } from "../../../../../../lib/stripe-mode"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "payment_collections.payments.provider_id", "payment_collections.payments.data"],
    filters: { id: req.params.id },
  })
  if (!data[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "There is no such order.", fix: "Open the order from the admin's list of orders." } })
  return res.json({ test: testOrder(data[0] as never) })
}
