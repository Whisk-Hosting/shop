// The shop's details on the Store page, always there to change later (src/admin/lib/shop-setup.tsx).
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { ShopSetup } from "../lib/shop-setup"

const OnStore = () => <ShopSetup always />

export const config = defineWidgetConfig({ zone: "store.details.before" })

export default OnStore
