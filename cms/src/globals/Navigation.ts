// The site's menus: the links across the top of every page, and the footer's columns and note.
import type { Field, GlobalConfig } from "payload"
import { anyone, staff } from "../access"

const links = (name: string, maxRows: number): Field => ({
  name,
  type: "array",
  label: "Links",
  labels: { singular: "Link", plural: "Links" },
  maxRows,
  fields: [
    { name: "label", type: "text", required: true },
    { name: "url", type: "text", required: true },
  ],
})

export const Menus: GlobalConfig = {
  slug: "menus",
  label: "Menu",
  access: { read: anyone, update: staff },
  fields: [
    {
      type: "tabs",
      tabs: [
        { label: "Top", fields: [links("header", 12)] },
        {
          label: "Footer",
          fields: [
            { name: "columns", type: "array", labels: { singular: "Column", plural: "Columns" }, maxRows: 4, fields: [{ name: "heading", type: "text" }, links("links", 12)] },
            { name: "note", type: "textarea" },
          ],
        },
      ],
    },
  ],
}
