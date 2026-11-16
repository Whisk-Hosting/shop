// Who Whisk's edge says is here (CONTRACT.md §4), read from its headers. Pure.

// An agent is a coding agent reaching the shop as the person it acts for.
export type Agent = { id: string; name: string }

export type Person = { id: string; email: string; name: string; audience: string; roles: string[]; agent: Agent | null }

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name]
  return (Array.isArray(v) ? v[0] : v) ?? ""
}

export const personFrom = (h: Record<string, string | string[] | undefined>): Person => ({
  id: header(h, "x-whisk-user-id"),
  email: header(h, "x-whisk-email").toLowerCase(),
  name: header(h, "x-whisk-name"),
  audience: header(h, "x-whisk-audience"),
  roles: header(h, "x-whisk-roles").split(",").map((r) => r.trim()).filter(Boolean),
  agent: header(h, "x-whisk-agent") ? { id: header(h, "x-whisk-agent-id"), name: header(h, "x-whisk-agent") } : null,
})

// Who may run the shop: anyone on the business's team except a guest. Billing contacts and
// members included; the admin has no finer roles (Medusa's are a paid licence, not used here).
export const isStaff = (p: Person) => p.audience === "team" && !!p.id && !!p.email && p.roles.some((r) => r !== "guest")
