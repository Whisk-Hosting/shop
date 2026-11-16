// The migrate step (whisk.yaml): the shop's own migrations and setup, then the site editor's
// (Payload's, cms/migrations, in the database's cms schema). It runs with the direct database
// connection and none of the app's other platform environment (CONTRACT.md §5), before traffic
// moves to the new version; SHOP_STEP and CMS_STEP tell the shop and the editor they sign nothing
// here.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const env = { ...process.env, SHOP_STEP: "migrate", CMS_STEP: "migrate" }
const cms = path.resolve("cms")

// Whisk's commerce engine, when its node's answers the shop's API (start.ts), migrates and sets up
// the shop itself as it opens it; the engine in the image (a preview's) or the one whisk dev
// downloaded does it here.
const engine = process.env.WHISK_COMMERCE_ENGINE || path.join(__dirname, "engine", "engine")
if (process.env.WHISK_COMMERCE_URL) {
  console.log("Whisk's commerce engine migrates and sets up the shop as it opens it.")
} else if (existsSync(engine)) {
  const r = spawnSync(engine, ["migrate"], { stdio: "inherit", env })
  if (r.status !== 0) process.exit(r.status ?? 1)
} else {
  console.error(`Whisk's commerce engine is not at ${engine}, and WHISK_COMMERCE_URL names none. Run the shop with whisk dev, which downloads it, or deploy it with whisk deploy.`)
  process.exit(1)
}
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
