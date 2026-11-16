// The shop's forms: the cart, the checkout's steps and the customer's account. Each is a function
// from the visit (with its form) to an Answer, mostly a redirect back to the page with what
// happened. A refusal from the API (a status under 500) goes back to the page to show; anything
// else is the page's own failure.
package main

import (
	"html/template"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// doctor: allow W097 markup the business's team wrote in the editor, which only the team may change
func rawHTML(s string) template.HTML { return template.HTML(s) } //nolint:gosec // markup the team wrote in the editor

func truncate(s string, n int) string {
	r := []rune(s)
	return string(r[:min(n, len(r))])
}

func pathEscape(s string) string  { return url.PathEscape(s) }
func queryEscape(s string) string { return url.QueryEscape(s) }

// keepCart is the cart's cookie, kept a month.
func keepCart(id string) *http.Cookie {
	return &http.Cookie{Name: cartCookie, Value: id, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 30 * 24 * 3600}
}

// dropCart forgets the cart.
func dropCart() *http.Cookie {
	return &http.Cookie{Name: cartCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: -1, Expires: time.Unix(0, 0)}
}

// quantity is a form's quantity between low and 999.
func quantity(s string, low int) int {
	n, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(n) {
		n = float64(low)
		if low == 0 {
			n = 0
		}
	}
	return min(999, max(low, int(math.Floor(n))))
}

// orFail is a redirect back with the API's refusal, or the failure itself.
func orFail(err error, back func(string) string) (Answer, error) {
	if why, ok := refused(err); ok {
		return redirect(back(why)), nil
	}
	return Answer{}, err
}

// AddToCart puts a product in the cart, made the first time something is added.
func AddToCart(v Visitor) (Answer, error) {
	back := SafeReturn(v.F("return"), "/cart")
	variant := v.F("variant_id")
	if variant == "" {
		return redirect(with(back, "error", "Choose an option first.")), nil
	}
	c, ok, err := v.API.Cart(v.Ctx, v.Cart)
	if err != nil {
		return Answer{}, err
	}
	var cookies []*http.Cookie
	if !ok {
		if c, err = v.API.NewCart(v.Ctx); err != nil {
			return orFail(err, func(why string) string { return with(back, "error", why) })
		}
		cookies = []*http.Cookie{keepCart(c.ID)}
	}
	if err := v.API.AddLine(v.Ctx, c.ID, variant, quantity(v.F("quantity"), 1)); err != nil {
		a, failed := orFail(err, func(why string) string { return with(back, "error", why) })
		a.Cookies = cookies
		return a, failed
	}
	a := redirect(with(without(back, "added", "error"), "added", "1"))
	a.Cookies = cookies
	return a, nil
}

// UpdateCart changes or removes a line (quantity 0 removes it).
func UpdateCart(v Visitor) (Answer, error) {
	line := v.F("line_id")
	if v.Cart == "" || line == "" {
		return redirect("/cart"), nil
	}
	if err := v.API.UpdateLine(v.Ctx, v.Cart, line, quantity(v.F("quantity"), 0)); err != nil {
		return orFail(err, func(why string) string { return "/cart?error=" + queryEscape(why) })
	}
	return redirect("/cart"), nil
}

// CheckoutDetails puts the customer's email and delivery address on the cart, and saves the
// address to their account when they ask.
func CheckoutDetails(v Visitor) (Answer, error) {
	back := func(why string) string { return "/checkout?edit=details&error=" + queryEscape(why) }
	if v.Cart == "" {
		return redirect("/cart"), nil
	}
	email := strings.ToLower(v.F("email"))
	if !emailShape.MatchString(email) {
		return redirect(back("Check your email address.")), nil
	}
	me, signedIn, err := v.API.Me(v.Ctx)
	if err != nil {
		return Answer{}, err
	}
	saved, isSaved := find(me.Addresses, func(a Address) bool { return v.F("saved_address_id") != "" && a.ID == v.F("saved_address_id") })
	address := saved.Plain()
	if !isSaved {
		var missing []string
		if address, missing = AddressFrom(v.Form, v.Shop.Market.Country); missing != nil {
			return redirect(back("Fill in your name and full address.")), nil
		}
	}
	if err := v.API.Post(v.Ctx, "/store/carts/"+url.PathEscape(v.Cart), map[string]any{"email": email, "shipping_address": address, "billing_address": address}, "", nil); err != nil {
		return orFail(err, back)
	}
	if signedIn && !isSaved && v.F("save_address") == "1" {
		body := map[string]any{"first_name": address.FirstName, "last_name": address.LastName, "company": address.Company, "address_1": address.Address1,
			"address_2": address.Address2, "city": address.City, "postal_code": address.PostalCode, "province": address.Province,
			"country_code": address.CountryCode, "phone": address.Phone, "is_default_shipping": len(me.Addresses) == 0}
		if err := v.API.Post(v.Ctx, "/store/customers/me/addresses", body, "", nil); err != nil {
			return orFail(err, back)
		}
	}
	return redirect("/checkout"), nil
}

// CheckoutDelivery is the delivery method.
func CheckoutDelivery(v Visitor) (Answer, error) {
	if v.Cart == "" {
		return redirect("/cart"), nil
	}
	if err := v.API.Post(v.Ctx, "/store/carts/"+url.PathEscape(v.Cart)+"/shipping-methods", map[string]any{"option_id": v.F("option_id")}, "", nil); err != nil {
		return orFail(err, func(why string) string { return "/checkout?edit=delivery&error=" + queryEscape(why) })
	}
	return redirect("/checkout"), nil
}

// CheckoutPayment starts paying. Bank transfer places the order at once; Windcave sends the
// customer to its payment page; Stripe and PayPal show their own fields on the checkout page.
func CheckoutPayment(v Visitor) (Answer, error) {
	back := func(why string) string { return "/checkout?error=" + queryEscape(why) }
	c, ok, err := v.API.Cart(v.Ctx, v.Cart)
	if err != nil {
		return Answer{}, err
	}
	if !ok {
		return redirect("/cart"), nil
	}
	method, ok := find(PaymentMethods(v.Shop), func(m PaymentMethod) bool { return m.ID == v.F("provider_id") })
	if !ok {
		return redirect(back("Choose how to pay.")), nil
	}
	session, err := v.API.StartPayment(v.Ctx, c, method.ID)
	if err != nil {
		return orFail(err, back)
	}
	switch method.Kind {
	case "bank_transfer":
		return v.complete("/checkout", http.StatusSeeOther)
	case "windcave":
		to, _ := session.Data["redirect_url"].(string)
		if !strings.HasPrefix(to, "https://") {
			return redirect(back("Card payments are unavailable right now.")), nil
		}
		return redirect(to), nil
	}
	return redirect("/checkout?pay=1"), nil
}

// CheckoutComplete places the order once PayPal's window has approved the payment. It answers
// JSON for the page's script: where to go, or what went wrong.
func CheckoutComplete(v Visitor) (Answer, error) {
	if v.Cart == "" {
		return Answer{Status: http.StatusBadRequest, JSON: map[string]string{"error": "Your cart has expired."}}, nil
	}
	o, why, err := v.API.Complete(v.Ctx, v.Cart)
	switch {
	case err != nil:
		return Answer{}, err
	case why != "":
		return Answer{Status: http.StatusPaymentRequired, JSON: map[string]string{"error": why}}, nil
	}
	return Answer{Status: http.StatusOK, JSON: map[string]string{"location": "/order/" + pathEscape(o.ID)}, Cookies: []*http.Cookie{dropCart()}}, nil
}

// accountTo is the account page with values in its query.
func accountTo(pairs ...string) string {
	q := url.Values{}
	for i := 0; i+1 < len(pairs); i += 2 {
		if pairs[i+1] != "" || pairs[i] == "error" {
			q.Set(pairs[i], pairs[i+1])
		}
	}
	return "/account?" + q.Encode()
}

// SendCode asks the shop to email a sign-in code, then shows the box to type it in. The API's
// cookie that ties the code to this browser goes back with the answer.
func SendCode(v Visitor) (Answer, error) {
	email, ret := strings.ToLower(v.F("email")), SafeReturn(v.F("return"), "/account")
	if err := v.API.Post(v.Ctx, "/auth/sign-in-code", map[string]any{"email": email}, "", nil); err != nil {
		return orFail(err, func(why string) string { return accountTo("return", ret, "error", why) })
	}
	return redirect(accountTo("return", ret, "step", "code", "email", email)), nil
}

// VerifyCode signs the customer in with the code they were emailed, then makes the cart they were
// filling theirs.
func VerifyCode(v Visitor) (Answer, error) {
	email, ret := strings.ToLower(v.F("email")), SafeReturn(v.F("return"), "/account")
	code := strings.Join(strings.Fields(v.F("code")), "")
	if err := v.API.Post(v.Ctx, "/auth/sign-in-code/verify", map[string]any{"email": email, "code": code}, "", nil); err != nil {
		return orFail(err, func(why string) string { return accountTo("return", ret, "step", "code", "email", email, "error", why) })
	}
	v.API.ClaimCart(v.Ctx, v.Cart)
	return redirect(ret), nil
}

// PasswordSignIn signs in with a password.
func PasswordSignIn(v Visitor) (Answer, error) {
	email, ret := strings.ToLower(v.F("email")), SafeReturn(v.F("return"), "/account")
	if err := v.API.SignIn(v.Ctx, email, v.Form.Get("password")); err != nil {
		return orFail(err, func(string) string {
			return accountTo("return", ret, "step", "password", "email", email, "error", "Wrong email or password.")
		})
	}
	v.API.ClaimCart(v.Ctx, v.Cart)
	return redirect(ret), nil
}

// Register opens an account with a password and signs in.
func Register(v Visitor) (Answer, error) {
	email, password, first, last := strings.ToLower(v.F("email")), v.Form.Get("password"), v.F("first_name"), v.F("last_name")
	ret := SafeReturn(v.F("return"), "/account")
	back := func(why string) string {
		return accountTo("return", ret, "step", "register", "email", email, "first_name", first, "last_name", last, "error", why)
	}
	if problem := RegisterProblem(email, password, first, last); problem != "" {
		return redirect(back(problem)), nil
	}
	var token struct {
		Token string `json:"token"`
	}
	err := v.API.Post(v.Ctx, "/auth/customer/emailpass/register", map[string]any{"email": email, "password": password}, "", &token)
	if err == nil {
		err = v.API.Post(v.Ctx, "/store/customers", map[string]any{"email": email, "first_name": first, "last_name": last}, token.Token, nil)
	}
	if err == nil {
		err = v.API.SignIn(v.Ctx, email, password)
	}
	if err != nil {
		return orFail(err, func(why string) string {
			if strings.Contains(strings.ToLower(why), "exist") {
				why = "That email already has an account. Sign in with a code, or reset the password."
			}
			return back(why)
		})
	}
	v.API.ClaimCart(v.Ctx, v.Cart)
	return redirect(ret), nil
}

// SignOut ends the session and forgets the cart, which was the customer's.
func SignOut(v Visitor) (Answer, error) {
	_ = v.API.Delete(v.Ctx, "/auth/session")
	a := redirect("/")
	a.Cookies = []*http.Cookie{dropCart()}
	return a, nil
}

// SaveDetails is the customer's name and phone.
func SaveDetails(v Visitor) (Answer, error) {
	if v.F("first_name") == "" || v.F("last_name") == "" {
		return redirect("/account?error=" + queryEscape("Fill in your name.") + "#details"), nil
	}
	err := v.API.Post(v.Ctx, "/store/customers/me", map[string]any{"first_name": v.F("first_name"), "last_name": v.F("last_name"), "phone": pick[any](v.F("phone") != "", v.F("phone"), nil)}, "", nil)
	if s := statusOf(err); s == http.StatusUnauthorized || s == http.StatusForbidden {
		return redirect("/account"), nil
	}
	if err != nil {
		return orFail(err, func(why string) string { return "/account?error=" + queryEscape(why) + "#details" })
	}
	return redirect("/account#details"), nil
}

// SaveAddress adds, changes, removes or makes default one of the customer's saved addresses.
func SaveAddress(v Visitor) (Answer, error) {
	action, id := v.F("action"), url.PathEscape(v.F("id"))
	back := func(why string) string {
		q := url.Values{"error": {why}}
		switch action {
		case "add":
			q.Set("address", "new")
		case "edit":
			q.Set("address", v.F("id"))
		}
		return "/account?" + q.Encode() + "#addresses"
	}
	var err error
	switch action {
	case "delete":
		err = v.API.Delete(v.Ctx, "/store/customers/me/addresses/"+id)
	case "default":
		err = v.API.Post(v.Ctx, "/store/customers/me/addresses/"+id, map[string]any{"is_default_shipping": true, "is_default_billing": true}, "", nil)
	case "add", "edit":
		address, missing := AddressFrom(v.Form, v.Shop.Market.Country)
		if missing != nil {
			return redirect(back("Fill in your name and full address.")), nil
		}
		err = v.API.Post(v.Ctx, pick(action == "add", "/store/customers/me/addresses", "/store/customers/me/addresses/"+id), address, "", nil)
	default:
		return redirect(back("Unknown change.")), nil
	}
	if s := statusOf(err); s == http.StatusUnauthorized || s == http.StatusForbidden {
		return redirect("/account"), nil
	}
	if err != nil {
		return orFail(err, back)
	}
	return redirect("/account#addresses"), nil
}

// RequestPassword emails a link to set a new password. It answers the same whether or not the
// address has an account.
func RequestPassword(v Visitor) (Answer, error) {
	err := v.API.Post(v.Ctx, "/auth/customer/emailpass/reset-password", map[string]any{"identifier": strings.ToLower(v.F("email"))}, "", nil)
	if s := statusOf(err); s == http.StatusTooManyRequests {
		return redirect("/account/password?error=" + queryEscape(err.Error())), nil
	}
	if _, ok := refused(err); err != nil && !ok {
		return Answer{}, err
	}
	return redirect("/account/password?sent=1"), nil
}

// SetPassword sets a new password with the link's token, then signs in with it.
func SetPassword(v Visitor) (Answer, error) {
	token, email, password := v.F("token"), strings.ToLower(v.F("email")), v.Form.Get("password")
	if problem := PasswordProblem(password); problem != "" {
		return redirect("/account/password?" + url.Values{"token": {token}, "email": {email}, "error": {problem}}.Encode()), nil
	}
	if err := v.API.Post(v.Ctx, "/auth/customer/emailpass/update", map[string]any{"password": password}, token, nil); err != nil {
		return orFail(err, func(string) string {
			return "/account/password?error=" + queryEscape("That link has expired. Ask for a new one.")
		})
	}
	if err := v.API.SignIn(v.Ctx, email, password); err != nil {
		return orFail(err, func(why string) string { return accountTo("step", "password", "email", email, "error", why) })
	}
	v.API.ClaimCart(v.Ctx, v.Cart)
	return redirect("/account"), nil
}
