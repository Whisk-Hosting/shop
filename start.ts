// The shop's server, as the image starts it. Whisk's build can add its own server for the shop's
// API, which then stands beside this file as engine (the Dockerfile's whisk-commerce-engine
// stage): it answers on PORT, and this process serves the shop's pages beside it (src/front.ts)
// with the site editor. Without it, Medusa's server answers everything, as on a laptop.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const engine = path.resolve(__dirname, "engine")

if (!existsSync(engine)) {
  process.argv = [process.execPath, require.resolve("@medusajs/cli/cli.js"), "start"]
  require("@medusajs/cli/cli.js")
} else {
  // The front answers on a port of the app's own, beside the editor's (CMS_PORT).
  const frontPort = 9200
  const server = spawn(engine, ["serve"], {
    env: { ...process.env, SHOP_FRONT_URL: `http://127.0.0.1:${frontPort}` },
    stdio: ["ignore", "inherit", "inherit"],
  })
  // The app is its server: when the server stops, so does the app, and the platform starts it again.
  server.on("exit", (code, signal) => {
    console.error(`shop: the server stopped (${signal ?? code})`)
    process.exit(code ?? 1)
  })
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.kill(signal))
  require("./src/front").startFront(frontPort)
  require("./src/lib/cms").startCms()
}
