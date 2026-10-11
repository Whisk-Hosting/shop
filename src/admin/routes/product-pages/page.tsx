// /app/product-pages: the website's product pages, in the site editor (src/admin/lib/editor.tsx).
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Swatch } from "@medusajs/icons"
import { Editor } from "../../lib/editor"

const Page = () => <Editor start="/cms/collections/product-pages" />

export const config = defineRouteConfig({ label: "Product pages", icon: Swatch })

export default Page
