// The shop's build, start and migrate steps, in Node so they run the same in PowerShell,
// Command Prompt and a Unix shell. Whisk's commerce engine answers the shop's API (start.ts); this
// app holds its pages.
//   node scripts/shop.mjs build     the shop (below), then the site editor (cms/) beside it
//   node scripts/shop.mjs shop      the admin's screens, the server, the storefront and the starting
//                                   catalogue (catalogue/) into build/; the image builds the
//                                   editor in a stage of its own, reused while cms/ is unchanged
//   node scripts/shop.mjs start     the built shop (build/), which starts the editor
//   node scripts/shop.mjs migrate   the engine's migrations and setup, and the editor's
//   node scripts/shop.mjs dev       the storefront and the admin built once, then the shop from its
//                                   source on the engine whisk dev downloads, with the editor
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = path.join(root, "build")
const require = createRequire(path.join(root, "package.json"))
// Each tool's own command, run with this Node.
const bin = (pkg) => {
  const manifest = require.resolve(`${pkg}/package.json`)
  const { bin } = require(manifest)
  return path.join(path.dirname(manifest), typeof bin === "string" ? bin : Object.values(bin)[0])
}

const run = (args, cwd = root) => {
  const r = spawnSync(process.execPath, args, { cwd, stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const buildStorefront = () => run([bin("astro"), "build", "--root", "storefront"])

// The admin's screens: Medusa's admin dashboard with the shop's own screens (src/admin), and trade
// ordering's when Whisk installed it (Dockerfile, whisk-shop-b2b), built into plain files the
// engine serves at /app.
const buildAdmin = async (into) => {
  const { build } = await import(pathToBundler())
  const trade = existsSync(path.join(root, "node_modules", "@whisk", "shop-b2b", "package.json"))
  rmSync(into, { recursive: true, force: true })
  await build({ path: "/app", backendUrl: "/", outDir: into, sources: [path.join(root, "src", "admin")], plugins: trade ? ["@whisk/shop-b2b/admin"] : [] })
}
const pathToBundler = () => pathToFileURL(require.resolve("@medusajs/admin-bundler"))

// The site editor (cms/): Payload, a Next.js app with its own packages (React 19, where the
// admin's screens have 18), built in its folder. The built shop carries it whole but for what only
// builds need, and installs its packages there (Dockerfile).
const cms = path.join(root, "cms")
const npm = (args, cwd = cms) => {
  const r = spawnSync("npm", args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const installCms = () => {
  if (!existsSync(path.join(cms, "node_modules", "next"))) npm(["ci", "--no-audit", "--no-fund"])
}
const buildCms = () => {
  installCms()
  npm(["run", "build"])
}
// The built shop's copy of the editor uses the source's packages on this computer (a link, which
// the image replaces with its own production install).
const LEAVE_OUT = new Set(["node_modules", ".next/cache", "media"])
const copyCms = () => {
  const into = path.join(out, "cms")
  rmSync(into, { recursive: true, force: true })
  cpSync(cms, into, { recursive: true, filter: (from) => !LEAVE_OUT.has(path.relative(cms, from).split(path.sep).join("/")) })
  symlinkSync(path.join(cms, "node_modules"), path.join(into, "node_modules"), "junction")
}

// The admin's screens, the server (start.ts, migrate.ts, src/front.ts and src/lib, compiled), the
// storefront, the old addresses and the catalogue, with the packages they run with.
const buildShop = async () => {
  rmSync(out, { recursive: true, force: true })
  run([bin("typescript"), "-p", "tsconfig.build.json"])
  await buildAdmin(path.join(out, "public", "admin"))
  buildStorefront()
  cpSync(path.join(root, "storefront", "dist"), path.join(out, "storefront", "dist"), { recursive: true })
  // A moved website's old addresses and robots.txt (MOVER.md §5.4).
  for (const file of ["redirects.json", "robots.txt", "package.json", "package-lock.json"]) {
    if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(out, file))
  }
  if (existsSync(path.join(root, "catalogue"))) cpSync(path.join(root, "catalogue"), path.join(out, "catalogue"), { recursive: true })
}

const steps = {
  build: async () => {
    await buildShop()
    buildCms()
    copyCms()
  },
  shop: buildShop,
  start: () => run(["start.js"], out),
  migrate: () => run(["migrate.js"], out),
  dev: async () => {
    buildStorefront()
    await buildAdmin(path.join(root, "public", "admin"))
    installCms()
    run([bin("tsx"), "start.ts", "develop"])
  },
}

const step = steps[process.argv[2]]
if (!step) {
  console.error(`usage: node scripts/shop.mjs ${Object.keys(steps).join("|")}`)
  process.exit(2)
}
await step()
