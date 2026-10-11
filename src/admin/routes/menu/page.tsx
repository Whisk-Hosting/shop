// /app/menu: the website's menu, in the site editor (src/admin/lib/editor.tsx).
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BarsThree } from "@medusajs/icons"
import { Editor } from "../../lib/editor"

const Page = () => <Editor start="/cms/globals/menus" />

export const config = defineRouteConfig({ label: "Menu", icon: BarsThree })

export default Page
