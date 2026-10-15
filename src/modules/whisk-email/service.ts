// Sends the shop's emails through Whisk's email API, from the shop's own address on Whisk's
// domain unless SHOP_EMAIL_FROM names a mailbox on a domain the business has verified. An email
// about one market (data.market) is sent from that market's SHOP_EMAIL_FROM_AU when it is set.
import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { NotificationTypes } from "@medusajs/framework/types"
import { templates, type TemplateName } from "../../lib/emails"
import { sendEmail } from "../../lib/whisk"
import { marketSetting } from "../../lib/market"

export default class WhiskEmailService extends AbstractNotificationProviderService {
  static identifier = "whisk-email"

  async send(n: NotificationTypes.ProviderSendNotificationDTO): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    const render = templates[n.template as TemplateName] as ((data: any) => { subject: string; html: string; text: string }) | undefined
    if (!render) throw new MedusaError(MedusaError.Types.INVALID_DATA, `No email template named ${n.template}`)
    const mail = render(n.data ?? {})
    const market = typeof n.data?.market === "string" ? n.data.market : ""
    const from = (market ? marketSetting(process.env, "SHOP_EMAIL_FROM", { key: market }) : process.env.SHOP_EMAIL_FROM) || undefined
    const { id } = await sendEmail({ to: n.to, from, ...mail })
    return { id }
  }
}
