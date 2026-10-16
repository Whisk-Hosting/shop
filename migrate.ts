// The migrate step (whisk.yaml): Medusa's migrations, then the shop's setup, then the site
// editor's (Payload's, cms/migrations, in the database's cms schema). It runs with the
// direct database connection and none of the app's other platform environment (CONTRACT.md §5),
// before traffic moves to the new version; SHOP_STEP and CMS_STEP tell the shop and the editor
// they sign nothing here.
// The starting catalogue is added by a job (src/jobs/catalogue.ts), which has the storage.
import { spawnSync } from "node:child_process"
import path from "node:path"

const env = { ...process.env, SHOP_STEP: "migrate", CMS_STEP: "migrate" }
const run = (args: string[], cwd = process.cwd()) => {
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env, cwd })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const medusa = require.resolve("@medusajs/cli/cli.js")
const cms = path.resolve("cms")

run([medusa, "db:migrate"])
run([medusa, "exec", "./src/scripts/setup.js"])
// Payload's command loads its TypeScript config through a loader thread, and now and then the
// process runs out of work before the config arrives: it exits 0 having migrated nothing. A
// process that ends that way (beforeExit) exits STALLED instead, and is run again.
const STALLED = 75
const stalls = `data:text/javascript,process.on("beforeExit",()=>{process.exitCode=${STALLED}})`
const editor = (tries: number) => {
  const r = spawnSync(process.execPath, ["--import", stalls, path.join(cms, "node_modules", "payload", "bin.js"), "migrate"], { stdio: "inherit", env, cwd: cms })
  if (r.status === STALLED && tries > 1) return editor(tries - 1)
  if (r.status === STALLED) console.error("The editor's migrations stopped before they ran, three times.")
  if (r.status !== 0) process.exit(r.status ?? 1)
}
editor(3)
