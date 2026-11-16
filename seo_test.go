package main

import (
	"encoding/json"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func TestCanonicalAndPictures(t *testing.T) {
	for in, want := range map[string]string{
		"/products?page=2&q=x":          "https://shop.example.com/products?page=2",
		"/products?page=1":              "https://shop.example.com/products",
		"/products?page=abc":            "https://shop.example.com/products",
		"/products/gloves?option_1=red": "https://shop.example.com/products/gloves",
	} {
		u, _ := url.Parse(in)
		if got := CanonicalURL("https://shop.example.com", *u); got != want {
			t.Errorf("%s: %s", in, got)
		}
	}
	o := "https://shop.example.com"
	cases := map[string]string{
		"/catalogue/a.jpg":              "https://shop.example.com/catalogue/a.jpg",
		"https://cdn.example.com/a.jpg": "https://cdn.example.com/a.jpg",
		"":                              "",
	}
	for in, want := range cases {
		if got := AbsoluteURL(o, in); got != want {
			t.Errorf("AbsoluteURL(%q) = %q", in, got)
		}
	}
	for _, in := range []string{"/.whisk/img/01J?w=300&format=auto", "https://shop.example.com/.whisk/img/01J", "https://acme.whisk.page/.whisk/img/01J"} {
		if got := ShareImage(o, in); got != "https://shop.example.com/.whisk/img/01J?w=1200&format=jpeg" {
			t.Errorf("ShareImage(%q) = %q", in, got)
		}
	}
	if WithTax(100, Market{TaxRate: 10}) != 110 || WithTax(19.99, Market{TaxRate: 15}) != 22.99 || WithTax(110, Market{TaxRate: 10, TaxInclusive: true}) != 110 {
		t.Error("WithTax")
	}
}

func TestProductLD(t *testing.T) {
	var p Product
	_ = json.Unmarshal([]byte(`{"title":"Work Gloves","handle":"work-gloves","description":"Tough gloves.","metadata":{"brand":"Acme"},
		"images":[{"url":"/.whisk/img/01J"},{"url":"/catalogue/b.jpg"}],
		"variants":[{"sku":"G-S","manage_inventory":true,"inventory_quantity":0,"calculated_price":{"calculated_amount":100,"currency_code":"aud"}},
		{"sku":"G-L","manage_inventory":false,"calculated_price":{"calculated_amount":120,"currency_code":"aud"}},{"sku":"G-X"}]}`), &p)
	got := ProductLD(p, "https://shop.example.com", "Acme Supply", Market{TaxRate: 10}, "G-S")
	if got["url"] != "https://shop.example.com/products/work-gloves" || !reflect.DeepEqual(got["brand"], map[string]any{"@type": "Brand", "name": "Acme"}) {
		t.Errorf("%v", got)
	}
	if !reflect.DeepEqual(got["image"], []string{"https://shop.example.com/.whisk/img/01J?w=1200&format=jpeg", "https://shop.example.com/catalogue/b.jpg"}) {
		t.Error(got["image"])
	}
	offers := got["offers"].([]map[string]any)
	if len(offers) != 2 || offers[0]["price"] != 110.0 || offers[0]["availability"] != "https://schema.org/OutOfStock" || offers[1]["price"] != 132.0 || offers[1]["priceCurrency"] != "AUD" {
		t.Error(offers)
	}
	plain := ProductLD(Product{Title: "Cap", Handle: "cap"}, "https://shop.example.com", "Acme Supply", Market{TaxRate: 15, TaxInclusive: true}, "")
	if !reflect.DeepEqual(plain["brand"], map[string]any{"@type": "Brand", "name": "Acme Supply"}) || plain["image"] != nil || len(plain["offers"].([]map[string]any)) != 0 {
		t.Error(plain)
	}
	site := SiteLD("https://shop.example.com", "Acme Supply")
	if site[0]["@type"] != "Organization" || site[1]["url"] != "https://shop.example.com/" {
		t.Error(site)
	}
	trail := BreadcrumbLD("https://shop.example.com", []Crumb{{"Acme Supply", "/"}, {"Gloves", "/categories/gloves"}})
	if !reflect.DeepEqual(trail["itemListElement"].([]map[string]any)[1], map[string]any{"@type": "ListItem", "position": 2, "name": "Gloves", "item": "https://shop.example.com/categories/gloves"}) {
		t.Error(trail)
	}
}

func TestFirstPicture(t *testing.T) {
	var layout []Block
	_ = json.Unmarshal([]byte(`[{"blockType":"content","text":"Hello"},{"blockType":"media","image":{"url":"/.whisk/media/V","mimeType":"video/mp4"}},
		{"blockType":"columns","items":[{"heading":"One"},{"image":{"url":"/.whisk/img/COL","mimeType":"image/png"}}]},{"blockType":"hero","image":{"url":"/.whisk/img/HERO"}}]`), &layout)
	if got := FirstPicture(layout); got != "/.whisk/img/COL" {
		t.Error(got)
	}
	if FirstPicture([]Block{{"blockType": "hero", "image": 12.0}}) != "" || FirstPicture(nil) != "" {
		t.Error("none")
	}
}

func TestTitlesAndDescriptions(t *testing.T) {
	cases := [][3]string{
		{"Gloves", "Maple Supply", "Gloves | Maple Supply"},
		{"UroColor 4S Urinalysis Test Strips (pack of 100)", "Maple Supply Company", "UroColor 4S Urinalysis Test Strips (pack of 100)"},
		{"", "Maple Supply", "Maple Supply"},
	}
	for _, c := range cases {
		if got := TitleWithName(c[0], c[1]); got != c[2] {
			t.Errorf("%q", got)
		}
	}
	if ListDescription("Gloves", []string{"Small", "Large"}, "Acme") != "Gloves at Acme: Small, Large." || ListDescription("Gloves", nil, "Acme") != "Gloves at Acme." {
		t.Error("short")
	}
	titles := mapOf([]int{0, 1, 2, 3, 4, 5}, func(i int) string { return "Breathalyser model number " + itoa(i) + " with a long name" })
	long := ListDescription("Alcohol Testing", titles, "Maple Supply Company")
	if len([]rune(long)) > 155 || !strings.HasPrefix(long, "Alcohol Testing at Maple Supply Company: Breathalyser model number 0 ") || !strings.HasSuffix(long, " and more.") {
		t.Error(long)
	}
}

func TestShopRobots(t *testing.T) {
	shop := "User-agent: *\nAllow: /.whisk/\nAllow: /cms/api/media/file/\nDisallow: /cart$\nDisallow: /cart/\nDisallow: /checkout$\nDisallow: /checkout/\nDisallow: /account$\nDisallow: /account/\nDisallow: /order/\nDisallow: /app\nDisallow: /cms\n\nSitemap: https://shop.example.com/sitemap.xml\n"
	cases := map[string]string{
		"":     shop,
		"  \n": shop,
		"User-agent: *\nDisallow: /wp-admin/\n\n":                                     "User-agent: *\nDisallow: /wp-admin/\n\n# The shop\n" + shop,
		"User-agent: *\nAllow: /\nSitemap: https://old.example.com/sitemap_index.xml": "User-agent: *\nAllow: /\n\n# The shop\n" + shop,
	}
	for in, want := range cases {
		if got := RobotsTxt("https://shop.example.com", in); got != want {
			t.Errorf("RobotsTxt(%q) =\n%s", in, got)
		}
	}
}
