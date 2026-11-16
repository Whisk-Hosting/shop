// What a page tells search engines and link previews: its one address, its picture, and the
// structured data (schema.org) for the business, the site, the trail to the page and a product.
// Pure; table-tested (seo_test.go).
package main

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// CanonicalURL is a page's address as search engines should list it: its path, with the page
// number of a list past its first page and nothing else of the query.
func CanonicalURL(origin string, u url.URL) string {
	n, err := strconv.Atoi(u.Query().Get("page"))
	return origin + u.Path + pick(err == nil && n > 1, fmt.Sprintf("?page=%d", n), "")
}

// AbsoluteURL is an address on this site, made whole; "" for none.
func AbsoluteURL(origin, u string) string {
	if u == "" {
		return ""
	}
	base, err := url.Parse(origin + "/")
	if err != nil {
		return ""
	}
	ref, err := url.Parse(u)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

// ShareImage is a picture to show beside a link: whole, and a picture stored on Whisk as a 1200 px
// JPEG on this site's address, which every site that previews links reads.
func ShareImage(origin, u string) string {
	if at := strings.Index(u, "/.whisk/img/"); at >= 0 {
		base, _, _ := strings.Cut(u[at:], "?")
		return AbsoluteURL(origin, base+"?w=1200&format=jpeg")
	}
	return AbsoluteURL(origin, u)
}

// FirstPicture is the first picture in a page's blocks (a hero's, a picture's, a column's), for a
// page that names none to show beside links.
func FirstPicture(v any) string { return firstPicture(v, 0) }

func firstPicture(v any, depth int) string {
	if depth > 6 {
		return ""
	}
	switch x := v.(type) {
	case []any:
		for _, e := range x {
			if f := firstPicture(e, depth+1); f != "" {
				return f
			}
		}
	case []Block:
		for _, e := range x {
			if f := firstPicture(e, depth+1); f != "" {
				return f
			}
		}
	case map[string]any:
		if m, ok := x["image"].(map[string]any); ok {
			if u, ok := m["url"].(string); ok && !strings.HasPrefix(str(m["mimeType"]), "video/") {
				return u
			}
		}
		for _, k := range sortedKeys(x) {
			switch x[k].(type) {
			case []any, map[string]any:
				if f := firstPicture(x[k], depth+1); f != "" {
					return f
				}
			}
		}
	}
	return ""
}

// sortedKeys are a block's keys in the order the editor wrote them is lost in Go's maps, so they
// go in a fixed order: a block's own pictures before its items'.
func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// WithTax is a price with the market's tax in it, as search engines show prices to shoppers.
func WithTax(amount float64, m Market) float64 {
	if m.TaxInclusive {
		return amount
	}
	return math.Round(amount*(100+m.TaxRate)) / 100
}

const ld = "https://schema.org"

// SiteLD is the business and its site, on the home page.
func SiteLD(origin, name string) []map[string]any {
	return []map[string]any{
		{"@context": ld, "@type": "Organization", "@id": origin + "/#organization", "name": name, "url": origin + "/"},
		{"@context": ld, "@type": "WebSite", "@id": origin + "/#website", "name": name, "url": origin + "/", "publisher": map[string]any{"@id": origin + "/#organization"}},
	}
}

// Crumb is a step on the trail from the home page to a page.
type Crumb struct {
	Name string
	Path string
}

// BreadcrumbLD is the trail from the home page to this one.
func BreadcrumbLD(origin string, crumbs []Crumb) map[string]any {
	items := make([]map[string]any, 0, len(crumbs))
	for i, c := range crumbs {
		items = append(items, map[string]any{"@type": "ListItem", "position": i + 1, "name": c.Name, "item": origin + c.Path})
	}
	return map[string]any{"@context": ld, "@type": "BreadcrumbList", "itemListElement": items}
}

// ProductLD is a product: its brand is the one in its metadata (brand), else the shop's own name.
func ProductLD(p Product, origin, shop string, m Market, sku string) map[string]any {
	u := origin + "/products/" + p.Handle
	sources := mapOf(p.Images, func(i struct {
		URL string `json:"url"`
	}) string {
		return i.URL
	})
	if len(sources) == 0 && p.Thumbnail != "" {
		sources = []string{p.Thumbnail}
	}
	images := filter(mapOf(sources, func(s string) string { return ShareImage(origin, s) }), func(s string) bool { return s != "" })
	brand := shop
	if b, ok := p.Metadata["brand"].(string); ok && strings.TrimSpace(b) != "" {
		brand = strings.TrimSpace(b)
	}
	offers := mapOf(filter(p.Variants, func(v Variant) bool { return v.Price != nil }), func(v Variant) map[string]any {
		o := map[string]any{
			"@type": "Offer", "url": u, "price": WithTax(v.Price.Calculated, m), "priceCurrency": strings.ToUpper(v.Price.CurrencyCode),
			"availability": ld + "/" + pick(InStock(v), "InStock", "OutOfStock"), "itemCondition": ld + "/NewCondition",
		}
		if v.SKU != "" {
			o["sku"] = v.SKU
		}
		return o
	})
	out := map[string]any{"@context": ld, "@type": "Product", "name": p.Title, "url": u, "brand": map[string]any{"@type": "Brand", "name": brand}, "offers": offers}
	if p.Description != "" {
		out["description"] = p.Description
	}
	if len(images) > 0 {
		out["image"] = images
	}
	if sku != "" {
		out["sku"] = sku
	}
	return out
}

// titleMax is about what search results show of a title.
const titleMax = 60

// TitleWithName is a page's whole <title>: its own and the shop's name, or its own alone when both
// together are longer than search results show.
func TitleWithName(title, name string) string {
	switch whole := title + " | " + name; {
	case title == "":
		return name
	case len([]rune(whole)) <= titleMax:
		return whole
	}
	return title
}

const descriptionMax = 155

var sitemapLine = regexp.MustCompile(`(?i)^\s*sitemap\s*:`)

// ListDescription is a list of products' description when none is written: what it holds, by the
// first products' names, cut at a whole name (or a word) to at most 155 characters, ending
// "and more.".
func ListDescription(what string, titles []string, name string) string {
	const more = " and more."
	lead := what + " at " + name
	all := lead + "."
	if len(titles) > 0 {
		all = lead + ": " + strings.Join(titles, ", ") + "."
	}
	if len([]rune(all)) <= descriptionMax {
		return all
	}
	cut := string([]rune(all)[:descriptionMax-len(more)])
	at := strings.LastIndex(cut, ",")
	if at <= len(lead) {
		at = strings.LastIndex(cut, " ")
	}
	if at > 0 {
		cut = cut[:at]
	}
	return strings.TrimRight(cut, ",:") + more
}

// RobotsTxt is the website's own robots.txt first when it has one (without its sitemap lines,
// which name the old site's sitemap), then the shop's lines, which keep crawlers out of the cart,
// checkout, account and admin (those addresses and what is under them, not a page such as
// /checkout-guide), let them read the pictures and other files Whisk serves (/.whisk/img/<id>?w=…,
// which a site's own `Disallow: /*?` would otherwise keep out; the longer rule wins) and the
// pictures the editor serves (under the `Disallow: /cms` that keeps the editor out), and name the
// one sitemap of both.
func RobotsTxt(origin, own string) string {
	shop := []string{"User-agent: *", "Allow: /.whisk/", "Allow: /cms/api/media/file/"}
	for _, p := range []string{"/cart", "/checkout", "/account"} {
		shop = append(shop, "Disallow: "+p+"$", "Disallow: "+p+"/")
	}
	shop = append(shop, "Disallow: /order/", "Disallow: /app", "Disallow: /cms", "", "Sitemap: "+origin+"/sitemap.xml", "")
	site := strings.TrimRight(strings.Join(filter(strings.Split(own, "\n"), func(l string) bool { return !sitemapLine.MatchString(l) }), "\n"), " \t\r\n")
	if strings.TrimSpace(site) == "" {
		return strings.Join(shop, "\n")
	}
	return strings.Join(append([]string{site, "", "# The shop"}, shop...), "\n")
}
