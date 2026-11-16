// The shop's server. Whisk's commerce engine answers the shop's API (whisk.yaml, commerce: medusa)
// and this process serves its pages (src/front.ts) with the site editor. In production the engine
// the app's machine shares among its shops answers the API, named in WHISK_COMMERCE_URL, and this
// process serves the pages alone on PORT while the edge sends the API to that engine. Elsewhere (a
// preview, or whisk dev) the engine Whisk put in the image (Dockerfile, whisk-commerce-engine) or
// whisk dev downloaded (WHISK_COMMERCE_ENGINE) answers on PORT and passes every other request to
// the pages here. `start.ts develop` runs the editor from its source.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const engine = process.env.WHISK_COMMERCE_ENGINE || path.join(__dirname, "engine", "engine")
const port = Number(process.env.PORT ?? 9000)
const editor = () => require("./src/lib/cms").startCms()

if (process.env.WHISK_COMMERCE_URL) {
  require("./src/front").startFront(port, "0.0.0.0")
  editor()
} else if (existsSync(engine)) {
  // The pages answer the engine alone, on this machine.
  const front = Number(process.env.SHOP_FRONT_PORT ?? 9102)
  require("./src/front").startFront(front)
  editor()
  const child = spawn(engine, ["serve"], { stdio: "inherit", env: { ...process.env, PORT: String(port), SHOP_FRONT_URL: `http://127.0.0.1:${front}` } })
  // The engine's end is the app's: the platform starts it again.
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
  for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => child.kill(s))
} else {
  console.error(`Whisk's commerce engine is not at ${engine}, and WHISK_COMMERCE_URL names none. Run the shop with whisk dev, which downloads it, or deploy it with whisk deploy.`)
  process.exit(1)
}
