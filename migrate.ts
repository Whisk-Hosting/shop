// The migrate step (whisk.yaml): Medusa's migrations, then the shop's setup, then the site
// editor's (Payload's, cms/migrations, in the database's cms schema). It runs with the
// direct database connection and none of the app's other platform environment (CONTRACT.md §5),
// before traffic moves to the new version; SHOP_STEP tells the config it signs nothing here.
// The starting catalogue is added by a job (src/jobs/catalogue.ts), which has the storage.
import { spawnSync } from "node:child_process"
import path from "node:path"

const env = { ...process.env, SHOP_STEP: "migrate" }
const run = (args: string[], cwd = process.cwd()) => {
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env, cwd })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const medusa = require.resolve("@medusajs/cli/cli.js")
const cms = path.resolve("cms")

run([medusa, "db:migrate"])
run([medusa, "exec", "./src/scripts/setup.js"])
run([path.join(cms, "node_modules", "payload", "bin.js"), "migrate"], cms)
