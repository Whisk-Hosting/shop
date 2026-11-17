// The shop's front: one Go process beside Whisk's commerce engine, which answers the shop's API.
// It serves the shop's pages, drawn from the theme (theme/) with the shop's API and the site
// editor's content, the site editor itself (Payload, editor.go), a moved website's old addresses
// and the shop's files. What it does with each request is decided by Decide (route.go) and, for
// the shop's own pages, by the routes below; this file carries the decisions out.
//
// In production the engine the app's machine shares among its shops answers the API, named in
// WHISK_COMMERCE_URL: the edge sends the API there and everything else here, on the app's port,
// and the front asks the engine for the storefront's context itself. Elsewhere (a preview, or
// whisk dev) the engine Whisk put in the image (engine/engine) or whisk dev downloaded
// (WHISK_COMMERCE_ENGINE) answers on PORT and passes every other request to the front here, on
// SHOP_FRONT_PORT, with the storefront's context.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata" // the market's time zone, in an image with no zone files

	"html/template"
)

// Config is what the front reads from its environment and its folder, once, at start.
type Config struct {
	Port      string // the app's port, where the edge or the engine beside the front reaches it
	FrontPort string // the front's own port beside an engine inside the app
	Root      string
	Content   string // the site editor's address
	CMSPort   string
	Engine    string // the shared engine's address (WHISK_COMMERCE_URL), or ""
	EngineBin string // the engine inside the app, when there is no shared one
	App       string
	Markets   [][2]string
	Develop   bool
}

func configFrom(getenv func(string) string, args []string) Config {
	or := func(v, d string) string { return pick(v != "", v, d) }
	cmsPort := or(getenv("CMS_PORT"), "9100")
	return Config{
		Port:      or(getenv("PORT"), "9000"),
		FrontPort: or(getenv("SHOP_FRONT_PORT"), "9102"),
		Root:      ".",
		Content:   or(contentURL(getenv), "http://127.0.0.1:"+cmsPort),
		CMSPort:   pick(contentURL(getenv) == "", cmsPort, ""),
		Engine:    strings.TrimRight(getenv("WHISK_COMMERCE_URL"), "/"),
		EngineBin: or(getenv("WHISK_COMMERCE_ENGINE"), filepath.Join("engine", "engine")),
		App:       getenv("WHISK_APP_ID"),
		Markets:   MarketHosts(getenv("SHOP_MARKETS")),
		Develop:   some(args, func(a string) bool { return a == "develop" || a == "--develop" }),
	}
}

type front struct {
	cfg     Config
	site    Site
	theme   func() (Theme, error)
	content Content
	editor  http.Handler
	hasCMS  bool
	robots  string
	client  *http.Client
	routes  *http.ServeMux
	asked   sync.Map // the shared engine's context per host: kept half a minute
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("the shop's front stopped", "error", err.Error())
		os.Exit(1)
	}
}

func run() error {
	cfg := configFrom(os.Getenv, os.Args[1:])
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	at := func(f string) string { return filepath.Join(cfg.Root, f) }
	read := func(f string) []byte { b, _ := os.ReadFile(at(f)); return b }
	loadTheme := func() (Theme, error) { return LoadTheme(os.DirFS(at("theme")), "shop.css", ShopFuncs()) }
	theme, err := loadTheme()
	if err != nil {
		return fmt.Errorf("the theme does not parse: %w", err)
	}
	f := &front{
		cfg:     cfg,
		site:    Site{Redirects: ParseRedirects(read("redirects.json")), Public: at("public"), Has: isFile, Shared: cfg.Engine != ""},
		theme:   pick(cfg.Develop, loadTheme, func() (Theme, error) { return theme, nil }),
		content: NewHTTPContent(cfg.Content),
		editor:  editorProxy(cfg.Content),
		robots:  string(read("robots.txt")),
		client:  &http.Client{Timeout: 20 * time.Second},
	}
	f.routes = f.shopRoutes()
	f.hasCMS = cfg.CMSPort != "" && runEditor(ctx, at("cms"), cfg.CMSPort, cfg.Develop)

	switch {
	case cfg.Engine != "":
		return serve(ctx, "0.0.0.0:"+cfg.Port, withHealth(f, f.ready))
	case isFile(cfg.EngineBin):
		// The front answers the engine alone, on this machine; the engine's end is the app's.
		done := make(chan error, 1)
		go func() { done <- serve(ctx, "127.0.0.1:"+cfg.FrontPort, withHealth(f, f.ready)) }()
		cmd := exec.CommandContext(ctx, cfg.EngineBin, "serve")
		cmd.Env = append(os.Environ(), "PORT="+cfg.Port, "SHOP_FRONT_URL=http://127.0.0.1:"+cfg.FrontPort)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil && ctx.Err() == nil {
			return fmt.Errorf("the commerce engine stopped: %w", err)
		}
		stop()
		return <-done
	}
	return fmt.Errorf("whisk's commerce engine is not at %s, and WHISK_COMMERCE_URL names none: run the shop with whisk dev, which downloads it, or deploy it with whisk deploy", cfg.EngineBin)
}

func serve(ctx context.Context, addr string, h http.Handler) error {
	srv := &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 150 * time.Second}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shut)
	}()
	slog.Info("listening", "address", addr)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func isFile(f string) bool {
	st, err := os.Stat(f)
	return err == nil && st.Mode().IsRegular()
}

func requestOf(r *http.Request) Request {
	h := make(map[string]string, len(r.Header)+1)
	for k, v := range r.Header {
		h[strings.ToLower(k)] = strings.Join(v, ",")
	}
	h["host"] = r.Host
	return Request{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery, Headers: h}
}

func writeError(w http.ResponseWriter, status int, code, message, fix string) {
	w.Header().Set("content-type", "application/json")
	w.Header().Set("cache-control", "no-store")
	if status == http.StatusServiceUnavailable {
		w.Header().Set("retry-after", "5")
	}
	w.WriteHeader(status)
	_, _ = w.Write(ErrorBody(code, message, fix))
}

func (f *front) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// The storefront's context comes only from the engine beside the front, never from a browser.
	sent := r.Header.Get(storefrontHeader)
	r.Header.Del(storefrontHeader)
	req := requestOf(r)
	a := Decide(f.site, req)
	switch a.Kind {
	case Health:
		f.ready(w, r)
	case Go:
		w.Header().Set("cache-control", "no-store")
		http.Redirect(w, r, a.Location, http.StatusFound)
	case EditLink:
		w.Header().Set("cache-control", "no-store")
		http.Redirect(w, r, f.editLink(r.Context(), req, a.EditPath), http.StatusFound)
	case Editor:
		f.editor.ServeHTTP(w, r)
	case Moved:
		w.Header().Set("cache-control", "public, max-age=300")
		if a.Moved.Status == http.StatusGone {
			w.Header().Set("content-type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusGone)
			_, _ = io.WriteString(w, "This page has been removed.")
			return
		}
		http.Redirect(w, r, a.Moved.To, a.Moved.Status)
	case Static:
		sendFile(w, r, a.File)
	case Admin:
		f.admin(w, r)
	case Shop:
		shop, ok := f.storefront(r.Context(), req, sent)
		if !ok {
			writeError(w, http.StatusServiceUnavailable, "SHOP_FRONT_UNAVAILABLE", "The shop's pages cannot be shown right now.", "Try again in a few seconds.")
			return
		}
		f.routes.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), shopKey{}, shop)))
	}
}

type shopKey struct{}

// ready answers the platform's health check: the pages are ready once the site editor answers,
// when it runs here, so a visitor waking the shop waits at the edge rather than meeting a page
// the editor did not answer in time.
func (f *front) ready(w http.ResponseWriter, r *http.Request) {
	if f.hasCMS {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if _, err := f.content.Listed(ctx, Asker{}); err != nil {
			w.Header().Set("content-type", "application/json")
			w.Header().Set("cache-control", "no-store")
			w.WriteHeader(http.StatusServiceUnavailable)
			b, _ := json.Marshal(map[string]any{"ok": false, "failed": []string{"cms: " + err.Error()}})
			_, _ = w.Write(b)
			return
		}
	}
	w.Header().Set("content-type", "application/json")
	w.Header().Set("cache-control", "no-store")
	_, _ = io.WriteString(w, `{"ok":true}`)
}

// editLink is where the Edit link opens the admin: at what the path shows (on a market's site,
// the page that site shows), asked of the editor as the person here; at the list when there is none.
func (f *front) editLink(ctx context.Context, req Request, p string) string {
	collection, q := EditQuery(p)
	docs, err := f.content.Find(ctx, Asker{Identity: req.Headers}, collection, q)
	if err != nil || len(docs) == 0 {
		return EditorFor(collection, "")
	}
	found, ok := ForSite(docs, SiteMarket(f.cfg.Markets, SiteHost(req.Headers)))
	if !ok {
		found = docs[0]
	}
	return EditorFor(collection, found.ID.String())
}

// storefront is the shop's context for this request: from the engine beside the front, or asked of
// the shared engine for the site the visitor came to, kept half a minute (the engine reads its own
// once a minute), and the last answer while it does not answer.
func (f *front) storefront(ctx context.Context, req Request, sent string) (Storefront, bool) {
	if f.cfg.Engine == "" {
		return StorefrontFrom(sent)
	}
	type kept struct {
		s  Storefront
		at time.Time
	}
	host := SiteHost(req.Headers)
	var last *kept
	if v, ok := f.asked.Load(host); ok {
		k := v.(kept)
		if time.Since(k.at) < 30*time.Second {
			return k.s, true
		}
		last = &k
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ask, err := http.NewRequestWithContext(ctx, http.MethodGet, f.cfg.Engine+"/whisk-engine/storefront?host="+url.QueryEscape(host), nil)
	if err != nil {
		return Storefront{}, false
	}
	ask.Header.Set("accept", "application/json")
	ask.Header.Set(shopAppHeader, f.cfg.App)
	res, err := f.client.Do(ask)
	if err != nil {
		slog.Error("front: the commerce engine did not answer", "error", err.Error())
		return pick(last != nil, func() (Storefront, bool) { return last.s, true }, func() (Storefront, bool) { return Storefront{}, false })()
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	s, ok := EngineContext(body, f.cfg.Engine, f.cfg.App)
	if res.StatusCode != http.StatusOK || !ok {
		slog.Error("front: the commerce engine gave no storefront context", "status", res.StatusCode)
		return Storefront{}, false
	}
	f.asked.Store(host, kept{s, time.Now()})
	return s, true
}

// admin serves the admin's built screens (public/admin): a built file as it is, kept a year since
// a new build names its files anew, and the admin's page for any other address under /app, never
// kept, so a new build shows at once.
func (f *front) admin(w http.ResponseWriter, r *http.Request) {
	root := filepath.Join(f.cfg.Root, "public", "admin")
	w.Header().Set("vary", "Origin, Cache-Control")
	if name := AdminFile(r.URL.Path); name != "" {
		if file, ok := StaticFileFor(root, "/"+name); ok && isFile(file.File) {
			file.Cache = "max-age=31536000, immutable"
			sendFile(w, r, file)
			return
		}
	}
	page, err := os.ReadFile(filepath.Join(root, "index.html"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("cache-control", "no-cache")
	if r.Method != http.MethodHead {
		_, _ = w.Write(page)
	}
}

func sendFile(w http.ResponseWriter, r *http.Request, f StaticFile) {
	v := FileVariantFor(f, r.Header.Get("accept"), r.Header.Get("accept-encoding"), isFile)
	file, err := os.Open(v.File)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	h := w.Header()
	h.Set("content-type", pick(v.Type != "", v.Type, f.Type))
	h.Set("cache-control", f.Cache)
	if v.Encoding != "" {
		h.Set("content-encoding", v.Encoding)
	}
	if v.Vary != "" {
		h.Set("vary", v.Vary)
	}
	if st, err := file.Stat(); err == nil {
		h.Set("content-length", fmt.Sprint(st.Size()))
	}
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, file)
	}
}

// origin is the address the browser used. Only Whisk's edge reaches the app, and only for the
// app's own names, so the forwarded host and protocol are trusted.
func origin(r *http.Request) string {
	proto := pick(r.Header.Get("x-forwarded-proto") != "", r.Header.Get("x-forwarded-proto"), "http")
	host := pick(r.Header.Get("x-forwarded-host") != "", r.Header.Get("x-forwarded-host"), r.Host)
	first, _, _ := strings.Cut(host, ",")
	return proto + "://" + strings.TrimSpace(first)
}

// handler is a page or form of the shop.
type handler func(v Visitor) (Answer, error)

// shopRoutes are the shop's own pages and forms; any other address is the website's page there.
func (f *front) shopRoutes() *http.ServeMux {
	mux := http.NewServeMux()
	page := func(pattern string, h handler) { mux.Handle(pattern, f.serveShop(h)) }
	param := func(name string, h func(Visitor, string) (Answer, error)) func(*http.Request) handler {
		return func(r *http.Request) handler {
			return func(v Visitor) (Answer, error) { return h(v, r.PathValue(name)) }
		}
	}
	withParam := func(pattern, name string, h func(Visitor, string) (Answer, error)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) { f.serveShop(param(name, h)(r)).ServeHTTP(w, r) })
	}
	page("GET /{$}", ContentPageAt)
	page("GET /products", func(v Visitor) (Answer, error) { return ShopHome(v, "Products") })
	withParam("GET /products/{handle}", "handle", ProductPageAt)
	withParam("GET /categories/{path...}", "path", CategoryPage)
	withParam("GET /collections/{handle}", "handle", CollectionPage)
	page("GET /search", SearchPage)
	page("GET /cart", CartPage)
	page("POST /cart/add", AddToCart)
	page("POST /cart/update", UpdateCart)
	page("GET /checkout", CheckoutPage)
	page("POST /checkout/details", CheckoutDetails)
	page("POST /checkout/delivery", CheckoutDelivery)
	page("POST /checkout/payment", CheckoutPayment)
	page("POST /checkout/complete", CheckoutComplete)
	page("GET /checkout/return/stripe", StripeReturn)
	page("GET /checkout/return/windcave", WindcaveReturn)
	page("GET /account", AccountPage)
	page("GET /account/password", PasswordPage)
	withParam("GET /account/orders/{id}", "id", MyOrderPage)
	page("POST /account/code", SendCode)
	page("POST /account/code/verify", VerifyCode)
	page("POST /account/sign-in", PasswordSignIn)
	page("POST /account/register", Register)
	page("POST /account/sign-out", SignOut)
	page("POST /account/details", SaveDetails)
	page("POST /account/addresses", SaveAddress)
	page("POST /account/password/request", RequestPassword)
	page("POST /account/password/set", SetPassword)
	withParam("GET /order/{id}", "id", OrderPage)
	page("GET /sitemap.xml", SitemapPage)
	mux.HandleFunc("GET /robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "text/plain; charset=utf-8")
		w.Header().Set("cache-control", "public, max-age=3600")
		_, _ = io.WriteString(w, RobotsTxt(origin(r), f.robots))
	})
	page("GET /", ContentPageAt)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "This address takes no "+r.Method+".", "Use GET for pages and the shop's forms for changes.")
	})
	return mux
}

// serveShop runs a page or form of the shop for this request and writes its Answer.
func (f *front) serveShop(h handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		shop, _ := r.Context().Value(shopKey{}).(Storefront)
		if r.Method == http.MethodPost {
			r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
			if err := r.ParseForm(); err != nil {
				writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "The form could not be read.", "Send the form again, under 64 KB.")
				return
			}
		}
		v := f.visitor(r, shop)
		answer, err := h(v)
		if err != nil {
			f.oneMoment(w, err)
			return
		}
		f.write(w, r, v, answer)
	})
}

func (f *front) visitor(r *http.Request, shop Storefront) Visitor {
	req := requestOf(r)
	cart := ""
	if c, err := r.Cookie(cartCookie); err == nil {
		cart = c.Value
	}
	market := SiteMarket(f.cfg.Markets, SiteHost(req.Headers))
	if shop.Market.Key != "" && len(f.cfg.Markets) > 1 {
		market = shop.Market.Key
	}
	preview := IsStaff(req.Headers) && r.URL.Query().Get("preview") == "1"
	o := origin(r)
	proto, host, _ := strings.Cut(o, "://")
	return Visitor{
		Ctx: r.Context(), Shop: shop, Content: f.content, URL: *r.URL, Origin: o, Form: r.PostForm, Cart: cart, Now: time.Now(),
		Ask: Asker{Preview: preview, Identity: req.Headers, Market: market},
		API: NewAPI(shop, Visit{Cookie: r.Header.Get("cookie"), Proto: proto, Host: host, ForwardedFor: r.Header.Get("x-forwarded-for")}, f.client),
	}
}

// write writes an Answer: the cookies the API set and the shop's own, then a redirect, JSON, the
// sitemap or a page in its frame.
func (f *front) write(w http.ResponseWriter, r *http.Request, v Visitor, a Answer) {
	for _, c := range v.API.SetCookies() {
		w.Header().Add("set-cookie", c)
	}
	for _, c := range a.Cookies {
		http.SetCookie(w, c)
	}
	status := pick(a.Status != 0, a.Status, http.StatusOK)
	switch {
	case a.Location != "":
		w.Header().Set("cache-control", "no-store")
		http.Redirect(w, r, a.Location, status)
		return
	case a.JSON != nil:
		w.Header().Set("content-type", "application/json")
		w.Header().Set("cache-control", "no-store")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(a.JSON)
		return
	}
	if xml, ok := a.Data.(string); ok && a.Page == "" && !a.NotFound {
		w.Header().Set("content-type", "application/xml; charset=utf-8")
		w.Header().Set("cache-control", "public, max-age=3600")
		_, _ = io.WriteString(w, xml)
		return
	}
	if a.NotFound {
		a = Answer{Status: http.StatusNotFound, Page: "not-found", Frame: Frame{Title: "Not found", Noindex: true}}
	}
	theme, err := f.theme()
	if err != nil {
		f.oneMoment(w, err)
		return
	}
	body, err := theme.Render("shop", f.view(v, a, theme))
	if err != nil {
		f.oneMoment(w, err)
		return
	}
	w.Header().Set("content-type", "text/html; charset=utf-8")
	// Pages with a person's own things (a cart, an account) or drafts are never kept; the edge keeps
	// a few minutes of the rest.
	w.Header().Set("cache-control", pick(a.Frame.Noindex || v.Ask.Preview || IsStaff(requestOf(r).Headers), "private, no-store", "public, max-age=300"))
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}

// view is what the frame reads: the page's own, with the menus, the cart's count, the top
// categories and the home page's picture, read side by side.
func (f *front) view(v Visitor, a Answer, theme Theme) View {
	var (
		wg      sync.WaitGroup
		cart    Cart
		cats    []Category
		menus   Menus
		home    ContentPage
		hasHome bool
	)
	wg.Add(3)
	go func() { defer wg.Done(); cart, _, _ = v.API.Cart(v.Ctx, v.Cart) }()
	go func() { defer wg.Done(); cats, _ = v.API.Categories(v.Ctx) }()
	go func() { defer wg.Done(); menus = v.Content.Menus(v.Ctx, v.Ask) }()
	if a.Frame.Image == "" {
		wg.Add(1)
		go func() { defer wg.Done(); home, hasHome, _ = v.Content.PageAt(v.Ctx, v.Ask, "/") }()
	}
	wg.Wait()
	return BuildView(v, a, ViewParts{Cart: cart, Categories: cats, Menus: menus, Home: home, HasHome: hasHome, CSS: theme.CSS()})
}

// oneMoment is the page shown when a page fails. It uses no theme, menus or shop, which may be
// what failed, and tries again by itself.
func (f *front) oneMoment(w http.ResponseWriter, err error) {
	slog.Error("page failed", "error", err.Error())
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.Header().Set("retry-after", "15")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = io.WriteString(w, oneMomentPage)
}

const oneMomentPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="15"><title>One moment</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px;text-align:center}</style></head><body><main><h1>One moment</h1><p>The shop is busy. This page tries again by itself.</p><p><a href="/products">Back to the shop</a></p></main></body></html>`

// ViewParts are what the frame reads besides the page: read side by side for each page.
type ViewParts struct {
	Cart       Cart
	Categories []Category
	Menus      Menus
	Home       ContentPage
	HasHome    bool
	CSS        template.CSS
}

// BuildView is what the frame and a page read, from the page's Answer and the frame's parts.
func BuildView(v Visitor, a Answer, p ViewParts) View {
	fr := a.Frame
	image := fr.Image
	if image == "" && p.HasHome {
		image = pick(AsMedia(p.Home.Image).URL != "", AsMedia(p.Home.Image).URL, FirstPicture(p.Home.Layout))
	}
	data := []any{}
	if v.URL.Path == "/" {
		data = append(data, mapOf(SiteLD(v.Origin, v.Shop.Name), func(m map[string]any) any { return m })...)
	}
	if len(fr.Crumbs) > 0 {
		data = append(data, BreadcrumbLD(v.Origin, append([]Crumb{{v.Shop.Name, "/"}}, fr.Crumbs...)))
	}
	data = append(data, fr.LD...)
	return View{
		Frame: fr, Shop: v.Shop, Name: v.Shop.Name,
		Title:      pick(fr.FullTitle != "", fr.FullTitle, TitleWithName(fr.Title, v.Shop.Name)),
		Canonical:  pick(fr.Canonical != "", fr.Canonical, CanonicalURL(v.Origin, v.URL)),
		Image:      ShareImage(v.Origin, image),
		LD:         mapOf(data, jsonLD),
		Alternates: pick(fr.EverySite && !fr.Noindex, v.Shop.Alternates, nil),
		Menus:      p.Menus, Cart: Count(p.Cart), Top: TopCategories(p.Categories),
		Q: v.Q("q"), Path: v.URL.Path, Year: v.Now.Year(), CSS: p.CSS, Page: a.Page, Data: a.Data,
	}
}

// jsonLD is structured data for a <script type="application/ld+json">, with < escaped.
func jsonLD(d any) template.JS {
	b, _ := json.Marshal(d)
	return template.JS(strings.ReplaceAll(string(b), "<", `<`)) //nolint:gosec // JSON from the shop's own values, < escaped
}

// withHealth is the server's handler with the platform's health check routed by name, as the
// manifest's health.path says; the handler answers everything else.
func withHealth(h http.Handler, ready http.HandlerFunc) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/ready", ready)
	mux.Handle("/", h)
	return mux
}
