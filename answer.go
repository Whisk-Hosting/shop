// What a page or a form of the shop answers, as a value: a page drawn from the theme, a redirect,
// or JSON. Handlers (pages.go, actions.go) return one; the shell (main.go) writes it.
package main

import (
	"context"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Answer is what a request gets.
type Answer struct {
	Status   int
	Page     string // the page in theme/pages to draw in the frame
	Frame    Frame  // what the frame says about the page
	Data     any    // what the page reads, as .Data
	Location string // a redirect
	JSON     any
	Cookies  []*http.Cookie // cookies of the shop's own (the cart)
	NotFound bool           // draw the not-found page
}

// Frame is what the frame (theme/shop.html) says about a page: its title and description for
// search engines and link previews, and whether they may list it.
type Frame struct {
	Title       string // its own title, or "" for the shop's name
	FullTitle   string // the whole <title>, when the page gives one
	Description string
	Canonical   string
	Noindex     bool
	Image       string
	Head        template.HTML
	Preview     bool
	Type        string // website or product
	LD          []any
	Crumbs      []Crumb
	EverySite   bool // the page is at this address on each of the shop's sites (hreflang)
}

// View is everything the frame and a page read. It is built once per request and never changed.
type View struct {
	Frame
	Shop       Storefront
	Name       string
	Title      string
	Canonical  string
	Image      string
	LD         []template.JS
	Alternates []Alternate
	Menus      Menus
	Cart       int
	Top        []Category
	Q          string
	Path       string
	Year       int
	CSS        template.CSS
	Page       string
	Data       any
	Notice     string // ?error= or a page's own notice
}

func redirect(to string) Answer { return Answer{Status: http.StatusSeeOther, Location: to} }

func notFound() Answer { return Answer{Status: http.StatusNotFound, NotFound: true} }

// with is a path with one more query value: the page a form returns to, told what happened.
func with(p, k, v string) string {
	u, err := url.Parse(p)
	if err != nil {
		return p
	}
	q := u.Query()
	q.Set(k, v)
	return u.Path + "?" + q.Encode() + pick(u.Fragment != "", "#"+u.Fragment, "")
}

// without is a path with the named query values gone.
func without(p string, keys ...string) string {
	u, err := url.Parse(p)
	if err != nil {
		return p
	}
	q := u.Query()
	for _, k := range keys {
		q.Del(k)
	}
	return u.Path + withMark(q.Encode())
}

// Visitor is one request to the shop, as the pages read it.
type Visitor struct {
	Ctx     context.Context
	Shop    Storefront
	API     *API
	Content Content
	Ask     Asker
	URL     url.URL
	Origin  string
	Form    url.Values
	Cart    string // the cart cookie's id
	Now     time.Time
}

// Q is a value of the address's query.
func (v Visitor) Q(k string) string { return v.URL.Query().Get(k) }

// F is a value of the form posted, trimmed.
func (v Visitor) F(k string) string { return strings.TrimSpace(v.Form.Get(k)) }
