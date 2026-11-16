// The shop's storefront context: what Whisk's commerce engine tells the pages about the shop for
// the site a visitor asked for (commerce/engine api/front.go). An engine inside the app sends it
// with every request it passes on, as base64url JSON in X-Whisk-Storefront; the engine a server
// shares among its shops answers it when the front asks (fromEngine, main.go). Pure.
package main

import (
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strings"
)

const (
	storefrontHeader = "x-whisk-storefront"
	// shopAppHeader names the shop to an engine shared among shops; the engine checks it is the
	// asking app's own.
	shopAppHeader = "x-whisk-shop-app"
)

// Market is where the shop sells: its country, currency, tax and how it writes money and dates.
type Market struct {
	Key          string  `json:"key"`
	Country      string  `json:"country"`
	Currency     string  `json:"currency"`
	Name         string  `json:"name"`
	Locale       string  `json:"locale"`
	TimeZone     string  `json:"timeZone"`
	TaxRate      float64 `json:"taxRate"`
	TaxName      string  `json:"taxName"`
	TaxInclusive bool    `json:"taxInclusive"`
	Host         string  `json:"host"`
}

// BankAccount is the business's account, which customers paying by transfer are shown.
type BankAccount struct {
	AccountName   string `json:"accountName"`
	AccountNumber string `json:"accountNumber"`
}

// Alternate is the same page on the shop's site in another market, for search engines.
type Alternate struct {
	Hreflang string `json:"hreflang"`
	Origin   string `json:"origin"`
}

// Storefront is the shop's context for one site.
type Storefront struct {
	API            string       `json:"api"`
	CMS            string       `json:"cms"`
	PublishableKey string       `json:"publishableKey"`
	RegionID       string       `json:"regionId"`
	Currency       string       `json:"currency"`
	Name           string       `json:"name"`
	Bank           *BankAccount `json:"bank"`
	StripeKey      string       `json:"stripeKey"`
	StripeTestKey  string       `json:"stripeTestKey"`
	PaypalClientID string       `json:"paypalClientId"`
	Providers      []string     `json:"providers"`
	Open           *bool        `json:"open"` // false while the shop's setup is not done: checkout takes no orders
	Market         Market       `json:"market"`
	Alternates     []Alternate  `json:"alternates"`
	App            string       `json:"app"` // named to an engine shared among shops
}

// Closed says whether the shop is not taking orders yet.
func (s Storefront) Closed() bool { return s.Open != nil && !*s.Open }

var base64url = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// contextOf is a JSON value as a storefront context, or false when it is not one the pages can use.
func contextOf(raw []byte) (Storefront, bool) {
	var probe map[string]json.RawMessage
	if json.Unmarshal(raw, &probe) != nil {
		return Storefront{}, false
	}
	isString := func(k string) bool {
		var s string
		return json.Unmarshal(probe[k], &s) == nil && probe[k] != nil
	}
	var market struct {
		Key *string `json:"key"`
	}
	if !isString("api") || !isString("publishableKey") || !isString("regionId") || !isString("currency") ||
		json.Unmarshal(probe["market"], &market) != nil || market.Key == nil {
		return Storefront{}, false
	}
	var s Storefront
	if json.Unmarshal(raw, &s) != nil {
		return Storefront{}, false
	}
	return s, true
}

// StorefrontFrom is the context the header carries, or false when it carries none to use.
func StorefrontFrom(header string) (Storefront, bool) {
	if !base64url.MatchString(header) {
		return Storefront{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(header, "="))
	if err != nil {
		return Storefront{}, false
	}
	return contextOf(raw)
}

// EngineContext is the context a shared engine answered, reached at its address as the app: the
// pages then call the engine there, naming the app.
func EngineContext(body []byte, engine, app string) (Storefront, bool) {
	s, ok := contextOf(body)
	if !ok {
		return Storefront{}, false
	}
	s.API = strings.TrimRight(engine, "/")
	s.App = app
	return s, true
}

// PaymentMethod is a way to pay the shop offers.
type PaymentMethod struct {
	ID    string
	Label string
	Kind  string // bank_transfer, stripe, windcave, paypal
}

type offered struct {
	on bool
	m  PaymentMethod
}

// PaymentMethods are the ways to pay this shop offers: those the region takes and whose keys are
// set, and bank transfer only once the business has given its account.
func PaymentMethods(s Storefront) []PaymentMethod {
	has := func(id string) bool { return some(s.Providers, func(p string) bool { return p == id }) }
	all := []offered{
		{has("pp_stripe_stripe") && (s.StripeKey != "" || s.StripeTestKey != ""), PaymentMethod{"pp_stripe_stripe", "Card, Apple Pay, Google Pay or Afterpay", "stripe"}},
		{has("pp_windcave_windcave"), PaymentMethod{"pp_windcave_windcave", "Credit or debit card", "windcave"}},
		{has("pp_paypal_paypal") && s.PaypalClientID != "", PaymentMethod{"pp_paypal_paypal", "PayPal", "paypal"}},
		{has("pp_system_default") && s.Bank != nil, PaymentMethod{"pp_system_default", "Bank transfer", "bank_transfer"}},
	}
	return mapOf(filter(all, func(o offered) bool { return o.on }), func(o offered) PaymentMethod { return o.m })
}

// PublishableFor is the Stripe publishable key for a payment: the one of the mode it was made in
// (Stripe's livemode on it), since the shop can switch between live and test.
func PublishableFor(livemode any, keys ...string) string {
	set := filter(keys, func(k string) bool { return k != "" })
	want := map[any]string{true: "pk_live_", false: "pk_test_"}[livemode]
	if k, ok := find(set, func(k string) bool { return want != "" && strings.HasPrefix(k, want) }); ok {
		return k
	}
	if len(set) > 0 {
		return set[0]
	}
	return ""
}
