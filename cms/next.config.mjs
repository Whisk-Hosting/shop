// The editor (Payload's admin and API at /cms) is a Next.js app. The shop's server starts it
// beside Medusa and passes /cms to it (../src/lib/cms.ts).
import path from "node:path"
import { fileURLToPath } from "node:url"
import { withPayload } from "@payloadcms/next/withPayload"

const root = path.dirname(fileURLToPath(import.meta.url))

export default withPayload(
  {
    poweredByHeader: false,
    images: { unoptimized: true },
    // The editor is its own app inside the shop's folder, with its own packages.
    turbopack: { root },
    outputFileTracingRoot: root,
  },
  { devBundleServerPackages: false },
)
