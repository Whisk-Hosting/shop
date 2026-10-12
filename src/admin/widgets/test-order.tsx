// Marks an order paid in Stripe's test mode on its page in the admin (src/api/admin/whisk/stripe).
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { Badge, Container } from "@medusajs/ui"
import { useEffect, useState } from "react"

const TestOrder = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const [test, setTest] = useState(false)
  useEffect(() => {
    fetch(`/admin/whisk/stripe/orders/${encodeURIComponent(data.id)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { test: false }))
      .then((b: { test?: boolean }) => setTest(!!b.test), () => setTest(false))
  }, [data.id])
  if (!test) return null
  return (
    <Container className="px-6 py-4">
      <Badge color="orange">Stripe test payment</Badge>
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: "order.details.before" })

export default TestOrder
