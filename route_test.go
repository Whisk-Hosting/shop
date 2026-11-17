package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

var team = map[string]string{"x-whisk-user-id": "u1", "x-whisk-email": "jordan@example.com", "x-whisk-audience": "team", "x-whisk-roles": "member"}

func TestDecide(t *testing.T) {
	site := Site{
		Redirects: []Redirect{{From: "/old", To: "/new", Status: 301}, {From: "/gone", Status: 410}},
		Public:    "/srv/public",
		Has:       func(f string) bool { return f == "/srv/public/favicon.svg" },
		Shared:    true,
	}
	get := func(p string, h map[string]string) Request {
		path, query, _ := strings.Cut(p, "?")
		return Request{Method: "GET", Path: path, Query: query, Headers: h}
	}
	doc := map[string]string{"sec-fetch-dest": "document"}
	for k, v := range team {
		doc[k] = v
	}
	cases := []struct {
		name string
		r    Request
		want Action
	}{
		{"health", get("/health/ready", nil), Action{Kind: Health}},
		{"edit link signed out", get("/cms/edit?path=%2Fabout", nil), Action{Kind: Go, Location: SignIn("/cms/edit?path=%2Fabout")}},
		{"edit link", get("/cms/edit?path=%2Fabout", team), Action{Kind: EditLink, EditPath: "/about"}},
		{"editor signed out", get("/cms/collections/pages", nil), Action{Kind: Go, Location: SignIn(InsideAdmin("/cms/collections/pages"))}},
		{"editor opened on its own", get("/cms/collections/media", doc), Action{Kind: Go, Location: InsideAdmin("/cms/collections/media")}},
		{"editor in the admin's frame", get("/cms/collections/pages", team), Action{Kind: Editor}},
		{"editor's API, anyone", get("/cms/api/pages", nil), Action{Kind: Editor}},
		{"editor's files", get("/_next/static/a.js", nil), Action{Kind: Editor}},
		{"a form", Request{Method: "POST", Path: "/cart/add", Headers: map[string]string{}}, Action{Kind: Shop}},
		{"a post is never moved", Request{Method: "POST", Path: "/old", Headers: map[string]string{}}, Action{Kind: Shop}},
		{"old address", get("/old", nil), Action{Kind: Moved, Moved: Redirect{From: "/old", To: "/new", Status: 301}}},
		{"gone", get("/gone", nil), Action{Kind: Moved, Moved: Redirect{From: "/gone", Status: 410}}},
		{"a shop page's other address", get("/products/mug/?ref=1", nil), Action{Kind: Moved, Moved: Redirect{From: "/products/mug/", To: "/products/mug?ref=1", Status: 301}}},
		{"file", get("/favicon.svg", nil), Action{Kind: Static, File: StaticFile{File: "/srv/public/favicon.svg", Ext: ".svg", Type: "image/svg+xml", Cache: "public, max-age=86400, stale-while-revalidate=604800"}}},
		{"no such file", get("/robots-old.txt", nil), Action{Kind: Shop}},
		{"admin beside a shared engine", get("/app/orders", nil), Action{Kind: Admin}},
		{"applications is a page", get("/application", nil), Action{Kind: Shop}},
		{"a page", get("/about/", nil), Action{Kind: Shop}},
	}
	for _, c := range cases {
		got := Decide(site, c.r)
		if got.Kind != c.want.Kind || got.Location != c.want.Location || got.EditPath != c.want.EditPath || got.Moved != c.want.Moved || got.File != c.want.File {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
	alone := site
	alone.Shared = false
	if got := Decide(alone, get("/app/orders", nil)); got.Kind != Shop {
		t.Errorf("the admin is the engine's when it runs beside the pages, got %+v", got)
	}
}

func TestEditor(t *testing.T) {
	for _, p := range []string{"/cms", "/cms/", "/cms/collections/pages", "/cms/globals/menus", "/cms/apis"} {
		if !IsEditorPage(p) {
			t.Errorf("%s is the editor's page", p)
		}
	}
	for _, p := range []string{"/cms/api", "/cms/api/pages", "/cmsx", "/_next/static/a.js", "/app/pages"} {
		if IsEditorPage(p) {
			t.Errorf("%s is not the editor's page", p)
		}
	}
	sections := map[string]string{
		"/cms": "pages", "/cms/collections/pages/3": "pages", "/cms/collections/product-pages": "product-pages",
		"/cms/collections/media/create": "media", "/cms/globals/menus": "menu", "/cms/collections/users": "pages", "/cms/account": "pages",
	}
	for p, want := range sections {
		if got := AdminSection(p); got != want {
			t.Errorf("AdminSection(%q) = %q, want %q", p, got, want)
		}
	}
	if got := InsideAdmin("/cms/collections/media?page=2"); got != "/app/media?to=%2Fcms%2Fcollections%2Fmedia%3Fpage%3D2" {
		t.Errorf("InsideAdmin = %q", got)
	}
}

func TestEditLink(t *testing.T) {
	for q, want := range map[string]string{"path=%2Fabout%2F": "/about/", "": "/", "path=about": "/", "path=%2F%2Fevil.example": "/"} {
		if got := EditPath(q); got != want {
			t.Errorf("EditPath(%q) = %q, want %q", q, got, want)
		}
	}
	collection, q := EditQuery("/products/blue%20mug")
	if collection != "product-pages" || q.Get("where[handle][equals]") != "blue mug" || q.Get("draft") != "true" {
		t.Errorf("a product's page: %s %v", collection, q)
	}
	collection, q = EditQuery("/about")
	if collection != "pages" || q.Get("draft") != "true" || !strings.Contains(q.Encode(), url.QueryEscape("/about/")) {
		t.Errorf("a website's page: %s %v", collection, q)
	}
	cases := map[[2]string]string{
		{"pages", "7"}:           InsideAdmin("/cms/collections/pages/7"),
		{"product-pages", "abc"}: InsideAdmin("/cms/collections/product-pages/abc"),
		{"pages", ""}:            InsideAdmin("/cms/collections/pages"),
		{"product-pages", ""}:    "/app/product-pages?to=%2Fcms%2Fcollections%2Fproduct-pages",
	}
	for in, want := range cases {
		if got := EditorFor(in[0], in[1]); got != want {
			t.Errorf("EditorFor(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestAdminFile(t *testing.T) {
	cases := map[string]string{
		"/app/assets/a.js": "assets/a.js", "/app": "", "/app/": "", "/app/index.html": "", "/app/orders/1": "orders/1",
		"/app/../x": "", "/app/.env": "", `/app/a\b`: "", "/app/a//b": "",
	}
	for p, want := range cases {
		if got := AdminFile(p); got != want {
			t.Errorf("AdminFile(%q) = %q, want %q", p, got, want)
		}
	}
}

// Beside an engine shared among shops, the front asks it for the site's context as the app, keeps
// the answer half a minute, and ignores a context a browser sent.
func TestSharedEngineContext(t *testing.T) {
	var asked atomic.Int32
	var lastURL, lastApp atomic.Value
	engine := fakeEngine(t)
	t.Cleanup(engine.Close)
	shared := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/whisk-engine/") {
			engine.Config.Handler.ServeHTTP(w, r)
			return
		}
		asked.Add(1)
		lastURL.Store(r.URL.String())
		lastApp.Store(r.Header.Get(shopAppHeader))
		if r.Header.Get(shopAppHeader) != "app_1" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"api":"","publishableKey":"pk","regionId":"reg1","currency":"usd","name":"Trailhead Goods","market":{"key":"us","country":"us","currency":"usd","timeZone":"America/Chicago"}}`))
	}))
	t.Cleanup(shared.Close)
	f, _ := testFront(t)
	f.cfg = Config{Engine: shared.URL, App: "app_1"}
	for range 2 {
		r := httptest.NewRequest(http.MethodGet, "/account/password", nil)
		r.Header.Set("x-forwarded-host", "shop.example.com")
		r.Header.Set(storefrontHeader, "forged")
		w := httptest.NewRecorder()
		f.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
	}
	if asked.Load() != 1 {
		t.Errorf("the engine was asked %d times, want once in half a minute", asked.Load())
	}
	if lastURL.Load() != "/whisk-engine/storefront?host=shop.example.com" || lastApp.Load() != "app_1" {
		t.Errorf("asked %v as %v", lastURL.Load(), lastApp.Load())
	}
}

// The pages are ready when the site editor answers, or when there is none to wait for.
func TestReady(t *testing.T) {
	f, _ := testFront(t)
	check := func() int {
		w := httptest.NewRecorder()
		f.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
		return w.Code
	}
	if got := check(); got != http.StatusOK {
		t.Errorf("no editor to wait for: %d", got)
	}
	f.hasCMS = true
	if got := check(); got != http.StatusOK {
		t.Errorf("the editor answers: %d", got)
	}
	f.content = NewHTTPContent("http://127.0.0.1:1")
	if got := check(); got != http.StatusServiceUnavailable {
		t.Errorf("the editor does not answer: %d", got)
	}
}

func TestContentAddress(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	cases := []struct {
		env              map[string]string
		content, cmsPort string
	}{
		{nil, "http://127.0.0.1:9100", "9100"},
		{map[string]string{"CMS_URL": "http://other/"}, "http://other", ""},
		{map[string]string{"WHISK_CONTENT_URL": "http://content.internal.whisk:9320", "CMS_URL": "http://other"}, "http://content.internal.whisk:9320", ""},
	}
	for _, c := range cases {
		got := configFrom(env(c.env), nil)
		if got.Content != c.content || got.CMSPort != c.cmsPort {
			t.Errorf("%v: content %q, editor port %q; want %q, %q", c.env, got.Content, got.CMSPort, c.content, c.cmsPort)
		}
	}
}
