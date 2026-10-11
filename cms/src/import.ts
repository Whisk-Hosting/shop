// Adding the site's starting content (src/content.ts says what it is) when the CMS starts.
import { readdirSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"
import type { Payload } from "payload"
import { convertHTMLToLexical, editorConfigFactory } from "@payloadcms/richtext-lexical"
import { JSDOM } from "jsdom"
import { fileRefs, insideContent, mimeOf, resolved } from "./content"

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"))
const jsonIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(dir, f)) : [])

export const importContent = async (payload: Payload, root: string): Promise<void> => {
  if (!existsSync(root)) return
  const editorConfig = await editorConfigFactory.default({ config: payload.config })
  const toRichText = (html: string) => convertHTMLToLexical({ editorConfig, html, JSDOM })

  const mediaIds = async (content: unknown) => {
    const ids = new Map<string, number | string>()
    for (const ref of fileRefs(content)) {
      const [found] = (await payload.find({ collection: "media", where: { source: { equals: ref.file } }, limit: 1, depth: 0, overrideAccess: true })).docs
      if (found) {
        ids.set(ref.file, found.id)
        continue
      }
      const full = insideContent(root, ref.file)
      if (!full || !existsSync(full)) {
        payload.logger.warn(`content: ${ref.file} is not in content/, so it is left out`)
        continue
      }
      const data = readFileSync(full)
      const made = await payload.create({
        collection: "media",
        data: { alt: ref.alt ?? "", source: ref.file },
        file: { data, mimetype: mimeOf(full), name: path.basename(full), size: data.length },
        overrideAccess: true,
      })
      ids.set(ref.file, made.id)
    }
    return ids
  }

  const add = async (collection: "pages" | "product-pages", key: "path" | "handle", file: string) => {
    const doc = readJson(file) as Record<string, unknown>
    const value = doc[key]
    if (typeof value !== "string") return payload.logger.warn(`content: ${path.basename(file)} has no ${key}, so it is left out`)
    const { totalDocs } = await payload.count({ collection, where: { [key]: { equals: value } }, overrideAccess: true })
    if (totalDocs > 0) return
    const data = resolved(doc, await mediaIds(doc), toRichText) as Record<string, unknown>
    await payload.create({ collection, data: { ...data, _status: "published" } as never, overrideAccess: true }).catch((e: Error) => {
      // Another server starting at the same time added it first.
      if (!/unique|duplicate/i.test(e.message)) throw e
    })
  }

  for (const file of jsonIn(path.join(root, "pages"))) await add("pages", "path", file)
  for (const file of jsonIn(path.join(root, "product-pages"))) await add("product-pages", "handle", file)

  const menus = path.join(root, "menus.json")
  if (existsSync(menus)) {
    const current = (await payload.findGlobal({ slug: "menus", depth: 0, overrideAccess: true })) as { updatedAt?: string | null }
    if (!current.updatedAt) {
      const doc = readJson(menus)
      await payload.updateGlobal({ slug: "menus", data: resolved(doc, await mediaIds(doc), toRichText) as never, overrideAccess: true })
    }
  }
}
