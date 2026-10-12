import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import WhiskStripeService from "./service"

export default ModuleProvider(Modules.PAYMENT, { services: [WhiskStripeService] })
