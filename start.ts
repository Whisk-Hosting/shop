// The shop's server, as the image starts it. Whisk answers the shop's API with its commerce
// engine (whisk.yaml, commerce: medusa). In production the engine the app's machine shares among
// its shops answers it, named in WHISK_COMMERCE_URL, and this process serves the shop's pages
// alone on PORT (src/front.ts) with the site editor, while the edge sends the API to that engine.
// Elsewhere (a preview) the engine Whisk put in the image (Dockerfile, whisk-commerce-engine)
// answers on PORT and passes every other request to the pages here. Without either, Medusa's
// server answers everything.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const engine = path.join(__dirname, "engine", "engine")
const port = Number(process.env.PORT ?? 9000)

if (process.env.WHISK_COMMERCE_URL) {
  require("./src/front").startFront(port, "0.0.0.0")
  require("./src/lib/cms").startCms()
} else if (existsSync(engine)) {
  // The pages answer the engine alone, on this machine.
  const front = Number(process.env.SHOP_FRONT_PORT ?? 9102)
  require("./src/front").startFront(front)
  require("./src/lib/cms").startCms()
  const child = spawn(engine, ["serve"], { stdio: "inherit", env: { ...process.env, PORT: String(port), SHOP_FRONT_URL: `http://127.0.0.1:${front}` } })
  // The engine's end is the app's: the platform starts it again.
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
  for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => child.kill(s))
} else {
  process.argv = [process.execPath, require.resolve("@medusajs/cli/cli.js"), "start"]
  require("@medusajs/cli/cli.js")
}
