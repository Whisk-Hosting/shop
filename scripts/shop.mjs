// The shop's build, start and migrate steps, in Node so they run the same in PowerShell,
// Command Prompt and a Unix shell.
//   node scripts/shop.mjs build     the Medusa server and admin, then the storefront, the site
//                                   editor (cms/) and the starting catalogue (catalogue/) beside them
//   node scripts/shop.mjs shop      the same without the editor: the image builds the editor in a
//                                   stage of its own, which is reused while cms/ is unchanged
//   node scripts/shop.mjs start     the built shop (.medusa/server), which starts the editor
//   node scripts/shop.mjs migrate   the built shop's migrations and setup, and the editor's
//   node scripts/shop.mjs dev       the storefront built once, then Medusa watching the source,
//                                   with the editor beside it
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const server = path.join(root, ".medusa", "server")
const require = createRequire(path.join(root, "package.json"))
// Each tool's own command, run with this Node.
const bin = (pkg) => {
  const manifest = require.resolve(`${pkg}/package.json`)
  const { bin } = require(manifest)
  return path.join(path.dirname(manifest), typeof bin === "string" ? bin : Object.values(bin)[0])
}
const medusa = bin("@medusajs/cli")
const astro = bin("astro")

const run = (args, cwd = root) => {
  const r = spawnSync(process.execPath, args, { cwd, stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const buildStorefront = () => run([astro, "build", "--root", "storefront"])

// The site editor (cms/): Payload, a Next.js app with its own packages (React 19, where Medusa's
// admin has 18), built in its folder. The built shop carries it whole but for what only builds
// need, and installs its packages there (Dockerfile).
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
// The built shop's copy of the editor uses the source's packages on a laptop (a link, which the
// image replaces with its own production install).
const LEAVE_OUT = new Set(["node_modules", ".next/cache", "media"])
const copyCms = () => {
  const into = path.join(server, "cms")
  rmSync(into, { recursive: true, force: true })
  cpSync(cms, into, { recursive: true, filter: (from) => !LEAVE_OUT.has(path.relative(cms, from).split(path.sep).join("/")) })
  symlinkSync(path.join(cms, "node_modules"), path.join(into, "node_modules"), "junction")
}

// The Medusa server and admin with the storefront, the old addresses and the catalogue beside it.
const buildShop = () => {
  run([medusa, "build"])
  buildStorefront()
  rmSync(path.join(server, "storefront"), { recursive: true, force: true })
  cpSync(path.join(root, "storefront", "dist"), path.join(server, "storefront", "dist"), { recursive: true })
  // A moved website's old addresses and robots.txt (MOVER.md §5.4).
  for (const file of ["redirects.json", "robots.txt"]) {
    rmSync(path.join(server, file), { force: true })
    if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(server, file))
  }
  rmSync(path.join(server, "catalogue"), { recursive: true, force: true })
  if (existsSync(path.join(root, "catalogue"))) cpSync(path.join(root, "catalogue"), path.join(server, "catalogue"), { recursive: true })
}

const steps = {
  build: () => {
    buildShop()
    buildCms()
    copyCms()
  },
  shop: buildShop,
  start: () => run([medusa, "start"], server),
  migrate: () => run(["migrate.js"], server),
  dev: () => {
    buildStorefront()
    installCms()
    run([medusa, "develop"])
  },
}

const step = steps[process.argv[2]]
if (!step) {
  console.error(`usage: node scripts/shop.mjs ${Object.keys(steps).join("|")}`)
  process.exit(2)
}
step()
