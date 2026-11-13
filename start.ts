// The shop's server, as the image starts it. Whisk can answer the shop's API with its own commerce
// server, which the app's machine shares among its shops (whisk.yaml, commerce: medusa): it then
// names it in WHISK_COMMERCE_URL, and this process serves the shop's pages alone on PORT
// (src/front.ts) with the site editor, while the edge sends the API to that server. Otherwise
// Medusa's server answers everything, as on a laptop.
if (process.env.WHISK_COMMERCE_URL) {
  require("./src/front").startFront(Number(process.env.PORT ?? 9000), "0.0.0.0")
  require("./src/lib/cms").startCms()
} else {
  process.argv = [process.execPath, require.resolve("@medusajs/cli/cli.js"), "start"]
  require("@medusajs/cli/cli.js")
}
