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
	Health Kind = iota // the platform's health check
	Go                 // a redirect to Location
	Editor             // the site editor and its API (/cms): Whisk's content engine
	Moved              // an old address of a moved website, or a shop page's other address
	Static             // a file from public/
	Admin              // the admin's built screens, served here beside a shared engine
	Shop               // a page of the shop, which needs the storefront's context
)

// Action is a decision: its kind and what that kind needs.
type Action struct {
	Kind     Kind
	Location string
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
	editorPath = regexp.MustCompile(`^/cms(/|$)`)
	adminPath  = regexp.MustCompile(`^/app(/|$)`)
)

// Decide is what the front does with a request, in order: health, the editor (which decides itself
// who may do what, where it opens and what the Edit link's /cms/edit finds, as on Whisk's machines),
// an old address or a shop page's other address, a file, the admin's screens, else a page of the
// shop.
func Decide(s Site, r Request) Action {
	read := r.Method == "GET" || r.Method == "HEAD"
	switch {
	case r.Path == "/health/ready":
		return Action{Kind: Health}
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

// IsStaff says whether Whisk's edge says this is the business's team (CONTRACT.md §4). Anyone but
// a guest may run the shop.
func IsStaff(h map[string]string) bool {
	roles := filter(mapOf(strings.Split(h["x-whisk-roles"], ","), strings.TrimSpace), func(s string) bool { return s != "" })
	return h["x-whisk-audience"] == "team" && h["x-whisk-user-id"] != "" && h["x-whisk-email"] != "" && some(roles, func(r string) bool { return r != "guest" })
}

// SignIn is Whisk's sign-in, then back to u.
func SignIn(u string) string { return "/.whisk/login?return=" + url.QueryEscape(u) }

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
