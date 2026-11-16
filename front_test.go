package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// fakeEngine answers the store API as the commerce engine does, from fixtures. A request with the
// cookie signed=1 is a signed-in customer's.
func fakeEngine(t *testing.T) *httptest.Server {
	t.Helper()
	price := map[string]any{"calculated_amount": 25, "original_amount": 25, "currency_code": "usd"}
	variant := map[string]any{"id": "v1", "title": "Large", "sku": "MUG-L", "manage_inventory": false, "calculated_price": price,
		"options": []any{map[string]any{"option_id": "o1", "value": "Large"}}}
	product := map[string]any{"id": "p1", "title": "Camp mug", "handle": "camp-mug", "description": "A mug for the trail.",
		"thumbnail": "https://cdn.example.com/mug.jpg", "images": []any{map[string]any{"url": "https://cdn.example.com/mug.jpg"}},
		"options":  []any{map[string]any{"id": "o1", "title": "Size", "values": []any{map[string]any{"value": "Large"}}}},
		"variants": []any{variant}, "categories": []any{map[string]any{"id": "c1", "name": "Kitchen", "handle": "kitchen"}}}
	line := map[string]any{"id": "l1", "title": "Large", "product_title": "Camp mug", "product_handle": "camp-mug", "quantity": 2,
		"unit_price": 25, "total": 50, "subtotal": 50, "thumbnail": "https://cdn.example.com/mug.jpg", "variant_id": "v1"}
	address := map[string]any{"id": "a1", "first_name": "Jordan", "last_name": "Lee", "address_1": "100 Main Street", "city": "Springfield",
		"postal_code": "62701", "country_code": "us", "is_default_shipping": true}
	cart := map[string]any{"id": "cart1", "email": "jordan@example.com", "currency_code": "usd", "items": []any{line}, "item_total": 50,
		"total": 60, "shipping_total": 10, "tax_total": 0, "shipping_address": address,
		"shipping_methods": []any{map[string]any{"id": "sm1", "name": "Courier", "amount": 10, "shipping_option_id": "so1"}}}
	order := map[string]any{"id": "order1", "display_id": 1042, "email": "jordan@example.com", "customer_id": "cus1",
		"created_at": "2026-11-02T18:00:00Z", "status": "pending", "payment_status": "captured", "fulfillment_status": "not_fulfilled",
		"currency_code": "usd", "items": []any{line}, "item_total": 50, "total": 60, "shipping_total": 10, "shipping_address": address,
		"shipping_methods": []any{map[string]any{"id": "sm1", "name": "Courier", "amount": 10}}}
	customer := map[string]any{"id": "cus1", "email": "jordan@example.com", "first_name": "Jordan", "last_name": "Lee", "addresses": []any{address}}
	category := map[string]any{"id": "c1", "name": "Kitchen", "handle": "kitchen", "description": "Things for the kitchen."}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		signed := strings.Contains(r.Header.Get("cookie"), "signed=1")
		w.Header().Set("content-type", "application/json")
		answer := func(v any) { _ = json.NewEncoder(w).Encode(v) }
		p := r.URL.Path
		var sent map[string]any
		_ = json.NewDecoder(r.Body).Decode(&sent)
		switch {
		case r.Method == http.MethodPost && p == "/store/carts":
			answer(map[string]any{"cart": map[string]any{"id": "cart2", "currency_code": "usd"}})
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/line-items") && sent["variant_id"] == "v-gone":
			w.WriteHeader(http.StatusBadRequest)
			answer(map[string]any{"message": "That size is sold out."})
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/line-items"):
			answer(map[string]any{"cart": cart})
		case r.Method == http.MethodPost && p == "/auth/sign-in-code":
			http.SetCookie(w, &http.Cookie{Name: "code_for", Value: "b1", Path: "/"})
			answer(map[string]any{"ok": true})
		case r.Method == http.MethodPost && p == "/auth/sign-in-code/verify" && sent["code"] != "123456":
			w.WriteHeader(http.StatusUnauthorized)
			answer(map[string]any{"message": "That code is not right."})
		case r.Method == http.MethodPost && p == "/auth/sign-in-code/verify":
			answer(map[string]any{"ok": true})
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/customer"):
			answer(map[string]any{"cart": cart})
		case r.Method == http.MethodDelete && p == "/auth/session":
			answer(map[string]any{"ok": true})
		case r.Method == http.MethodPost && p == "/store/carts/cart1/complete":
			answer(map[string]any{"type": "order", "order": order})
		case p == "/store/products" && r.URL.Query().Get("handle") == "nothing-here":
			answer(map[string]any{"products": []any{}, "count": 0})
		case p == "/store/products":
			answer(map[string]any{"products": []any{product}, "count": 1})
		case p == "/store/product-categories":
			answer(map[string]any{"product_categories": []any{category}})
		case p == "/store/collections":
			answer(map[string]any{"collections": []any{map[string]any{"id": "col1", "title": "Summer", "handle": "summer"}}})
		case p == "/store/carts/cart1":
			answer(map[string]any{"cart": cart})
		case p == "/store/shipping-options":
			answer(map[string]any{"shipping_options": []any{
				map[string]any{"id": "so1", "name": "Courier", "amount": 10, "calculated_price": price},
				map[string]any{"id": "so2", "name": "Pick up", "amount": 0}}})
		case p == "/store/customers/me" && signed:
			answer(map[string]any{"customer": customer})
		case p == "/store/customers/me":
			w.WriteHeader(http.StatusUnauthorized)
			answer(map[string]any{"message": "Unauthorized"})
		case p == "/store/orders":
			answer(map[string]any{"orders": []any{order}})
		case p == "/store/orders/order1":
			answer(map[string]any{"order": order})
		default:
			w.WriteHeader(http.StatusNotFound)
			answer(map[string]any{"message": "Not found"})
		}
	}))
}

// fakeCMS answers the content API with no pages, so the shop's own pages show.
func fakeCMS() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		if strings.Contains(r.URL.Path, "/globals/") {
			_, _ = io.WriteString(w, `{"main":[{"label":"About","href":"/about"}]}`)
			return
		}
		_, _ = io.WriteString(w, `{"docs":[],"hasNextPage":false}`)
	}))
}

func testFront(t *testing.T) (*front, string) {
	t.Helper()
	engine, cms := fakeEngine(t), fakeCMS()
	t.Cleanup(engine.Close)
	t.Cleanup(cms.Close)
	theme, err := LoadTheme(os.DirFS("theme"), "shop.css", ShopFuncs())
	if err != nil {
		t.Fatalf("the theme does not parse: %v", err)
	}
	f := &front{
		site:    Site{Public: "public", Has: func(string) bool { return false }},
		theme:   func() (Theme, error) { return theme, nil },
		content: NewHTTPContent(cms.URL),
		client:  &http.Client{},
	}
	f.routes = f.shopRoutes()
	sf, _ := json.Marshal(map[string]any{"api": engine.URL, "publishableKey": "pk_test", "regionId": "reg1", "currency": "usd",
		"name": "Trailhead Goods", "providers": []string{"pp_system_default"},
		"market": map[string]any{"key": "us", "country": "us", "currency": "usd", "name": "United States", "locale": "en-US", "timeZone": "America/Chicago"}})
	return f, base64.RawURLEncoding.EncodeToString(sf)
}

// Every page the shop draws renders through the theme with a catalogue, a cart and a customer.
func TestPagesRender(t *testing.T) {
	f, sf := testFront(t)
	cases := []struct {
		path, cookie string
		status       int
		has          []string
	}{
		{"/", "", 200, []string{"Camp mug", "Trailhead Goods"}},
		{"/products", "", 200, []string{"Camp mug"}},
		{"/products/camp-mug", "", 200, []string{"Camp mug", "A mug for the trail.", `application/ld+json`}},
		{"/products/nothing-here", "", 404, nil},
		{"/categories/kitchen", "", 200, []string{"Kitchen", "Camp mug"}},
		{"/collections/summer", "", 200, []string{"Summer"}},
		{"/search?q=mug", "", 200, []string{"Camp mug"}},
		{"/cart", "", 200, []string{"Your cart is empty"}},
		{"/cart", "shop_cart=cart1", 200, []string{"Camp mug", "Update"}},
		{"/checkout", "shop_cart=cart1", 200, []string{"Courier, US$10.00", "100 Main Street", "Payment"}},
		{"/checkout?edit=delivery", "shop_cart=cart1", 200, []string{"Pick up", `value="so1" checked`}},
		{"/checkout", "", 303, nil},
		{"/account", "", 200, []string{"Email me a code"}},
		{"/account?step=password", "", 200, []string{"current-password"}},
		{"/account?step=register", "", 200, []string{"Create account"}},
		{"/account?step=code&email=jordan@example.com", "", 200, []string{"Code sent to jordan@example.com"}},
		{"/account", "signed=1", 200, []string{"Jordan", "#1042", "100 Main Street", "Default"}},
		{"/account?address=a1", "signed=1", 200, []string{`name="action" value="edit"`}},
		{"/account?address=new", "signed=1", 200, []string{`name="action" value="add"`}},
		{"/account/password", "", 200, []string{"Email me a link"}},
		{"/account/password?token=t&email=jordan@example.com", "", 200, []string{"Save and sign in"}},
		{"/account/orders/order1", "signed=1", 200, []string{"Order #1042", "2 Nov 2026"}},
		{"/account/orders/order1", "", 302, nil},
		{"/order/order1", "", 200, []string{"Thank you", "Order #1042"}},
		{"/robots.txt", "", 200, []string{"Sitemap:"}},
		{"/sitemap.xml", "", 200, []string{"/products/camp-mug"}},
	}
	for _, c := range cases {
		t.Run(c.path, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, c.path, nil)
			r.Header.Set(storefrontHeader, sf)
			if c.cookie != "" {
				r.Header.Set("cookie", c.cookie)
			}
			w := httptest.NewRecorder()
			f.ServeHTTP(w, r)
			body := w.Body.String()
			if w.Code != c.status {
				t.Fatalf("status %d, want %d: %s", w.Code, c.status, body[:min(len(body), 600)])
			}
			for _, s := range c.has {
				if !strings.Contains(body, s) {
					t.Errorf("the page lacks %q", s)
				}
			}
		})
	}
}

// A browser cannot send the storefront's context: the front drops the header it did not get from
// the engine beside it, so a page without one is the shop's one-moment answer.
func TestStorefrontOnlyFromEngine(t *testing.T) {
	f, _ := testFront(t)
	r := httptest.NewRequest(http.MethodGet, "/products", nil)
	r.Header.Set(storefrontHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"api":"https://elsewhere.example.com"}`)))
	w := httptest.NewRecorder()
	f.ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", w.Code)
	}
}

// The forms answer with where to go next, the cookies to keep and what the shop refused.
func TestForms(t *testing.T) {
	f, sf := testFront(t)
	cases := []struct {
		name, path, form, cookie string
		status                   int
		location                 string
		setCookie                []string
	}{
		{"a first item makes the cart", "/cart/add", "variant_id=v1&quantity=2&return=/products/camp-mug", "", 303, "/products/camp-mug?added=1", []string{"shop_cart=cart2"}},
		{"another item joins the cart", "/cart/add", "variant_id=v1", "shop_cart=cart1", 303, "/cart?added=1", nil},
		{"no option chosen", "/cart/add", "return=/products/camp-mug", "", 303, "/products/camp-mug?error=Choose+an+option+first.", nil},
		{"the shop refuses", "/cart/add", "variant_id=v-gone", "shop_cart=cart1", 303, "/cart?error=That+size+is+sold+out.", nil},
		{"back only to this shop", "/cart/add", "variant_id=v1&return=https://evil.example/x", "shop_cart=cart1", 303, "/cart?added=1", nil},
		{"a code is sent", "/account/code", "email=Jordan@Example.com", "", 303, "/account?email=jordan%40example.com&return=%2Faccount&step=code", []string{"code_for=b1"}},
		{"a wrong code", "/account/code/verify", "email=jordan@example.com&code=1", "", 303, "/account?email=jordan%40example.com&error=That+code+is+not+right.&return=%2Faccount&step=code", nil},
		{"the right code", "/account/code/verify", "email=jordan@example.com&code=123+456&return=/checkout", "shop_cart=cart1", 303, "/checkout", nil},
		{"a weak password", "/account/register", "email=jordan@example.com&password=short&first_name=Jordan&last_name=Lee", "", 303, "", nil},
		{"signing out forgets the cart", "/account/sign-out", "", "shop_cart=cart1", 303, "/", []string{"shop_cart=;"}},
		{"a bad email at checkout", "/checkout/details", "email=nope", "shop_cart=cart1", 303, "/checkout?edit=details&error=Check+your+email+address.", nil},
		{"checkout without a cart", "/checkout/details", "email=jordan@example.com", "", 303, "/cart", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, c.path, strings.NewReader(c.form))
			r.Header.Set("content-type", "application/x-www-form-urlencoded")
			r.Header.Set(storefrontHeader, sf)
			if c.cookie != "" {
				r.Header.Set("cookie", c.cookie)
			}
			w := httptest.NewRecorder()
			f.ServeHTTP(w, r)
			if w.Code != c.status {
				t.Fatalf("status %d, want %d: %s", w.Code, c.status, w.Body.String())
			}
			if got := w.Header().Get("location"); c.location != "" && got != c.location {
				t.Errorf("location %q, want %q", got, c.location)
			}
			set := strings.Join(w.Header().Values("set-cookie"), "\n")
			for _, want := range c.setCookie {
				if !strings.Contains(set, want) {
					t.Errorf("set-cookie %q lacks %q", set, want)
				}
			}
		})
	}
}
