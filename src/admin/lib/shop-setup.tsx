// The shop's setup card: what the shop still needs before it takes orders, and the business's own
// details, entered here (src/api/admin/whisk/setup, src/lib/shop-setup.ts). Above the orders it
// shows only while something required is missing; on the Store page it is always there, to change
// the details later.
import { Badge, Button, Container, Heading, Input, Label, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"

type Item = { key: string; label: string; required: boolean; done: boolean | null; where: string; fix: string; steps: string[] }
type Setup = { ready: boolean; items: Item[]; values: Record<string, string> }

const FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: "orders_email", label: "Email each new order to", placeholder: "orders@example.co.nz" },
  { key: "enquiries_email", label: "Email each enquiry to", placeholder: "hello@example.co.nz" },
  { key: "business_name", label: "Business name", placeholder: "Example Ltd" },
  { key: "gst_number", label: "GST number", placeholder: "123-456-789" },
  { key: "business_phone", label: "Phone", placeholder: "09 123 4567", type: "tel" },
  { key: "business_address", label: "Address", placeholder: "1 Queen Street, Auckland 1010" },
  { key: "bank_account_name", label: "Bank account name (for bank transfer)", placeholder: "Example Ltd" },
  { key: "bank_account_number", label: "Bank account number", placeholder: "12-3456-7890123-00" },
]

const call = async (init?: RequestInit): Promise<Setup> => {
  const res = await fetch("/admin/whisk/setup", { credentials: "include", headers: { "content-type": "application/json" }, ...init })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? `The shop answered ${res.status}.`)
  return body as Setup
}

const status = (i: Item) =>
  i.done === true ? <Badge color="green" size="2xsmall">Done</Badge> : i.done === null ? <Badge color="grey" size="2xsmall">Check</Badge> : i.required ? <Badge color="red" size="2xsmall">Needed</Badge> : <Badge color="orange" size="2xsmall">Recommended</Badge>

export const ShopSetup = ({ always }: { always: boolean }) => {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    call().then((s) => {
      setSetup(s)
      setDraft(s.values)
    }, (e: Error) => setError(e.message))
  }, [])
  if (!setup && !error) return null
  if (setup?.ready && !always) return null
  const save = async () => {
    setBusy(true)
    setError("")
    setSaved(false)
    try {
      const changed = Object.fromEntries(FIELDS.filter((f) => (draft[f.key] ?? "") !== (setup?.values[f.key] ?? "")).map((f) => [f.key, draft[f.key] ?? ""]))
      const next = await call({ method: "POST", body: JSON.stringify(changed) })
      setSetup(next)
      setDraft(next.values)
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const open = (setup?.items ?? []).filter((i) => i.done !== true)
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{setup?.ready ? "Shop details" : "Finish setting up your shop"}</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          {setup?.ready
            ? "Your shop is taking orders. Change who hears of orders and enquiries, and the details on your customers' emails, here."
            : "Customers can't check out until everything marked Needed is done."}
        </Text>
      </div>
      {open.length > 0 && (
        <ul className="px-6 py-4 flex flex-col gap-y-3">
          {open.map((i) => (
            <li key={i.key}>
              <div className="flex items-center gap-x-2">
                {status(i)}
                <Text size="small" weight="plus">{i.label}</Text>
              </div>
              <Text size="small" className="text-ui-fg-subtle">{i.fix}</Text>
            </li>
          ))}
        </ul>
      )}
      <form
        className="px-6 py-4 grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-y-1">
            <Label htmlFor={`setup-${f.key}`} size="small">{f.label}</Label>
            <Input id={`setup-${f.key}`} type={f.type ?? "text"} placeholder={f.placeholder} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          </div>
        ))}
        <div className="md:col-span-2 flex items-center gap-x-3">
          <Button type="submit" size="small" isLoading={busy} disabled={!setup}>Save</Button>
          {saved && <Text size="small" className="text-ui-fg-subtle">Saved.</Text>}
          {error && <Text size="small" className="text-ui-fg-error">{error}</Text>}
        </div>
      </form>
    </Container>
  )
}

