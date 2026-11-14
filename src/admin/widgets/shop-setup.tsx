// The setup card above the orders, while the shop still needs something before it takes orders
// (src/admin/lib/shop-setup.tsx).
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { ShopSetup } from "../lib/shop-setup"

const OnOrders = () => <ShopSetup always={false} />

export const config = defineWidgetConfig({ zone: "order.list.before" })

export default OnOrders
