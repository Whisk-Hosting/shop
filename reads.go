// The shop's reads and writes against the store API, each a small method over API.
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

const (
	cartCookie    = "shop_cart"
	productFields = "+metadata,*variants.calculated_price,+variants.inventory_quantity,*variants.options,*options,*options.values,*images,*categories"
	cardFields    = "id,handle,title,thumbnail,*variants.calculated_price"
	cartFields    = "*items,*items.variant,*items.variant.product,*shipping_methods,*shipping_address,*billing_address,*payment_collection,*payment_collection.payment_sessions,*promotions,+item_subtotal,+shipping_subtotal,+items.subtotal"
	orderFields   = "id,display_id,email,customer_id,created_at,status,payment_status,fulfillment_status,currency_code,*items,*shipping_address,*shipping_methods,+item_total,+item_subtotal,+shipping_total,+shipping_subtotal,+items.subtotal,+tax_total,+discount_total,+total,*payment_collections.payments,*payment_collections.payment_sessions"
)

// ProductQuery is which products a list shows.
type ProductQuery struct {
	Q, Category, Collection string
	Limit, Offset           int
}

// Products are a list's products and how many there are in all.
func (a *API) Products(ctx context.Context, pq ProductQuery) ([]Product, int, error) {
	var out struct {
		Products []Product `json:"products"`
		Count    int       `json:"count"`
	}
	err := a.Get(ctx, "/store/products"+Query("region_id", a.shop.RegionID, "fields", cardFields, "q", pq.Q, "category_id", pq.Category,
		"collection_id", pq.Collection, "limit", pick(pq.Limit > 0, pq.Limit, 24), "offset", pq.Offset, "order", "-created_at"), &out)
	return out.Products, out.Count, err
}

// Product is the product with a handle.
func (a *API) Product(ctx context.Context, handle string) (Product, bool, error) {
	var out struct {
		Products []Product `json:"products"`
	}
	if err := a.Get(ctx, "/store/products"+Query("handle", handle, "region_id", a.shop.RegionID, "fields", productFields, "limit", 1), &out); err != nil {
		return Product{}, false, err
	}
	if len(out.Products) == 0 {
		return Product{}, false, nil
	}
	return out.Products[0], true, nil
}

// Categories are every category.
func (a *API) Categories(ctx context.Context) ([]Category, error) {
	var out struct {
		Categories []Category `json:"product_categories"`
	}
	err := a.Get(ctx, "/store/product-categories"+Query("fields", "id,name,handle,parent_category_id,rank", "limit", 200), &out)
	return out.Categories, err
}

// CategoryByHandle is the category with a handle.
func (a *API) CategoryByHandle(ctx context.Context, handle string) (Category, bool, error) {
	var out struct {
		Categories []Category `json:"product_categories"`
	}
	if err := a.Get(ctx, "/store/product-categories"+Query("handle", handle, "fields", "id,name,handle,description,*category_children", "limit", 1), &out); err != nil {
		return Category{}, false, err
	}
	if len(out.Categories) == 0 {
		return Category{}, false, nil
	}
	return out.Categories[0], true, nil
}

// CollectionByHandle is the collection with a handle.
func (a *API) CollectionByHandle(ctx context.Context, handle string) (Collection, bool, error) {
	var out struct {
		Collections []Collection `json:"collections"`
	}
	if err := a.Get(ctx, "/store/collections"+Query("handle", handle, "limit", 1), &out); err != nil {
		return Collection{}, false, err
	}
	if len(out.Collections) == 0 {
		return Collection{}, false, nil
	}
	return out.Collections[0], true, nil
}

// Cart is the visitor's open cart; false when they have none, or it was completed or is gone.
func (a *API) Cart(ctx context.Context, id string) (Cart, bool, error) {
	if id == "" {
		return Cart{}, false, nil
	}
	var out struct {
		Cart Cart `json:"cart"`
	}
	err := a.Get(ctx, "/store/carts/"+url.PathEscape(id)+Query("fields", cartFields), &out)
	switch s := statusOf(err); {
	case s == http.StatusNotFound || s == http.StatusBadRequest:
		return Cart{}, false, nil
	case err != nil:
		return Cart{}, false, err
	}
	return out.Cart, out.Cart.CompletedAt == nil, nil
}

// NewCart makes a cart in the shop's region.
func (a *API) NewCart(ctx context.Context) (Cart, error) {
	var out struct {
		Cart Cart `json:"cart"`
	}
	err := a.Post(ctx, "/store/carts", map[string]any{"region_id": a.shop.RegionID}, "", &out)
	return out.Cart, err
}

// AddLine puts quantity of a variant in a cart.
func (a *API) AddLine(ctx context.Context, cart, variant string, quantity int) error {
	return a.Post(ctx, "/store/carts/"+url.PathEscape(cart)+"/line-items", map[string]any{"variant_id": variant, "quantity": quantity}, "", nil)
}

// UpdateLine changes a line's quantity, or removes it at 0.
func (a *API) UpdateLine(ctx context.Context, cart, line string, quantity int) error {
	p := "/store/carts/" + url.PathEscape(cart) + "/line-items/" + url.PathEscape(line)
	if quantity > 0 {
		return a.Post(ctx, p, map[string]any{"quantity": quantity}, "", nil)
	}
	return a.Delete(ctx, p)
}

// Me is the signed-in customer, with their addresses; false when nobody is signed in.
func (a *API) Me(ctx context.Context) (Customer, bool, error) {
	var out struct {
		Customer Customer `json:"customer"`
	}
	err := a.Get(ctx, "/store/customers/me"+Query("fields", "*addresses"), &out)
	switch s := statusOf(err); {
	case s == http.StatusUnauthorized || s == http.StatusForbidden:
		return Customer{}, false, nil
	case err != nil:
		return Customer{}, false, err
	}
	return out.Customer, true, nil
}

// MyOrders are the signed-in customer's latest orders.
func (a *API) MyOrders(ctx context.Context, limit int) ([]Order, error) {
	var out struct {
		Orders []Order `json:"orders"`
	}
	err := a.Get(ctx, "/store/orders"+Query("limit", limit, "offset", 0, "order", "-created_at",
		"fields", "id,display_id,created_at,total,currency_code,status,fulfillment_status,payment_status,*items"), &out)
	return out.Orders, err
}

// Order is an order by its id; false when there is none.
func (a *API) Order(ctx context.Context, id string) (Order, bool, error) {
	var out struct {
		Order Order `json:"order"`
	}
	err := a.Get(ctx, "/store/orders/"+url.PathEscape(id)+Query("fields", orderFields), &out)
	switch {
	case statusOf(err) == http.StatusNotFound:
		return Order{}, false, nil
	case err != nil:
		return Order{}, false, err
	}
	return out.Order, true, nil
}

// ClaimCart makes the cart a customer was filling theirs, once they sign in. A cart that cannot be
// claimed (completed, or someone else's) is left as it is.
func (a *API) ClaimCart(ctx context.Context, cart string) {
	if cart != "" {
		_ = a.Post(ctx, "/store/carts/"+url.PathEscape(cart)+"/customer", nil, "", nil)
	}
}

// ShippingOptions are the ways the shop delivers to a cart's address.
func (a *API) ShippingOptions(ctx context.Context, cart string) ([]ShippingOption, error) {
	var out struct {
		Options []ShippingOption `json:"shipping_options"`
	}
	err := a.Get(ctx, "/store/shipping-options"+Query("cart_id", cart), &out)
	return out.Options, err
}

// StartPayment is the payment session for a provider, made (or made again for a changed cart) on
// the cart's payment collection.
func (a *API) StartPayment(ctx context.Context, c Cart, provider string) (PaymentSession, error) {
	collection := ""
	if c.PaymentCollection != nil {
		collection = c.PaymentCollection.ID
	}
	if collection == "" {
		var made struct {
			Collection struct {
				ID string `json:"id"`
			} `json:"payment_collection"`
		}
		if err := a.Post(ctx, "/store/payment-collections", map[string]any{"cart_id": c.ID}, "", &made); err != nil {
			return PaymentSession{}, err
		}
		collection = made.Collection.ID
	}
	var out struct {
		Collection struct {
			Sessions []PaymentSession `json:"payment_sessions"`
		} `json:"payment_collection"`
	}
	if err := a.Post(ctx, "/store/payment-collections/"+url.PathEscape(collection)+"/payment-sessions", map[string]any{"provider_id": provider}, "", &out); err != nil {
		return PaymentSession{}, err
	}
	s, _ := find(out.Collection.Sessions, func(s PaymentSession) bool { return s.ProviderID == provider })
	return s, nil
}

// Complete places the order. On a refusal (a declined card, stock that ran out) it answers why
// and the cart stays for the customer to try again.
func (a *API) Complete(ctx context.Context, cart string) (Order, string, error) {
	var out struct {
		Type  string `json:"type"`
		Order *Order `json:"order"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	err := a.Post(ctx, "/store/carts/"+url.PathEscape(cart)+"/complete", nil, "", &out)
	if why, ok := refused(err); ok {
		return Order{}, why, nil
	}
	switch {
	case err != nil:
		return Order{}, "", err
	case out.Type == "order" && out.Order != nil:
		return *out.Order, "", nil
	case out.Error != nil && out.Error.Message != "":
		return Order{}, out.Error.Message, nil
	}
	return Order{}, "The payment didn't go through.", nil
}

// SignIn swaps an email and password for a session: the API answers a token, and the token makes
// the session cookie.
func (a *API) SignIn(ctx context.Context, email, password string) error {
	var out struct {
		Token string `json:"token"`
	}
	if err := a.Post(ctx, "/auth/customer/emailpass", map[string]any{"email": email, "password": password}, "", &out); err != nil {
		return err
	}
	return a.Post(ctx, "/auth/session", nil, out.Token, nil)
}

// Every is every item of a list, read a page at a time, up to max.
func (a *API) Every(ctx context.Context, path, key, fields string, max int) ([]map[string]any, error) {
	const page = 200
	var all []map[string]any
	for offset := 0; offset < max; offset += page {
		// The list sits beside its count, offset and limit: read only the list.
		var out map[string]json.RawMessage
		if err := a.Get(ctx, path+Query("fields", fields, "limit", page, "offset", strconv.Itoa(offset)), &out); err != nil {
			return nil, err
		}
		var got []map[string]any
		if raw, ok := out[key]; ok {
			if err := json.Unmarshal(raw, &got); err != nil {
				return nil, err
			}
		}
		all = append(all, got...)
		if len(got) < page {
			break
		}
	}
	return all, nil
}
