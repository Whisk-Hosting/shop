// The shop's pages, each a function from the visit to an Answer. The frame around each page
// (theme/shop.html) is drawn by the shell (main.go) from the Answer's Frame.
package main

import (
	"fmt"
	"net/http"
	"strings"
)

const perPage = 24

// Grid is a page of products and where it is among the pages.
type Grid struct {
	Products []Product
	Pager    Pager
	Empty    string
}

func (v Visitor) grid(pq ProductQuery, empty string) (Grid, error) {
	page := PageNumber(v.URL.Query())
	pq.Limit, pq.Offset = perPage, (page-1)*perPage
	list, count, err := v.API.Products(v.Ctx, pq)
	return Grid{Products: list, Pager: PagerFor(v.URL, count, page, perPage), Empty: empty}, err
}

func titles(ps []Product) []string {
	return mapOf(ps[:min(6, len(ps))], func(p Product) string { return p.Title })
}

// ContentPage draws the website's page at the address, from the editor. The home page is the
// editor's page at /, and the shop's list until there is one. A page asked for without, or with,
// its last slash goes to the address it has.
func ContentPageAt(v Visitor) (Answer, error) {
	p := v.URL.Path
	found, ok, err := v.Content.PageAt(v.Ctx, v.Ask, p)
	switch {
	case err != nil:
		return Answer{}, err
	case !ok && p == "/":
		return ShopHome(v, "")
	case !ok:
		if other, has := OtherForm(p); has {
			if there, ok, _ := v.Content.PageAt(v.Ctx, v.Ask, other); ok {
				return Answer{Status: http.StatusMovedPermanently, Location: there.Path + withMark(v.URL.RawQuery)}, nil
			}
		}
		return notFound(), nil
	}
	layout := v.resolve(found.Layout)
	return Answer{Page: "content", Data: layout, Frame: Frame{
		FullTitle: PageTitle(found, v.Shop.Name), Description: found.Description, Image: AsMedia(found.Image).URL,
		Noindex: found.Noindex || v.Ask.Preview, EverySite: found.Market == "", Head: rawHTML(found.Head), Preview: v.Ask.Preview,
	}}, nil
}

// resolve is a page's blocks with what each needs from the shop read into it: a products block
// gets its products. The blocks given are not changed.
func (v Visitor) resolve(layout []Block) []Block {
	return mapOf(layout, func(b Block) Block {
		if b["blockType"] != "products" {
			return b
		}
		out := make(Block, len(b)+1)
		for k, val := range b {
			out[k] = val
		}
		out["products"] = v.productsBlock(b)
		return out
	})
}

// productsBlock are the products a products block shows: the newest, or a collection's or a
// category's; none when the shop cannot say.
func (v Visitor) productsBlock(b Block) []Product {
	limit := 8
	if n, ok := b["limit"].(float64); ok && n >= 1 {
		limit = min(24, int(n))
	}
	pq := ProductQuery{Limit: limit}
	handle := str(b["handle"])
	switch {
	case b["show"] == "collection" && handle != "":
		c, ok, err := v.API.CollectionByHandle(v.Ctx, handle)
		if err != nil || !ok {
			return nil
		}
		pq.Collection = c.ID
	case b["show"] == "category" && handle != "":
		c, ok, err := v.API.CategoryByHandle(v.Ctx, handle)
		if err != nil || !ok {
			return nil
		}
		pq.Category = c.ID
	}
	list, _, err := v.API.Products(v.Ctx, pq)
	if err != nil {
		return nil
	}
	return list
}

// ShopHome is every product, a page at a time: the list at /products, and the home page until the
// website has one. The list's search details are the team's (Shop in search), else made from what
// it holds; the home page's are the home page's own.
func ShopHome(v Visitor, heading string) (Answer, error) {
	g, err := v.grid(ProductQuery{}, "No products yet.")
	if err != nil {
		return Answer{}, err
	}
	m := v.Content.Menus(v.Ctx, v.Ask)
	atList := v.URL.Path != "/"
	desc := pick(atList && strings.TrimSpace(m.ProductsDescription) != "", strings.TrimSpace(m.ProductsDescription), ListDescription("Shop online", titles(g.Products), v.Shop.Name))
	return Answer{Page: "products", Data: map[string]any{"Heading": pick(heading != "", heading, v.Shop.Name), "Grid": g}, Frame: Frame{
		Title: heading, FullTitle: pick(atList, strings.TrimSpace(m.ProductsTitle), ""), Description: desc, EverySite: !atList,
	}}, nil
}

// ProductView is what a product's page reads.
type ProductView struct {
	Product   Product
	Story     []Block
	Chosen    map[string]string
	Variant   *Variant
	Available bool
	From      *From
	PriceInc  float64 // the price with the tax, where prices are shown before it
	FewLeft   int
	Added     bool
	Failed    string
	Return    string
}

// ProductPageAt is one page per product: its price, options and stock from the shop, read live,
// and its story from the editor's product page of the same handle, when it has one, with its
// search details.
func ProductPageAt(v Visitor, handle string) (Answer, error) {
	p, ok, err := v.API.Product(v.Ctx, handle)
	if err != nil || !ok {
		return pick(err == nil, notFound(), Answer{}), err
	}
	story, _, _ := v.Content.ProductPage(v.Ctx, v.Ask, handle)
	// The choice for each option: from the address (?option_<id>=value), else the first value.
	chosen := map[string]string{}
	for _, o := range p.Options {
		first := ""
		if len(o.Values) > 0 {
			first = o.Values[0].Value
		}
		chosen[o.ID] = pick(v.Q("option_"+o.ID) != "", v.Q("option_"+o.ID), first)
	}
	var variant *Variant
	if len(p.Variants) == 1 {
		variant = &p.Variants[0]
	} else if found, ok := VariantFor(p.Variants, chosen); ok {
		variant = &found
	}
	view := ProductView{Product: p, Story: v.resolve(story.Layout), Chosen: chosen, Variant: variant, Added: v.Q("added") == "1", Failed: v.Q("error"), Return: v.URL.Path + withMark(v.URL.RawQuery)}
	if from, ok := FromPrice(p.Variants); ok {
		view.From = &from
	}
	sku := ""
	if variant != nil {
		view.Available = InStock(*variant)
		sku = variant.SKU
		if variant.Price != nil && !v.Shop.Market.TaxInclusive {
			view.PriceInc = WithTax(variant.Price.Calculated, v.Shop.Market)
		}
		if view.Available && variant.ManageInventory && !variant.AllowBackorder && variant.Inventory <= 5 {
			view.FewLeft = int(variant.Inventory)
		}
	}
	image := p.Thumbnail
	if len(p.Images) > 0 {
		image = p.Images[0].URL
	}
	crumbs := []Crumb{{"Products", "/products"}}
	if len(p.Categories) > 0 {
		crumbs = []Crumb{{p.Categories[0].Name, "/categories/" + p.Categories[0].Handle}}
	}
	desc := strings.TrimSpace(story.Description)
	if desc == "" {
		desc = truncate(pick(p.Subtitle != "", p.Subtitle, p.Description), 160)
	}
	canonical := ""
	if c := strings.TrimSpace(story.Canonical); c != "" {
		canonical = v.Origin + "/products/" + pathEscape(c)
	}
	return Answer{Page: "product", Data: view, Frame: Frame{
		Title: p.Title, FullTitle: strings.TrimSpace(story.SearchTitle), Canonical: canonical, Description: desc, Image: image,
		Noindex: v.Ask.Preview, Preview: v.Ask.Preview, Type: "product",
		LD: []any{ProductLD(p, v.Origin, v.Shop.Name, v.Shop.Market, sku)}, Crumbs: append(crumbs, Crumb{p.Title, "/products/" + p.Handle}),
	}}, nil
}

// CategoryPage is a category's products, a page at a time, with its subcategories. Its search
// details are the team's (Menu, Shop in search), else its own description, else made from what
// it holds.
func CategoryPage(v Visitor, path string) (Answer, error) {
	parts := filter(strings.Split(path, "/"), func(s string) bool { return s != "" })
	if len(parts) == 0 {
		return notFound(), nil
	}
	c, ok, err := v.API.CategoryByHandle(v.Ctx, parts[len(parts)-1])
	if err != nil || !ok {
		return pick(err == nil, notFound(), Answer{}), err
	}
	g, err := v.grid(ProductQuery{Category: c.ID}, "Nothing here yet.")
	if err != nil {
		return Answer{}, err
	}
	m := v.Content.Menus(v.Ctx, v.Ask)
	own, _ := find(m.Categories, func(x struct {
		Handle      string `json:"handle"`
		SearchTitle string `json:"searchTitle"`
		Description string `json:"description"`
	}) bool {
		return x.Handle == c.Handle
	})
	desc := strings.TrimSpace(own.Description)
	if desc == "" {
		desc = pick(c.Description != "", c.Description, ListDescription(c.Name, titles(g.Products), v.Shop.Name))
	}
	return Answer{Page: "category", Data: map[string]any{"Category": c, "Grid": g}, Frame: Frame{
		Title: c.Name, FullTitle: strings.TrimSpace(own.SearchTitle), Description: desc, Crumbs: []Crumb{{c.Name, "/categories/" + c.Handle}},
	}}, nil
}

// CollectionPage is a collection's products, a page at a time.
func CollectionPage(v Visitor, handle string) (Answer, error) {
	c, ok, err := v.API.CollectionByHandle(v.Ctx, handle)
	if err != nil || !ok {
		return pick(err == nil, notFound(), Answer{}), err
	}
	g, err := v.grid(ProductQuery{Collection: c.ID}, "Nothing here yet.")
	if err != nil {
		return Answer{}, err
	}
	return Answer{Page: "collection", Data: map[string]any{"Collection": c, "Grid": g}, Frame: Frame{
		Title: c.Title, Description: c.Title + " at " + v.Shop.Name + ".", Crumbs: []Crumb{{c.Title, "/collections/" + c.Handle}},
	}}, nil
}

// SearchPage is the products that match what was typed.
func SearchPage(v Visitor) (Answer, error) {
	q := truncate(strings.TrimSpace(v.Q("q")), 100)
	g := Grid{Empty: "Type what you're looking for.", Pager: Pager{Page: 1, Pages: 1}}
	if q != "" {
		var err error
		if g, err = v.grid(ProductQuery{Q: q}, "Nothing matches that."); err != nil {
			return Answer{}, err
		}
	}
	return Answer{Page: "search", Data: map[string]any{"Q": q, "Grid": g}, Frame: Frame{Title: pick(q != "", "Search: "+q, "Search"), Noindex: true}}, nil
}

// CartPage is the visitor's cart.
func CartPage(v Visitor) (Answer, error) {
	c, _, err := v.API.Cart(v.Ctx, v.Cart)
	if err != nil {
		return Answer{}, err
	}
	return Answer{Page: "cart", Data: map[string]any{"Cart": c, "Failed": v.Q("error")}, Frame: Frame{Title: "Cart", Noindex: true}}, nil
}

// CheckoutView is what the checkout reads: each step, done or to do.
type CheckoutView struct {
	Cart         Cart
	Customer     *Customer
	Failed       string
	DetailsDone  bool
	Options      []ShippingOption
	ChosenOption string
	DeliveryDone bool
	Methods      []PaymentMethod
	Session      *PaymentSession
	Paying       string // the provider whose own fields show: pp_stripe_stripe or pp_paypal_paypal
	StripeKey    string
	StripeReturn string
	Prefill      *Address
	Saved        []Address
	SavedChosen  string
}

// CheckoutPage is the checkout: contact and delivery, the delivery method, then payment. A shop
// whose setup is not done takes no orders; the cart says so.
func CheckoutPage(v Visitor) (Answer, error) {
	if v.Shop.Closed() {
		return redirect("/cart"), nil
	}
	c, ok, err := v.API.Cart(v.Ctx, v.Cart)
	if err != nil {
		return Answer{}, err
	}
	if !ok || len(c.Items) == 0 {
		return redirect("/cart"), nil
	}
	me, signedIn, err := v.API.Me(v.Ctx)
	if err != nil {
		return Answer{}, err
	}
	editing := v.Q("edit")
	view := CheckoutView{Cart: c, Failed: v.Q("error"), Methods: PaymentMethods(v.Shop), StripeReturn: v.Origin + "/checkout/return/stripe"}
	if signedIn {
		view.Customer, view.Saved = &me, me.Addresses
	}
	view.DetailsDone = c.Email != "" && c.ShippingAddress != nil && c.ShippingAddress.Address1 != "" && editing != "details"
	if view.DetailsDone {
		if view.Options, err = v.API.ShippingOptions(v.Ctx, c.ID); err != nil {
			return Answer{}, err
		}
	}
	if len(c.ShippingMethods) > 0 {
		view.ChosenOption = c.ShippingMethods[0].ShippingOptionID
	}
	view.DeliveryDone = view.DetailsDone && view.ChosenOption != "" && editing != "delivery"
	if s, ok := ActiveSession(c); ok && view.DeliveryDone {
		view.Session = &s
		if v.Q("pay") == "1" && (s.ProviderID == "pp_stripe_stripe" || s.ProviderID == "pp_paypal_paypal") {
			view.Paying = s.ProviderID
			view.StripeKey = PublishableFor(s.Data["livemode"], v.Shop.StripeKey, v.Shop.StripeTestKey)
		}
	}
	switch {
	case c.ShippingAddress != nil && c.ShippingAddress.Address1 != "":
		view.Prefill = c.ShippingAddress
	case len(view.Saved) > 0:
		chosen, ok := find(view.Saved, func(a Address) bool { return a.IsDefaultShipping })
		view.Prefill = &chosen
		if !ok {
			view.Prefill = &view.Saved[0]
		}
		view.SavedChosen = view.Prefill.ID
	}
	return Answer{Page: "checkout", Data: view, Frame: Frame{Title: "Checkout", Noindex: true}}, nil
}

// AccountView is what the account page reads.
type AccountView struct {
	Customer    *Customer
	Orders      []Order
	Failed      string
	Return      string
	Step        string // email, code, password or register, while signed out
	Email       string
	FirstName   string
	LastName    string
	Editing     string // an address's id, or new
	EditAddress *Address
	MinPassword int
}

// AccountPage is the customer's account. Signed out: sign in with an emailed code (the default),
// with a password, or open an account. Signed in: orders, saved addresses and details.
func AccountPage(v Visitor) (Answer, error) {
	me, signedIn, err := v.API.Me(v.Ctx)
	if err != nil {
		return Answer{}, err
	}
	view := AccountView{Failed: v.Q("error"), Return: SafeReturn(v.Q("return"), "/account"), Step: pick(v.Q("step") != "", v.Q("step"), "email"),
		Email: v.Q("email"), FirstName: v.Q("first_name"), LastName: v.Q("last_name"), Editing: v.Q("address"), MinPassword: minPassword}
	if signedIn {
		view.Customer = &me
		if view.Orders, err = v.API.MyOrders(v.Ctx, 20); err != nil {
			return Answer{}, err
		}
		if a, ok := find(me.Addresses, func(a Address) bool { return a.ID == view.Editing }); ok {
			view.EditAddress = &a
		}
	}
	return Answer{Page: "account", Data: view, Frame: Frame{Title: "Account", Noindex: true}}, nil
}

// PasswordPage sets a password. Without a token: ask for the emailed link. With one (from that
// email): choose the new password.
func PasswordPage(v Visitor) (Answer, error) {
	return Answer{Page: "password", Data: map[string]any{"Token": v.Q("token"), "Email": v.Q("email"), "Failed": v.Q("error"), "Sent": v.Q("sent") != "", "MinPassword": minPassword},
		Frame: Frame{Title: "Password", Noindex: true}}, nil
}

// MyOrderPage is one of the signed-in customer's orders.
func MyOrderPage(v Visitor, id string) (Answer, error) {
	me, signedIn, err := v.API.Me(v.Ctx)
	if err != nil {
		return Answer{}, err
	}
	if !signedIn {
		return Answer{Status: http.StatusFound, Location: "/account?return=" + queryEscape(v.URL.Path)}, nil
	}
	o, ok, err := v.API.Order(v.Ctx, id)
	if err != nil || !ok || o.CustomerID != me.ID {
		return pick(err == nil, notFound(), Answer{}), err
	}
	return Answer{Page: "my-order", Data: o, Frame: Frame{Title: fmt.Sprintf("Order %d", o.DisplayID), Noindex: true}}, nil
}

// OrderPage is where a customer lands after placing an order.
func OrderPage(v Visitor, id string) (Answer, error) {
	o, ok, err := v.API.Order(v.Ctx, id)
	if err != nil || !ok {
		return pick(err == nil, notFound(), Answer{}), err
	}
	return Answer{Page: "order", Data: o, Frame: Frame{Title: fmt.Sprintf("Order %d", o.DisplayID), Noindex: true}}, nil
}

// StripeReturn is where Stripe sends the customer back after the payment (and any bank check):
// the order is placed if Stripe says they paid.
func StripeReturn(v Visitor) (Answer, error) {
	if v.Cart == "" {
		return Answer{Status: http.StatusFound, Location: "/account"}, nil
	}
	if v.Q("redirect_status") == "failed" {
		return Answer{Status: http.StatusFound, Location: "/checkout?pay=1&error=" + queryEscape("Your payment didn't go through. Try again or pay another way.")}, nil
	}
	return v.complete("/checkout?pay=1", http.StatusFound)
}

// WindcaveReturn is where Windcave sends the customer back: the order is placed if Windcave says
// they paid.
func WindcaveReturn(v Visitor) (Answer, error) {
	if v.Cart == "" {
		return Answer{Status: http.StatusFound, Location: "/account"}, nil
	}
	switch v.Q("result") {
	case "approved":
		return v.complete("/checkout", http.StatusFound)
	case "cancelled":
		return Answer{Status: http.StatusFound, Location: "/checkout?error=" + queryEscape("Payment cancelled.")}, nil
	}
	return Answer{Status: http.StatusFound, Location: "/checkout?error=" + queryEscape("Your card was declined. Try again or pay another way.")}, nil
}

// complete places the order and goes to it, or back to back with why it was refused. A placed
// order's cart is gone.
func (v Visitor) complete(back string, status int) (Answer, error) {
	o, why, err := v.API.Complete(v.Ctx, v.Cart)
	switch {
	case err != nil:
		return Answer{}, err
	case why != "":
		return Answer{Status: status, Location: with(back, "error", why)}, nil
	}
	return Answer{Status: status, Location: "/order/" + pathEscape(o.ID), Cookies: []*http.Cookie{dropCart()}}, nil
}

// SitemapPage is the website's pages (from the editor), the product list, every category and
// collection, and every product, read a page at a time so a large catalogue is not held at once.
func SitemapPage(v Visitor) (Answer, error) {
	const most = 50_000 // one sitemap file holds at most this many addresses
	site, err := v.Content.Listed(v.Ctx, v.Ask)
	if err != nil {
		return Answer{}, err
	}
	products, err := v.API.Every(v.Ctx, "/store/products", "products", "handle,updated_at", most)
	if err != nil {
		return Answer{}, err
	}
	cats, err := v.API.Every(v.Ctx, "/store/product-categories", "product_categories", "handle,updated_at", most)
	if err != nil {
		return Answer{}, err
	}
	cols, err := v.API.Every(v.Ctx, "/store/collections", "collections", "handle,updated_at", most)
	if err != nil {
		return Answer{}, err
	}
	entries := ShopSitemap(site, products, cats, cols)
	return Answer{Status: http.StatusOK, Data: SitemapXML(v.Origin, entries[:min(most, len(entries))])}, nil
}

// ShopSitemap is every address the shop lists for search engines: until the website has a home
// page, the shop's list is the address's home too.
func ShopSitemap(site []ContentPage, products, cats, cols []map[string]any) []SitemapEntry {
	out := []SitemapEntry{}
	if !some(site, func(p ContentPage) bool { return p.Path == "/" }) {
		out = append(out, SitemapEntry{Path: "/"})
	}
	out = append(out, mapOf(site, func(p ContentPage) SitemapEntry { return SitemapEntry{Path: p.Path, Updated: p.UpdatedAt} })...)
	latest := ""
	for _, p := range products {
		if u := str(p["updated_at"]); u > latest {
			latest = u
		}
	}
	out = append(out, SitemapEntry{Path: "/products", Updated: latest})
	each := func(prefix string, list []map[string]any) []SitemapEntry {
		return mapOf(list, func(m map[string]any) SitemapEntry {
			return SitemapEntry{Path: prefix + str(m["handle"]), Updated: str(m["updated_at"])}
		})
	}
	out = append(out, each("/categories/", cats)...)
	out = append(out, each("/collections/", cols)...)
	return append(out, each("/products/", products)...)
}
