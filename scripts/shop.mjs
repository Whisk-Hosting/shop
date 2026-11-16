// The shop's build, start and migrate steps, in Node so they run the same in PowerShell,
// Command Prompt and a Unix shell. Whisk's commerce engine answers the shop's API; the Go server
// here (main.go) draws its pages from theme/ and starts the site editor (cms/).
//   node scripts/shop.mjs build     the shop (below) and its server, then the site editor beside it
//   node scripts/shop.mjs shop      the admin's screens, the migrate step, the theme, the files and
//                                   the starting catalogue (catalogue/) into build/; the image
//                                   builds the server and the editor in stages of their own
//   node scripts/shop.mjs start     the built shop (build/), which starts the editor
//   node scripts/shop.mjs migrate   the engine's migrations and setup, and the editor's
//   node scripts/shop.mjs dev       the admin built once, then the shop's server from its source on
//                                   the engine whisk dev downloads, with the editor; a change to
//                                   theme/ shows on the next page
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = path.join(root, "build")
const require = createRequire(path.join(root, "package.json"))
const exe = process.platform === "win32" ? ".exe" : ""
// Each tool's own command, run with this Node.
const bin = (pkg) => {
  const manifest = require.resolve(`${pkg}/package.json`)
  const { bin } = require(manifest)
  return path.join(path.dirname(manifest), typeof bin === "string" ? bin : Object.values(bin)[0])
}

const spawn = (cmd, args, cwd, env = process.env) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env, shell: process.platform === "win32" && cmd !== process.execPath })
  if (r.error) console.error(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const run = (args, cwd = root) => spawn(process.execPath, args, cwd)
// The pages' server, with Go (https://go.dev/dl).
const go = (args, env) => spawn("go", args, root, { ...process.env, ...env })

// The admin's screens: Medusa's admin dashboard with the shop's own screens (src/admin), and trade
// ordering's when Whisk installed it (Dockerfile, whisk-shop-b2b), built into plain files the
// server serves at /app beside an engine shared among shops, and the engine serves otherwise.
const buildAdmin = async (into) => {
  const { build } = await import(pathToFileURL(require.resolve("@medusajs/admin-bundler")))
  const trade = existsSync(path.join(root, "node_modules", "@whisk", "shop-b2b", "package.json"))
  rmSync(into, { recursive: true, force: true })
  await build({ path: "/app", backendUrl: "/", outDir: into, sources: [path.join(root, "src", "admin")], plugins: trade ? ["@whisk/shop-b2b/admin"] : [] })
}

// The site editor (cms/): Payload, a Next.js app with its own packages (React 19, where the
// admin's screens have 18), built in its folder.
const cms = path.join(root, "cms")
const npm = (args) => spawn("npm", args, cms)
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

// Everything the server reads beside itself: the theme, the files, the admin's screens, the
// migrate step, a moved website's old addresses and robots.txt (MOVER.md §5.4), and the catalogue.
const buildShop = async () => {
  rmSync(out, { recursive: true, force: true })
  run([bin("typescript"), "-p", "tsconfig.build.json"])
  cpSync(path.join(root, "theme"), path.join(out, "theme"), { recursive: true })
  cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true, filter: (from) => path.relative(root, from) !== path.join("public", "admin") })
  await buildAdmin(path.join(out, "public", "admin"))
  for (const file of ["redirects.json", "robots.txt"]) {
    if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(out, file))
  }
  if (existsSync(path.join(root, "catalogue"))) cpSync(path.join(root, "catalogue"), path.join(out, "catalogue"), { recursive: true })
}

const steps = {
  build: async () => {
    await buildShop()
    go(["build", "-trimpath", "-o", path.join(out, "server" + exe), "."], { CGO_ENABLED: "0" })
    buildCms()
    copyCms()
  },
  shop: buildShop,
  start: () => spawn(path.join(out, "server" + exe), [], out),
  migrate: () => run(["migrate.js"], out),
  dev: async () => {
    await buildAdmin(path.join(root, "public", "admin"))
    installCms()
    go(["run", ".", "--develop"])
  },
}

const step = steps[process.argv[2]]
if (!step) {
  console.error(`usage: node scripts/shop.mjs ${Object.keys(steps).join("|")}`)
  process.exit(2)
}
await step()
