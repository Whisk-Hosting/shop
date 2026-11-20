// Fixes to Medusa's admin dashboard (2.22.2) made as the shop builds it, each a pure change to one
// of the dashboard's files, applied by the Vite plugin below.
//
// One drawer at a time: the product and promotion lists draw their pages' outlet twice, once in
// the list's table and once in the layout around it, so Create, Import and Export open as two
// stacked drawers. The layout's outlet is dropped there, leaving the table's.

// The lists whose table draws the outlet itself, by the widget zone their layout names.
const ownOutlet = ["product.list", "promotion.list"]

// fixes is the file's code with every fix that applies to it made, or null when none does. A
// file a fix is for that no longer holds what the fix changes throws, so a newer dashboard is
// seen to need the fix looked at again.
export const fixes = (code, id) => {
  if (!/@medusajs[\\/]dashboard[\\/]dist[\\/](product|promotion)-list-[^\\/]*\.mjs$/.test(id)) return null
  const zone = ownOutlet.find((z) => code.includes(`widgetsZonePrefix: "${z}",`))
  if (!zone) return null
  const fixed = code.replace(`widgetsZonePrefix: "${zone}",`, `widgetsZonePrefix: "${zone}",\n      hasOutlet: false,`)
  if (!code.includes("LayoutComposer,")) {
    throw new Error(`admin-fixes: ${id} no longer draws its list with LayoutComposer, so the fix for drawers opening twice does not apply. Open its page, and drop the fix from scripts/admin-fixes.mjs if the drawer opens once.`)
  }
  return fixed
}

// plugin is the Vite plugin that makes the fixes as the admin builds.
export const plugin = () => ({
  name: "whisk-admin-fixes",
  enforce: "pre",
  transform(code, id) {
    const fixed = fixes(code, id)
    return fixed === null ? null : { code: fixed, map: null }
  },
})
