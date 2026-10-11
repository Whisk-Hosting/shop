// Which addresses a page may have. The shop's own pages (../src/lib/routes.ts) and the server's
// (the store API, the admins, this CMS) answer first, so a page there could never be seen.
const TAKEN = /^\/(shop|products|categories|collections|cart|checkout|account|order|search|store|admin|auth|hooks|app|health|erp-link|forms|cms|_next|_astro|\.whisk)(\/|$)/
const SHAPE = /^\/([A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)*$/

// pathProblem is why a page's address will not do, or null when it will.
export const pathProblem = (path: string): string | null => {
  if (!path.startsWith("/")) return "An address starts with /, such as /about/."
  if (path.includes("//") || path.includes("?") || path.includes("#") || !SHAPE.test(path)) return "An address is a path only, such as /about/ or /services/repairs."
  if (TAKEN.test(path.toLowerCase()) || path === "/sitemap.xml" || path === "/robots.txt") return `${path} belongs to the shop. Choose another address.`
  return null
}

// The other form of an address, with or without its last slash, which a page answers by sending
// the visitor to the form it was given.
export const otherForm = (path: string) => (path === "/" ? null : path.endsWith("/") ? path.slice(0, -1) : `${path}/`)
