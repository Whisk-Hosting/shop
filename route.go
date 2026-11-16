// What the shop's front does with each request before the shop's own pages, decided by one pure
// function (Decide) from the request alone: the health check, the site editor, old addresses,
// files and the admin's built screens. Everything else is a page of the shop, routed in pages.go.
// Table-tested (route_test.go).
package main

import (
	"net/url"
	"regexp"
	"strings"
)

// Request is what a decision reads of an HTTP request.
type Request struct {
	Method  string
	Path    string
	Query   string // the raw query, without its "?"
	Headers map[string]string
}

// Kind names what the front does with a request.
type Kind int

const (
	Health   Kind = iota // the platform's health check
	Go                   // a redirect to Location
	EditLink             // the Whisk bar's Edit page: find what EditPath shows, then open the admin there
	Editor               // the site editor and its API (Payload, beside the shop)
	Moved                // an old address of a moved website, or a shop page's other address
	Static               // a file from public/
	Admin                // the admin's built screens, served here beside a shared engine
	Shop                 // a page of the shop, which needs the storefront's context
)

// Action is a decision: its kind and what that kind needs.
type Action struct {
	Kind     Kind
	Location string
	EditPath string
	Moved    Redirect
	File     StaticFile
}

// Site is what decisions know of the shop: fixed for the life of the process.
type Site struct {
	Redirects []Redirect
	Public    string // the folder of files served as they are
	Has       func(file string) bool
	Shared    bool // a commerce engine shared among shops answers the API, so the admin is served here
}

var (
	editorPath = regexp.MustCompile(`^/(cms|_next)(/.*)?$`)
	editorPage = regexp.MustCompile(`^/cms(/|$)`)
	editorAPI  = regexp.MustCompile(`^/cms/api(/|$)`)
	adminPath  = regexp.MustCompile(`^/app(/|$)`)
	section    = regexp.MustCompile(`^/cms/(collections|globals)/([a-z-]+)`)
)

// Decide is what the front does with a request, in order: health, the editor, an old address or a
// shop page's other address, a file, the admin's screens, else a page of the shop.
func Decide(s Site, r Request) Action {
	here := r.Path + withMark(r.Query)
	staff := IsStaff(r.Headers)
	read := r.Method == "GET" || r.Method == "HEAD"
	switch {
	case r.Path == "/health/ready":
		return Action{Kind: Health}
	case r.Path == "/cms/edit" && !staff:
		return Action{Kind: Go, Location: SignIn(here)}
	case r.Path == "/cms/edit":
		return Action{Kind: EditLink, EditPath: EditPath(r.Query)}
	case editorPath.MatchString(r.Path) && IsEditorPage(r.Path) && !staff:
		return Action{Kind: Go, Location: SignIn(InsideAdmin(here))}
	case editorPath.MatchString(r.Path) && IsEditorPage(r.Path) && r.Headers["sec-fetch-dest"] == "document":
		return Action{Kind: Go, Location: InsideAdmin(here)}
	case editorPath.MatchString(r.Path):
		return Action{Kind: Editor}
	case !read:
		return Action{Kind: Shop}
	}
	if m, ok := RedirectFor(s.Redirects, r.Path, r.Query); ok {
		return Action{Kind: Moved, Moved: m}
	}
	if own := ShopAddress(r.Path); own != "" {
		return Action{Kind: Moved, Moved: Redirect{From: r.Path, To: own + withMark(r.Query), Status: 301}}
	}
	if f, ok := StaticFileFor(s.Public, r.Path); ok && s.Has(f.File) {
		return Action{Kind: Static, File: f}
	}
	if s.Shared && adminPath.MatchString(r.Path) {
		return Action{Kind: Admin}
	}
	return Action{Kind: Shop}
}

// IsEditorPage says whether a path is one of the editor's pages, which are for the team; its API
// answers anyone and decides itself what each may read or change.
func IsEditorPage(p string) bool { return editorPage.MatchString(p) && !editorAPI.MatchString(p) }

// IsStaff says whether Whisk's edge says this is the business's team (CONTRACT.md §4). Anyone but
// a guest may run the shop.
func IsStaff(h map[string]string) bool {
	roles := filter(mapOf(strings.Split(h["x-whisk-roles"], ","), strings.TrimSpace), func(s string) bool { return s != "" })
	return h["x-whisk-audience"] == "team" && h["x-whisk-user-id"] != "" && h["x-whisk-email"] != "" && some(roles, func(r string) bool { return r != "guest" })
}

// SignIn is Whisk's sign-in, then back to u.
func SignIn(u string) string { return "/.whisk/login?return=" + url.QueryEscape(u) }

// AdminSection is the section of the shop's admin the editor lives in for what was asked for.
func AdminSection(p string) string {
	m := section.FindStringSubmatch(p)
	switch {
	case m == nil:
		return "pages"
	case m[1] == "globals":
		return "menu"
	case m[2] == "product-pages" || m[2] == "media":
		return m[2]
	}
	return "pages"
}

// InsideAdmin is the editor opened inside the shop's admin, at what u asked for.
func InsideAdmin(u string) string {
	p, _, _ := strings.Cut(u, "?")
	return "/app/" + AdminSection(p) + "?to=" + url.QueryEscape(u)
}

// EditPath is the page path the Edit link asks for, or the home page when it is not one.
func EditPath(query string) string {
	q, _ := url.ParseQuery(query)
	p := q.Get("path")
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || len(p) > 2000 || strings.ContainsAny(p, " \t\r\n#?\\") {
		return "/"
	}
	return p
}

var productPath = regexp.MustCompile(`^/products/([^/]+)/?$`)

// EditQuery is what the Edit link asks the editor's API for: a product's own page for
// /products/<handle>, else the website's page with that path, in either form of the address and as
// written or decoded (a page for every site, and each market's own).
func EditQuery(p string) (string, url.Values) {
	q := url.Values{"depth": {"0"}, "limit": {"1"}, "draft": {"true"}}
	if m := productPath.FindStringSubmatch(p); m != nil {
		q.Set("where[handle][equals]", decodeOr(m[1]))
		return "product-pages", q
	}
	q = PageQuery(p)
	q.Set("limit", "10")
	return "pages", q
}

func decodeOr(s string) string {
	if d, err := url.PathUnescape(s); err == nil {
		return d
	}
	return s
}

// EditorFor is where the admin opens for what the Edit link found in collection: the document, or
// the collection's list when there is none.
func EditorFor(collection, id string) string {
	if id == "" {
		return InsideAdmin("/cms/collections/" + collection)
	}
	return InsideAdmin("/cms/collections/" + collection + "/" + url.PathEscape(id))
}

// AdminFile is the file under the admin's build an address names, when it names one plainly: no
// dot segments, hidden names or backslashes; "" for the admin's page.
func AdminFile(p string) string {
	rest := strings.TrimPrefix(strings.TrimPrefix(p, "/app"), "/")
	if rest == "" || rest == "index.html" || strings.ContainsAny(rest, "\\\x00") {
		return ""
	}
	if some(strings.Split(rest, "/"), func(part string) bool { return part == "" || strings.HasPrefix(part, ".") }) {
		return ""
	}
	return rest
}

// SiteHost is the site a request was made to: the host the edge says the visitor asked for.
func SiteHost(h map[string]string) string {
	host := pick(h["x-forwarded-host"] != "", h["x-forwarded-host"], h["host"])
	first, _, _ := strings.Cut(host, ",")
	return strings.TrimSpace(first)
}
