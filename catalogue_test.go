package main

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func f64(v float64) *float64 { return &v }

func TestMoneyAndPictures(t *testing.T) {
	for _, c := range []struct {
		amount float64
		cur    string
		want   string
	}{{45, "nzd", "$45.00"}, {1058, "aud", "$1,058.00"}, {1234567.5, "nzd", "$1,234,567.50"}, {-3.1, "nzd", "-$3.10"}, {10, "usd", "US$10.00"}} {
		if got := Money(c.amount, c.cur); got != c.want {
			t.Errorf("Money(%v, %s) = %q, want %q", c.amount, c.cur, got, c.want)
		}
	}
	img := "/.whisk/img/01J"
	srcset := strings.Join(mapOf([]int{160, 300, 320, 480, 600}, func(w int) string { return img + "?w=" + itoa(w) + "&format=auto " + itoa(w) + "w" }), ", ")
	if got := Picture("https://k.whisk.page"+img+"?w=1", 300); got != (Pic{Src: img + "?w=300&format=auto", Srcset: srcset, Sizes: "300px"}) {
		t.Errorf("%+v", got)
	}
	if got := Picture(img, 72).Srcset; got != img+"?w=72&format=auto 72w, "+img+"?w=144&format=auto 144w" {
		t.Error(got)
	}
	if Picture("https://elsewhere/a.png", 300) != (Pic{Src: "https://elsewhere/a.png"}) || Picture("", 300) != (Pic{}) {
		t.Error("plain pictures")
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func price(calculated, original float64) Variant {
	return Variant{Price: &Price{Calculated: calculated, Original: original, CurrencyCode: "nzd"}}
}

func TestFromPrice(t *testing.T) {
	if _, ok := FromPrice(nil); ok {
		t.Error("no prices")
	}
	if got, _ := FromPrice([]Variant{price(45, 45)}); got != (From{Amount: 45, Original: 45, Currency: "nzd"}) {
		t.Errorf("%+v", got)
	}
	if got, _ := FromPrice([]Variant{price(50, 50), price(40, 45)}); got != (From{Amount: 40, Original: 45, Currency: "nzd", Sale: true, Varies: true}) {
		t.Errorf("%+v", got)
	}
}

func TestVariantFor(t *testing.T) {
	var vs []Variant
	_ = json.Unmarshal([]byte(`[{"id":"a","options":[{"option_id":"colour","value":"Red"},{"option_id":"size","value":"S"}]},{"id":"b","options":[{"option_id":"colour","value":"Red"},{"option_id":"size","value":"M"}]}]`), &vs)
	if v, _ := VariantFor(vs, map[string]string{"colour": "Red", "size": "M"}); v.ID != "b" {
		t.Error("b")
	}
	if _, ok := VariantFor(vs, map[string]string{"colour": "Blue"}); ok {
		t.Error("blue")
	}
	if v, _ := VariantFor(vs, nil); v.ID != "a" {
		t.Error("a")
	}
	if !InStock(Variant{}) || InStock(Variant{ManageInventory: true}) || !InStock(Variant{ManageInventory: true, AllowBackorder: true}) || !InStock(Variant{ManageInventory: true, Inventory: 2}) {
		t.Error("InStock")
	}
}

func TestAddressFrom(t *testing.T) {
	form := url.Values{"first_name": {" Jane "}, "last_name": {"Doe"}, "address_1": {"100 Main Street"}, "city": {"Springfield"}, "postal_code": {"1010"}}
	got, missing := AddressFrom(form, "nz")
	if missing != nil || got != (Address{FirstName: "Jane", LastName: "Doe", Address1: "100 Main Street", City: "Springfield", PostalCode: "1010", CountryCode: "nz"}) {
		t.Errorf("%+v %v", got, missing)
	}
	form.Del("city")
	if _, missing := AddressFrom(form, "nz"); !reflect.DeepEqual(missing, []string{"city"}) {
		t.Error(missing)
	}
}

func TestSafeReturn(t *testing.T) {
	for to, want := range map[string]string{"/checkout": "/checkout", "/account?x=1": "/account?x=1", "//evil.com": "/", "https://evil.com": "/", "": "/", "/\\evil.com": "/"} {
		if got := SafeReturn(to, "/"); got != want {
			t.Errorf("SafeReturn(%q) = %q", to, got)
		}
	}
}

func TestCookiesAndQuery(t *testing.T) {
	cases := []struct {
		header string
		set    []string
		want   string
	}{
		{"a=1; shop_cart=c1", []string{"shop_session=s2; Path=/; HttpOnly"}, "a=1; shop_cart=c1; shop_session=s2"},
		{"shop_session=old; a=1", []string{"shop_session=new; Path=/"}, "shop_session=new; a=1"},
		{"shop_session=old; a=1", []string{"shop_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"}, "a=1"},
		{"", nil, ""},
	}
	for _, c := range cases {
		if got := MergedCookies(c.header, c.set); got != c.want {
			t.Errorf("MergedCookies(%q) = %q, want %q", c.header, got, c.want)
		}
	}
	if got := Query("a", 1, "b", "", "c", nil, "id", []string{"x", "y"}); got != "?a=1&id=x&id=y" {
		t.Error(got)
	}
	if Query() != "" {
		t.Error("empty")
	}
}

func TestAccounts(t *testing.T) {
	if !strings.Contains(PasswordProblem("short"), "10 characters") || PasswordProblem("long enough pass") != "" {
		t.Error("passwords")
	}
	if RegisterProblem("jane@example.com", "long enough pass", "Jane", "Doe") != "" ||
		!strings.Contains(RegisterProblem("nope", "long enough pass", "K", "T"), "email") ||
		!strings.Contains(RegisterProblem("k@e.com", "long enough pass", "", "T"), "name") {
		t.Error("register")
	}
}

func TestSumsAndLines(t *testing.T) {
	s := Sums{ItemTotal: 1163.8, ItemSubtotal: f64(1058), ShippingTotal: 16.5, ShippingSubtotal: f64(15), TaxTotal: 107.3, Total: 1180.3}
	if got := SumsFor(s, true); got != (Shown{Subtotal: 1163.8, Shipping: 16.5, Tax: 107.3, Total: 1180.3}) {
		t.Errorf("%+v", got)
	}
	if got := SumsFor(s, false); got != (Shown{Subtotal: 1058, Shipping: 15, Tax: 107.3, Total: 1180.3}) {
		t.Errorf("%+v", got)
	}
	if LineAmount(Line{Total: 1163.8, Subtotal: f64(1058)}, true) != 1163.8 || LineAmount(Line{Total: 1163.8, Subtotal: f64(1058)}, false) != 1058 || LineAmount(Line{Total: 10}, false) != 10 {
		t.Error("LineAmount")
	}
	for l, want := range map[Line]string{
		{ProductTitle: "LT7", VariantTitle: "LT7"}:      "",
		{Title: "Mug", VariantTitle: "Default variant"}: "",
		{ProductTitle: "Goggles", VariantTitle: "Low"}:  "Low",
		{ProductTitle: "Goggles"}:                       "",
	} {
		if got := VariantLabel(l); got != want {
			t.Errorf("VariantLabel(%+v) = %q", l, got)
		}
	}
}

func TestShopAddress(t *testing.T) {
	cases := map[string]string{
		"/shop": "/products", "/shop/": "/products", "/products/": "/products", "/products": "",
		"/products/work-gloves/": "/products/work-gloves", "/products/work-gloves//": "/products/work-gloves",
		"/categories/gloves/": "/categories/gloves", "/categories/tools/gloves/": "/categories/tools/gloves",
		"/collections/new/": "/collections/new", "/cart/": "/cart", "/account/orders/": "/account/orders",
		"/": "", "/about-us/": "", "/products-guide/": "", "//products/": "", "/products//evil.example/": "",
	}
	for p, want := range cases {
		if got := ShopAddress(p); got != want {
			t.Errorf("ShopAddress(%q) = %q, want %q", p, got, want)
		}
	}
}

func TestOrdersAndCarts(t *testing.T) {
	for o, want := range map[string]string{
		`{"status":"canceled"}`:                      "Cancelled",
		`{"fulfillment_status":"delivered"}`:         "Delivered",
		`{"fulfillment_status":"partially_shipped"}`: "Sent",
		`{"payment_status":"awaiting"}`:              "Awaiting payment",
		`{"payment_status":"captured"}`:              "Being prepared",
	} {
		var order Order
		_ = json.Unmarshal([]byte(o), &order)
		if got := OrderStatus(order); got != want {
			t.Errorf("%s: %q", o, got)
		}
	}
	var order Order
	_ = json.Unmarshal([]byte(`{"payment_status":"awaiting","payment_collections":[{"payment_sessions":[{"provider_id":"pp_system_default"}]}]}`), &order)
	if !AwaitingTransfer(order, &BankAccount{}) || AwaitingTransfer(order, nil) {
		t.Error("AwaitingTransfer")
	}
	var cart Cart
	_ = json.Unmarshal([]byte(`{"items":[{"quantity":2},{"quantity":1}],"payment_collection":{"payment_sessions":[{"id":"a","status":"canceled"},{"id":"b","status":"pending"}]}}`), &cart)
	if s, ok := ActiveSession(cart); !ok || s.ID != "b" || Count(cart) != 3 {
		t.Error("cart")
	}
	top := TopCategories([]Category{{Name: "b", Rank: 2}, {Name: "child", Parent: "x"}, {Name: "a", Rank: 1}})
	if len(top) != 2 || top[0].Name != "a" {
		t.Errorf("%+v", top)
	}
	if DateIn("2026-11-15T20:00:00Z", "Pacific/Auckland") != "16 Nov 2026" {
		t.Error(DateIn("2026-11-15T20:00:00Z", "Pacific/Auckland"))
	}
	base, _ := url.Parse("/products?q=x&page=2")
	if p := PagerFor(*base, 50, 2, 24); p != (Pager{Page: 2, Pages: 3, Prev: "/products?q=x", Next: "/products?page=3&q=x"}) {
		t.Errorf("%+v", p)
	}
	if PageNumber(url.Values{"page": {"abc"}}) != 1 || PageNumber(url.Values{"page": {"3"}}) != 3 {
		t.Error("PageNumber")
	}
}

func TestStorefrontContext(t *testing.T) {
	encode := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	ctx := map[string]any{"api": "http://127.0.0.1:8080", "publishableKey": "pk_1", "regionId": "reg_1", "currency": "nzd", "market": map[string]any{"key": "nz"}}
	if s, ok := StorefrontFrom(encode(ctx)); !ok || s.API != "http://127.0.0.1:8080" || s.Market.Key != "nz" {
		t.Error("a context")
	}
	bad := map[string]any{"api": 1, "publishableKey": "pk_1", "regionId": "reg_1", "currency": "nzd", "market": map[string]any{"key": "nz"}}
	for _, h := range []string{"", "not base64!", encode(bad), encode([]int{1}), base64.RawURLEncoding.EncodeToString([]byte("{"))} {
		if _, ok := StorefrontFrom(h); ok {
			t.Errorf("%q is a context", h)
		}
	}
	body, _ := json.Marshal(ctx)
	if s, ok := EngineContext(body, "http://10.0.3.1:9300/", "app_1"); !ok || s.API != "http://10.0.3.1:9300" || s.App != "app_1" {
		t.Error("engine context")
	}
	if _, ok := EngineContext([]byte("null"), "http://e", "a"); ok {
		t.Error("null")
	}
	open := false
	if !(Storefront{Open: &open}).Closed() || (Storefront{}).Closed() {
		t.Error("Closed")
	}
	shop := Storefront{Providers: []string{"pp_stripe_stripe", "pp_system_default", "pp_paypal_paypal"}, StripeTestKey: "pk_test_1"}
	if got := mapOf(PaymentMethods(shop), func(m PaymentMethod) string { return m.Kind }); !reflect.DeepEqual(got, []string{"stripe"}) {
		t.Error(got)
	}
	if PublishableFor(true, "pk_test_1", "pk_live_1") != "pk_live_1" || PublishableFor(false, "pk_live_1", "", "pk_test_1") != "pk_test_1" || PublishableFor(nil, "", "pk_x") != "pk_x" {
		t.Error("PublishableFor")
	}
	markets := MarketHosts("nz=www.example.co.nz, au=example.com.au")
	if SiteMarket(markets, "EXAMPLE.com.au:443") != "au" || SiteMarket(markets, "other.example") != "nz" || SiteMarket(MarketHosts(""), "x") != "" {
		t.Error("SiteMarket")
	}
}

func TestCardImg(t *testing.T) {
	first := string(CardImg("https://cdn.example.com/mug.jpg", true, true))
	next := string(CardImg("https://cdn.example.com/mug.jpg", true, false))
	later := string(CardImg("https://cdn.example.com/mug.jpg", false, false))
	has := func(s string, parts ...string) bool {
		for _, p := range parts {
			if !strings.Contains(s, p) {
				return false
			}
		}
		return true
	}
	if !has(first, `loading="eager"`, `fetchpriority="high"`) || !has(next, `loading="eager"`, `fetchpriority="auto"`) || !has(later, `loading="lazy"`, `fetchpriority="auto"`) {
		t.Errorf("first %s\nnext %s\nlater %s", first, next, later)
	}
	if !strings.Contains(first, `width="400" height="400"`) || CardImg("", true, true) != "" {
		t.Errorf("a card's picture is square, and nothing without one: %s", first)
	}
}
