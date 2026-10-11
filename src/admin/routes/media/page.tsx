// /app/media: the website's media, in the site editor (src/admin/lib/editor.tsx).
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo } from "@medusajs/icons"
import { Editor } from "../../lib/editor"

const Page = () => <Editor start="/cms/collections/media" />

export const config = defineRouteConfig({ label: "Media", icon: Photo })

export default Page
