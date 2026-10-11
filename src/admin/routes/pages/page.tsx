// /app/pages: the website's pages, in the site editor (src/admin/lib/editor.tsx).
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { Editor } from "../../lib/editor"

const Page = () => <Editor start="/cms/collections/pages" />

export const config = defineRouteConfig({ label: "Pages", icon: DocumentText })

export default Page
