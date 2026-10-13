// Adds the shop's starting catalogue (catalogue/catalogue.json, src/lib/catalogue.ts): every minute,
// the categories and products it names that the shop does not have yet, with their pictures
// stored on Whisk, so the edge serves each in the size a page asks for. A picture given as one of
// the storefront's files (/catalogue/a.jpg) is stored too, and a catalogue product still showing
// one is moved to the stored copy. It runs in the shop rather than in the migrate step because
// the migrate step has the database and nothing else (no storage for the pictures). Once
// everything is in, each run is two queries. A shop without the file has nothing to do here.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductCategoriesWorkflow, createProductsWorkflow, updateProductsWorkflow, uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { catalogueFrom, categoriesToAdd, handleOf, imageType, productInput, productsToAdd } from "../lib/catalogue"
import { marketFrom } from "../lib/market"
import { staticFile } from "../lib/routes"

type Logger = { info: (m: string) => void; warn: (m: string) => void }

// A picture that is one of the storefront's built files, and where it is on disk.
const storefrontPicture = (url: string | null | undefined) => {
  if (!url || !/^\/(?!\/|\.whisk\/)/.test(url)) return null
  const found = staticFile(path.resolve(process.cwd(), "storefront/dist/client"), url.split("?")[0])
  return found && found.type.startsWith("image/") && existsSync(found.file) ? found : null
}

const upload = async (container: MedusaContainer, filename: string, mimeType: string, file: string) =>
  (await uploadFilesWorkflow(container).run({ input: { files: [{ filename, mimeType, content: readFileSync(file).toString("base64"), access: "public" }] } })).result[0].url

// Catalogue products whose pictures are still the storefront's files are moved to stored copies,
// one product at a time, so one that cannot be stored is tried again the next minute.
const storePictures = async (container: MedusaContainer, handles: string[], logger: Logger) => {
  const found = await container.resolve(Modules.PRODUCT).listProducts({ handle: handles }, { select: ["id", "handle", "thumbnail"], relations: ["images"] })
  const stale = found.filter((p) => [p.thumbnail, ...(p.images ?? []).map((i) => i.url)].some((u) => storefrontPicture(u)))
  const stored: Record<string, string> = {}
  const copy = async (u: string) => {
    const f = storefrontPicture(u)
    if (!f) return u
    return (stored[u] ??= await upload(container, path.basename(f.file), f.type, f.file))
  }
  for (const p of stale) {
    try {
      const images: string[] = []
      for (const i of p.images ?? []) images.push(await copy(i.url))
      const thumbnail = p.thumbnail ? await copy(p.thumbnail) : images[0]
      await updateProductsWorkflow(container).run({ input: { products: [{ id: p.id, thumbnail, images: images.map((url) => ({ url })) }] } })
      logger.info(`catalogue: ${p.handle}'s pictures are now stored on Whisk`)
    } catch (e) {
      logger.warn(`catalogue: ${p.handle}'s pictures could not be stored yet: ${(e as Error).message}`)
    }
  }
}

export default async function catalogue(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const dir = path.resolve(process.cwd(), "catalogue")
  const file = path.join(dir, "catalogue.json")
  if (!existsSync(file)) return
  const products = catalogueFrom(JSON.parse(readFileSync(file, "utf8")))

  const productModule = container.resolve(Modules.PRODUCT)
  const stores = container.resolve(Modules.STORE)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  await storePictures(container, products.map((p) => p.handle), logger)
  const have = await productModule.listProducts({ handle: products.map((p) => p.handle) }, { select: ["handle"], withDeleted: true })
  const add = productsToAdd(products, have.map((p) => p.handle))
  if (!add.length) return

  // Categories the new products name.
  const existing = await productModule.listProductCategories({}, { select: ["id", "handle"] })
  const newCategories = categoriesToAdd(add, existing.map((c) => c.handle))
  const made = newCategories.length
    ? (await createProductCategoriesWorkflow(container).run({ input: { product_categories: newCategories.map((name) => ({ name, handle: handleOf(name), is_active: true })) } })).result
    : []
  const categoryIds = Object.fromEntries([...existing, ...made].map((c) => [c.handle, c.id]))

  // Pictures, stored once per product added.
  const imageUrls: Record<string, string> = {}
  // A picture given as an address is stored when it is one of the storefront's files
  // (/catalogue/a.jpg), and used as it is otherwise.
  for (const name of [...new Set(add.flatMap((p) => p.images ?? []))].filter((n) => /^(\/|https:)/.test(n))) {
    const f = storefrontPicture(name)
    imageUrls[name] = f ? await upload(container, path.basename(f.file), f.type, f.file) : name
  }
  for (const name of [...new Set(add.flatMap((p) => p.images ?? []))].filter((n) => !imageUrls[n])) {
    const at = path.join(dir, "images", name)
    const mimeType = imageType(name)
    if (!mimeType || !existsSync(at)) {
      logger.warn(`catalogue: ${name} is not a picture in catalogue/images, so it is left out`)
      continue
    }
    imageUrls[name] = await upload(container, name, mimeType, at)
  }

  const [store] = await stores.listStores({}, { take: 1 })
  const [profile] = await fulfillment.listShippingProfiles({ type: "default" }, { take: 1 })
  const ctx = { currency: marketFrom(process.env).currency, channelId: store.default_sales_channel_id!, profileId: profile.id, categoryIds, imageUrls }
  await createProductsWorkflow(container).run({ input: { products: add.map((p) => productInput(p, ctx)) } })
  logger.info(`catalogue: added ${add.length} products${made.length ? ` and ${made.length} categories` : ""}`)
}

export const config = { name: "catalogue", schedule: "* * * * *" }
