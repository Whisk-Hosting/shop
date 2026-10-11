// The site editor (Payload, at /cms) shown inside the shop's admin, so the team has one admin for
// the shop and the website. Each section opens the editor at its own place; the editor's own menu
// is hidden (cms/app/(payload)/custom.css) because the admin's is beside it. The address keeps
// the editor's page in ?to=, so a reload or a shared link opens the same thing.
import { useEffect, useRef } from "react"

const startAt = (fallback: string) => {
  const to = new URLSearchParams(window.location.search).get("to") ?? ""
  return /^\/cms(\/|$|\?)/.test(to) && !to.includes("//") ? to : fallback
}

export const Editor = ({ start }: { start: string }) => {
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const follow = () => {
      const at = el.contentWindow?.location
      if (!at || !at.pathname.startsWith("/cms")) return
      const url = new URL(window.location.href)
      url.searchParams.set("to", at.pathname + at.search)
      window.history.replaceState(window.history.state, "", url)
    }
    el.addEventListener("load", follow)
    return () => el.removeEventListener("load", follow)
  }, [])
  return (
    <iframe
      ref={frame}
      src={startAt(start)}
      title="Website"
      style={{ border: 0, width: "100%", height: "calc(100vh - 16px)", display: "block", borderRadius: 8, background: "var(--bg-base)" }}
    />
  )
}
