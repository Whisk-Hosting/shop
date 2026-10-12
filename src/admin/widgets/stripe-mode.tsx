// The switch between Stripe's live and test modes, on the admin's Store page, when the shop has
// test keys beside its own (src/api/admin/whisk/stripe).
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Label, Switch, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"

type State = { switchable: boolean; mode: "live" | "test" }

const call = async (init?: RequestInit): Promise<State> => {
  const res = await fetch("/admin/whisk/stripe", { credentials: "include", headers: { "content-type": "application/json" }, ...init })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? `The shop answered ${res.status}.`)
  return body as State
}

const StripeMode = () => {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    call().then(setState, (e: Error) => setError(e.message))
  }, [])
  if (!state?.switchable && !error) return null
  const flip = async (test: boolean) => {
    setBusy(true)
    setError("")
    try {
      setState(await call({ method: "POST", body: JSON.stringify({ mode: test ? "test" : "live" }) }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Container className="flex items-center justify-between px-6 py-4">
      <Heading level="h2">Stripe</Heading>
      <div className="flex items-center gap-x-2">
        {error && <Text size="small" className="text-ui-fg-error">{error}</Text>}
        <Label htmlFor="stripe-test-mode">Test mode</Label>
        <Switch id="stripe-test-mode" checked={state?.mode === "test"} disabled={busy || !state} onCheckedChange={flip} />
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: "store.details.after" })

export default StripeMode
