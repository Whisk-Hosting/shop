// The website's pages. Each has an address, and the storefront (Astro) draws the page there from
// its blocks (../storefront/src/pages/[...path].astro). Drafts are seen only by the team, in the
// preview beside the editor.
import type { CollectionConfig } from "payload"
import { pageBlocks } from "../blocks"
import { publishedOrStaff, staff } from "../access"
import { pathProblem } from "../paths"
import { previewUrl } from "../preview"

export const Pages: CollectionConfig = {
  slug: "pages",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "path", "_status", "updatedAt"],
    livePreview: { url: ({ data, req }) => previewUrl(req, typeof data?.path === "string" ? data.path : "/") },
    preview: (doc, { req }) => previewUrl(req, typeof doc?.path === "string" ? doc.path : "/"),
  },
  versions: { drafts: { autosave: { interval: 1500 } }, maxPerDoc: 50 },
  access: { read: publishedOrStaff, create: staff, update: staff, delete: staff },
  fields: [
    { name: "title", type: "text", required: true },
    {
      name: "path",
      label: "Address",
      type: "text",
      required: true,
      unique: true,
      index: true,
      defaultValue: "/",
      validate: (v: unknown) => (typeof v === "string" ? (pathProblem(v) ?? true) : "An address starts with /."),
    },
    {
      type: "tabs",
      tabs: [
        { label: "Content", fields: [{ name: "layout", type: "blocks", blocks: pageBlocks }] },
        {
          label: "Search",
          fields: [
            { name: "description", type: "textarea", maxLength: 300 },
            { name: "image", type: "upload", relationTo: "media" },
            { name: "noindex", label: "Hide from search engines", type: "checkbox" },
            // Tags the page keeps from its old site: JSON-LD, hreflang, verification.
            { name: "head", type: "code", admin: { language: "html" } },
          ],
        },
      ],
    },
  ],
}
