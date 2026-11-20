// The shop's build, start and migrate steps, in Node so they run the same in PowerShell,
// Command Prompt and a Unix shell. Whisk's commerce engine answers the shop's API and Whisk's
// content engine its site editor; the Go server here (main.go) draws its pages from theme/.
//   node scripts/shop.mjs build     the shop (below) and its server
//   node scripts/shop.mjs shop      the admin's screens, the theme, the files, the starting content
//                                   (content/) and catalogue (catalogue/) into build/; the image
//                                   builds the server in a stage of its own
//   node scripts/shop.mjs start     the built shop (build/)
//   node scripts/shop.mjs migrate   the commerce engine's migrations and setup (server migrate)
//   node scripts/shop.mjs dev       the admin built once, then the shop's server from its source on
//                                   the engines whisk dev downloads; a change to theme/ shows on
//                                   the next page
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { plugin as adminFixes } from "./admin-fixes.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = path.join(root, "build")
const require = createRequire(path.join(root, "package.json"))
const exe = process.platform === "win32" ? ".exe" : ""

const spawn = (cmd, args, cwd, env = process.env) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env, shell: process.platform === "win32" && cmd !== process.execPath })
  if (r.error) console.error(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) process.exit(r.status ?? 1)
}
// The pages' server, with Go (https://go.dev/dl).
const go = (args, env) => spawn("go", args, root, { ...process.env, ...env })

// The admin's screens: Medusa's admin dashboard with the shop's own screens (src/admin), and trade
// ordering's when Whisk installed it (Dockerfile, whisk-shop-b2b), built into plain files the
// server serves at /app beside an engine shared among shops, and the engine serves otherwise, with
// the fixes to Medusa's dashboard in admin-fixes.mjs.
const buildAdmin = async (into) => {
  const { build } = await import(pathToFileURL(require.resolve("@medusajs/admin-bundler")))
  const trade = existsSync(path.join(root, "node_modules", "@whisk", "shop-b2b", "package.json"))
  rmSync(into, { recursive: true, force: true })
  await build({ path: "/app", backendUrl: "/", outDir: into, sources: [path.join(root, "src", "admin")], plugins: trade ? ["@whisk/shop-b2b/admin"] : [],
    vite: () => ({ plugins: [adminFixes()] }) })
}

// Everything the server reads beside itself: the theme, the files, the admin's screens, a moved
// website's old addresses and robots.txt (MOVER.md §5.4), the starting content and the catalogue.
const buildShop = async () => {
  rmSync(out, { recursive: true, force: true })
  cpSync(path.join(root, "theme"), path.join(out, "theme"), { recursive: true })
  cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true, filter: (from) => path.relative(root, from) !== path.join("public", "admin") })
  await buildAdmin(path.join(out, "public", "admin"))
  for (const file of ["redirects.json", "robots.txt"]) {
    if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(out, file))
  }
  for (const folder of ["content", "catalogue"]) {
    if (existsSync(path.join(root, folder))) cpSync(path.join(root, folder), path.join(out, folder), { recursive: true })
  }
}

const steps = {
  build: async () => {
    await buildShop()
    go(["build", "-trimpath", "-o", path.join(out, "server" + exe), "."], { CGO_ENABLED: "0" })
  },
  shop: buildShop,
  start: () => spawn(path.join(out, "server" + exe), [], out),
  migrate: () => spawn(path.join(out, "server" + exe), ["migrate"], out),
  dev: async () => {
    await buildAdmin(path.join(root, "public", "admin"))
    go(["run", ".", "--develop"])
  },
}

const step = steps[process.argv[2]]
if (!step) {
  console.error(`usage: node scripts/shop.mjs ${Object.keys(steps).join("|")}`)
  process.exit(2)
}
await step()
