// The shop's catalogue, cart, orders and customers as the store API answers them (Medusa's shape),
// and the pure helpers that show them: prices, variants, lines, sums and addresses. Table-tested
// (catalogue_test.go).
package main

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Price is a variant's price for the shop's region.
type Price struct {
	Calculated   float64 `json:"calculated_amount"`
	Original     float64 `json:"original_amount"`
	CurrencyCode string  `json:"currency_code"`
}

// Option is a choice a product offers (a size, a colour), and its values.
type Option struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Values []struct {
		Value string `json:"value"`
	} `json:"values"`
}

// Variant is one thing a product is sold as.
type Variant struct {
	ID              string  `json:"id"`
	Title           string  `json:"title"`
	SKU             string  `json:"sku"`
	ManageInventory bool    `json:"manage_inventory"`
	AllowBackorder  bool    `json:"allow_backorder"`
	Inventory       float64 `json:"inventory_quantity"`
	Price           *Price  `json:"calculated_price"`
	Options         []struct {
		OptionID string `json:"option_id"`
		Value    string `json:"value"`
	} `json:"options"`
}

// Category is a product category.
type Category struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Handle      string     `json:"handle"`
	Description string     `json:"description"`
	Parent      string     `json:"parent_category_id"`
	Rank        float64    `json:"rank"`
	Children    []Category `json:"category_children"`
	UpdatedAt   string     `json:"updated_at"`
}

// Collection is a group of products.
type Collection struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Handle    string `json:"handle"`
	UpdatedAt string `json:"updated_at"`
}

// Product is a product with what its page shows.
type Product struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Subtitle    string         `json:"subtitle"`
	Handle      string         `json:"handle"`
	Description string         `json:"description"`
	Thumbnail   string         `json:"thumbnail"`
	Metadata    map[string]any `json:"metadata"`
	Images      []struct {
		URL string `json:"url"`
	} `json:"images"`
	Options    []Option   `json:"options"`
	Variants   []Variant  `json:"variants"`
	Categories []Category `json:"categories"`
	UpdatedAt  string     `json:"updated_at"`
}

// Address is a delivery address, on a cart, an order or a customer.
type Address struct {
	ID                string `json:"id,omitempty"`
	AddressName       string `json:"address_name,omitempty"`
	FirstName         string `json:"first_name"`
	LastName          string `json:"last_name"`
	Company           string `json:"company,omitempty"`
	Address1          string `json:"address_1"`
	Address2          string `json:"address_2,omitempty"`
	City              string `json:"city"`
	PostalCode        string `json:"postal_code"`
	Province          string `json:"province,omitempty"`
	CountryCode       string `json:"country_code"`
	Phone             string `json:"phone,omitempty"`
	IsDefaultShipping bool   `json:"is_default_shipping,omitempty"`
}

// Line is a line of a cart or an order.
type Line struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	ProductTitle  string   `json:"product_title"`
	ProductHandle string   `json:"product_handle"`
	VariantTitle  string   `json:"variant_title"`
	Thumbnail     string   `json:"thumbnail"`
	Quantity      int      `json:"quantity"`
	Total         float64  `json:"total"`
	Subtotal      *float64 `json:"subtotal"`
	Variant       *struct {
		Product *struct {
			Handle string `json:"handle"`
		} `json:"product"`
	} `json:"variant"`
}

// ShippingMethod is the delivery chosen for a cart or an order.
type ShippingMethod struct {
	Name             string  `json:"name"`
	Amount           float64 `json:"amount"`
	ShippingOptionID string  `json:"shipping_option_id"`
}

// PaymentSession is a payment begun with a provider.
type PaymentSession struct {
	ID         string         `json:"id"`
	ProviderID string         `json:"provider_id"`
	Status     string         `json:"status"`
	Data       map[string]any `json:"data"`
}

// Sums are a cart's or an order's totals.
type Sums struct {
	ItemTotal        float64  `json:"item_total"`
	ItemSubtotal     *float64 `json:"item_subtotal"`
	ShippingTotal    float64  `json:"shipping_total"`
	ShippingSubtotal *float64 `json:"shipping_subtotal"`
	DiscountTotal    float64  `json:"discount_total"`
	TaxTotal         float64  `json:"tax_total"`
	Total            float64  `json:"total"`
}

// Cart is the visitor's cart.
type Cart struct {
	Sums
	ID                string           `json:"id"`
	Email             string           `json:"email"`
	CurrencyCode      string           `json:"currency_code"`
	CompletedAt       *string          `json:"completed_at"`
	Items             []Line           `json:"items"`
	ShippingAddress   *Address         `json:"shipping_address"`
	ShippingMethods   []ShippingMethod `json:"shipping_methods"`
	PaymentCollection *struct {
		ID       string           `json:"id"`
		Sessions []PaymentSession `json:"payment_sessions"`
	} `json:"payment_collection"`
}

// Order is a placed order.
type Order struct {
	Sums
	ID                 string           `json:"id"`
	DisplayID          int              `json:"display_id"`
	Email              string           `json:"email"`
	CustomerID         string           `json:"customer_id"`
	CreatedAt          string           `json:"created_at"`
	Status             string           `json:"status"`
	PaymentStatus      string           `json:"payment_status"`
	FulfillmentStatus  string           `json:"fulfillment_status"`
	CurrencyCode       string           `json:"currency_code"`
	Items              []Line           `json:"items"`
	ShippingAddress    *Address         `json:"shipping_address"`
	ShippingMethods    []ShippingMethod `json:"shipping_methods"`
	PaymentCollections []struct {
		Payments []PaymentSession `json:"payments"`
		Sessions []PaymentSession `json:"payment_sessions"`
	} `json:"payment_collections"`
}

// Customer is a signed-in customer.
type Customer struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	Phone     string    `json:"phone"`
	Addresses []Address `json:"addresses"`
}

// ShippingOption is a way the shop delivers to a cart's address.
type ShippingOption struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
	Price  *Price  `json:"calculated_price"`
	Type   *struct {
		Description string `json:"description"`
	} `json:"type"`
}

// Money is an amount as the currency's own country writes it: $1,058.00 in Australian dollars on
// an Australian shop, $10.00 in New Zealand dollars on a New Zealand one, US$10.00 elsewhere.
func Money(amount float64, currency string) string {
	c := strings.ToUpper(currency)
	symbol := map[string]string{"NZD": "$", "AUD": "$", "USD": "US$", "EUR": "€", "GBP": "£"}[c]
	if symbol == "" {
		symbol = c + " "
	}
	sign := pick(amount < 0, "-", "")
	cents := int64(math.Round(math.Abs(amount) * 100))
	whole := fmt.Sprint(cents / 100)
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	return fmt.Sprintf("%s%s%s.%02d", sign, symbol, whole, cents%100)
}

// FromPrice is the lowest price among a product's variants, whether it is a sale price, and
// whether prices vary; false when none has a price.
type From struct {
	Amount, Original float64
	Currency         string
	Sale, Varies     bool
}

func FromPrice(variants []Variant) (From, bool) {
	prices := mapOf(filter(variants, func(v Variant) bool { return v.Price != nil }), func(v Variant) Price { return *v.Price })
	if len(prices) == 0 {
		return From{}, false
	}
	low := prices[0]
	for _, p := range prices[1:] {
		if p.Calculated < low.Calculated {
			low = p
		}
	}
	return From{
		Amount: low.Calculated, Original: low.Original, Currency: low.CurrencyCode, Sale: low.Calculated < low.Original,
		Varies: some(prices, func(p Price) bool { return p.Calculated != low.Calculated }),
	}, true
}

// VariantFor is the variant whose options match every choice made, by option id.
func VariantFor(variants []Variant, chosen map[string]string) (Variant, bool) {
	return find(variants, func(v Variant) bool {
		for id, value := range chosen {
			if !some(v.Options, func(o struct {
				OptionID string `json:"option_id"`
				Value    string `json:"value"`
			}) bool {
				return o.OptionID == id && o.Value == value
			}) {
				return false
			}
		}
		return true
	})
}

// InStock says whether a variant can be bought now.
func InStock(v Variant) bool { return !v.ManageInventory || v.AllowBackorder || v.Inventory > 0 }

var defaultVariant = regexp.MustCompile(`(?i)^default( variant)?$`)

// VariantLabel is a line's variant, worth showing beside its product: not when it only repeats
// the product's title or is the one variant a product with no options has.
func VariantLabel(l Line) string {
	v := strings.TrimSpace(l.VariantTitle)
	if v == "" || v == strings.TrimSpace(pick(l.ProductTitle != "", l.ProductTitle, l.Title)) || defaultVariant.MatchString(v) {
		return ""
	}
	return v
}

// LineAmount is a line's amount as the market writes it: with the tax where prices include it,
// before it where it is added on top.
func LineAmount(l Line, taxInclusive bool) float64 {
	if taxInclusive || l.Subtotal == nil {
		return l.Total
	}
	return *l.Subtotal
}

// Shown are a cart's or an order's sums as the market writes them.
type Shown struct {
	Subtotal, Shipping, Discount, Tax, Total float64
}

// SumsFor are the sums to show: where prices include the tax, lines and the subtotal carry it and
// a note under the total says how much was in it; where it is added on top, the subtotal is
// before it and the tax is its own line above the total.
func SumsFor(s Sums, taxInclusive bool) Shown {
	or := func(p *float64, d float64) float64 {
		if p == nil {
			return d
		}
		return *p
	}
	return Shown{
		Subtotal: pick(taxInclusive, s.ItemTotal, or(s.ItemSubtotal, s.ItemTotal)),
		Shipping: pick(taxInclusive, s.ShippingTotal, or(s.ShippingSubtotal, s.ShippingTotal)),
		Discount: s.DiscountTotal, Tax: s.TaxTotal, Total: s.Total,
	}
}

// AddressFrom is an address from a checkout or account form, or the fields still missing.
func AddressFrom(form url.Values, country string) (Address, []string) {
	f := func(k string) string { return strings.TrimSpace(form.Get(k)) }
	a := Address{
		FirstName: f("first_name"), LastName: f("last_name"), Company: f("company"), Address1: f("address_1"), Address2: f("address_2"),
		City: f("city"), PostalCode: f("postal_code"), Province: f("province"), CountryCode: strings.ToLower(pick(f("country_code") != "", f("country_code"), country)),
		Phone: f("phone"),
	}
	required := [][2]string{{"first_name", a.FirstName}, {"last_name", a.LastName}, {"address_1", a.Address1}, {"city", a.City}, {"postal_code", a.PostalCode}}
	missing := mapOf(filter(required, func(r [2]string) bool { return r[1] == "" }), func(r [2]string) string { return r[0] })
	if len(missing) > 0 {
		return Address{}, missing
	}
	return a, nil
}

// Plain is an address as the API takes it on a cart: only the fields of the address itself.
func (a Address) Plain() Address {
	a.ID, a.AddressName, a.IsDefaultShipping = "", "", false
	return a
}

var localPath = regexp.MustCompile(`^/[^/\\]`)

// SafeReturn is where a form may send someone after it: a path on this shop, never another site.
func SafeReturn(to, fallback string) string {
	if to == "/" || localPath.MatchString(to) {
		return to
	}
	return fallback
}

const minPassword = 10

var emailShape = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// PasswordProblem is what is wrong with a new password, or "".
func PasswordProblem(p string) string {
	if len([]rune(p)) < minPassword {
		return fmt.Sprintf("Use at least %d characters for the password.", minPassword)
	}
	return ""
}

// RegisterProblem is what is wrong with a new account's details, or "".
func RegisterProblem(email, password, first, last string) string {
	switch {
	case !emailShape.MatchString(email):
		return "Check your email address."
	case first == "" || last == "":
		return "Fill in your name."
	}
	return PasswordProblem(password)
}

// OrderStatus is where an order is, as its customer reads it.
func OrderStatus(o Order) string {
	switch {
	case o.Status == "canceled":
		return "Cancelled"
	case o.FulfillmentStatus == "delivered":
		return "Delivered"
	case o.FulfillmentStatus == "shipped" || o.FulfillmentStatus == "partially_shipped":
		return "Sent"
	case o.PaymentStatus == "not_paid" || o.PaymentStatus == "awaiting":
		return "Awaiting payment"
	}
	return "Being prepared"
}

// AwaitingTransfer says whether an order waits on a bank transfer the customer is shown how to make.
func AwaitingTransfer(o Order, bank *BankAccount) bool {
	var providers []string
	for _, c := range o.PaymentCollections {
		for _, p := range append(append([]PaymentSession{}, c.Payments...), c.Sessions...) {
			providers = append(providers, p.ProviderID)
		}
	}
	return len(providers) > 0 && providers[0] == "pp_system_default" && bank != nil && o.PaymentStatus != "captured" && o.Status != "canceled"
}

// ActiveSession is the cart's payment begun and not cancelled, if any.
func ActiveSession(c Cart) (PaymentSession, bool) {
	if c.PaymentCollection == nil {
		return PaymentSession{}, false
	}
	return find(c.PaymentCollection.Sessions, func(s PaymentSession) bool { return s.Status != "canceled" })
}

// Count is how many things are in a cart.
func Count(c Cart) int {
	n := 0
	for _, l := range c.Items {
		n += l.Quantity
	}
	return n
}

// TopCategories are the categories the header lists: the top level, in their order, at most 12.
func TopCategories(all []Category) []Category {
	top := filter(all, func(c Category) bool { return c.Parent == "" })
	for i := 1; i < len(top); i++ {
		for j := i; j > 0 && top[j].Rank < top[j-1].Rank; j-- {
			top[j], top[j-1] = top[j-1], top[j]
		}
	}
	return top[:min(12, len(top))]
}

// DateIn is a time as the market writes a date, in its time zone: 16 Nov 2026.
func DateIn(s, zone string) string {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return ""
	}
	if loc, err := time.LoadLocation(zone); err == nil {
		t = t.In(loc)
	}
	return t.Format("2 Jan 2006")
}

// ShopAddress is a shop page's one address, without a last slash, and the product list at
// /products (/shop, its other address, goes there); "" when the path is its own. The website's
// pages keep the address each was given.
var shopPages = regexp.MustCompile(`^/(products|categories|collections|search|cart|checkout|account|order)(/[^/]|$)`)

func ShopAddress(p string) string {
	switch {
	case p == "/shop" || p == "/shop/":
		return "/products"
	case p == "/" || !strings.HasSuffix(p, "/"):
		return ""
	}
	trimmed := strings.TrimRight(p, "/")
	if shopPages.MatchString(trimmed) && !strings.Contains(trimmed, "//") {
		return trimmed
	}
	return ""
}

// Pager is a list's place among its pages.
type Pager struct {
	Page, Pages int
	Prev, Next  string
}

// PagerFor is the pages of a list of count things at perPage, at page, with the address of each.
func PagerFor(base url.URL, count, page, perPage int) Pager {
	pages := max(1, (count+perPage-1)/perPage)
	at := func(n int) string {
		q := base.Query()
		q.Del("page")
		if n > 1 {
			q.Set("page", fmt.Sprint(n))
		}
		return base.Path + withMark(q.Encode())
	}
	return Pager{Page: page, Pages: pages, Prev: pick(page > 1, at(page-1), ""), Next: pick(page < pages, at(page+1), "")}
}

// PageNumber is the page asked for in ?page=, at least 1.
func PageNumber(q url.Values) int {
	var n int
	if _, err := fmt.Sscan(q.Get("page"), &n); err != nil || n < 1 {
		return 1
	}
	return n
}

// OptionAmount is what a way of delivering costs: its price for this cart when the shop
// worked one out, else its set amount.
func OptionAmount(o ShippingOption) float64 {
	if o.Price != nil {
		return o.Price.Calculated
	}
	return o.Amount
}

// AddressLabel names a saved address in a list: its name, street and town, those it has.
func AddressLabel(a Address) string {
	return strings.Join(filter([]string{a.AddressName, a.Address1, a.City}, func(s string) bool { return s != "" }), ", ")
}
