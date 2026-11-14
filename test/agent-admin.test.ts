import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ApiLoader } from "@medusajs/framework/http"
import { agentForStaff, personFrom, SETUP_PATH } from "../src/lib/staff"
import "../src/api/middlewares"

const team = { "x-whisk-audience": "team", "x-whisk-roles": "owner", "x-whisk-user-id": "u1", "x-whisk-email": "Ann@b.com", "x-whisk-name": "Ann Lee" }
const agent = { "x-whisk-agent": "Claude", "x-whisk-agent-id": "01JAGENT0000000000000000AA" }

test("an agent acting for a team member may use the admin API", () => {
  assert.deepEqual(personFrom({ ...team, ...agent }).agent, { id: "01JAGENT0000000000000000AA", name: "Claude" })
  assert.equal(personFrom(team).agent, null)
  assert.equal(agentForStaff(personFrom({ ...team, ...agent })), true)
  // A person's own browser still needs its session.
  assert.equal(agentForStaff(personFrom(team)), false)
  // An agent may only what its person may.
  assert.equal(agentForStaff(personFrom({ ...team, ...agent, "x-whisk-roles": "guest" })), false)
  assert.equal(agentForStaff(personFrom({ ...agent, "x-whisk-audience": "anonymous" })), false)
  assert.equal(agentForStaff(personFrom({ ...team, "x-whisk-agent": "Claude" })), false)
})

// A Medusa that answers staffFor with one user already made for the person.
const scope = {
  resolve: (key: string) =>
    key === "auth"
      ? {
          listProviderIdentities: async () => [{ auth_identity_id: "ai1" }],
          retrieveAuthIdentity: async () => ({ id: "ai1", app_metadata: { user_id: "user_1" } }),
        }
      : { listUsers: async () => [{ id: "user_1" }] },
}

const check = Object.defineProperty(
  (_req: unknown, res: { status: number }, _next: unknown) => {
    res.status = 401
  },
  "name",
  { value: "authMiddleware" },
)

const run = (headers: Record<string, string>, route = "/admin", method = "GET", url = "/admin/products") =>
  new Promise<{ req: any; res: { status: number }; error: unknown }>((done) => {
    const wrapped = ApiLoader.traceMiddleware!(check as any, { route }) as any
    const req: any = { headers, scope, method, originalUrl: url }
    const res = { status: 200 }
    let finished = false
    const end = (error?: unknown) => {
      if (!finished) done({ req, res, error })
      finished = true
    }
    Promise.resolve(wrapped(req, res, end)).then(() => setTimeout(() => end(), 0))
  })

test("an agent's admin request is signed in as its person, for that request only", async () => {
  const { req, res, error } = await run({ ...team, ...agent })
  assert.equal(error, undefined)
  assert.equal(res.status, 200)
  assert.deepEqual(req.auth_context, { actor_id: "user_1", actor_type: "user", auth_identity_id: "ai1", app_metadata: { user_id: "user_1", whisk_user_id: "u1" } })
  assert.equal(req.session, undefined)
})

test("anyone else meets Medusa's own check", async () => {
  for (const headers of [team, { ...agent }, { ...team, ...agent, "x-whisk-roles": "guest" }]) {
    const { req, res } = await run(headers)
    assert.equal(res.status, 401)
    assert.equal(req.auth_context, undefined)
  }
  const other = await run({ ...team, ...agent }, "/store")
  assert.equal(other.res.status, 401)
})

test("a member's browser reads the setup list without a session, and nothing else", async () => {
  const read = await run(team, "/admin", "GET", SETUP_PATH + "?x=1")
  assert.equal(read.res.status, 200)
  assert.equal(read.req.auth_context?.actor_id, "user_1")
  for (const [method, url] of [["POST", SETUP_PATH], ["GET", "/admin/orders"], ["GET", SETUP_PATH + "/x"]]) {
    const { res, req } = await run(team, "/admin", method, url)
    assert.equal(res.status, 401, `${method} ${url}`)
    assert.equal(req.auth_context, undefined)
  }
  const guest = await run({ ...team, "x-whisk-roles": "guest" }, "/admin", "GET", SETUP_PATH)
  assert.equal(guest.res.status, 401)
})

// The wrap finds Medusa's check by its name and prefix; this fails when an upgrade renames it.
test("Medusa's admin check is still the middleware the shop wraps", () => {
  const router = readFileSync(path.join(path.dirname(require.resolve("@medusajs/framework/http")), "router.js"), "utf8")
  assert.match(router, /function authMiddleware\(req, res, next\)/)
  assert.match(router, /applyAuthMiddleware\)\.call\(this, routesFinder, "\/admin", "user"/)
  assert.match(router, /_a\.traceMiddleware\(authMiddleware, \{\s*route: namespace,/)
})
