// The helpers the shop's theme (theme/) calls beside the shared ones (draw.go): money, dates and
// what a cart, an order or a product shows.
package main

import (
	"html/template"
	"strings"
)

// ShopFuncs are the shop's own template helpers.
func ShopFuncs() template.FuncMap {
	return template.FuncMap{
		"money":        Money,
		"date":         DateIn,
		"variantLabel": VariantLabel,
		"lineAmount":   LineAmount,
		"sums":         SumsFor,
		"orderStatus":  OrderStatus,
		"awaiting":     AwaitingTransfer,
		// from is a product's lowest price, or nil when none of its variants has one.
		"from": func(vs []Variant) *From {
			if f, ok := FromPrice(vs); ok {
				return &f
			}
			return nil
		},
		"inStock": InStock,
		"upper":   strings.ToUpper,
		"withTax": WithTax,
		"join":    strings.Join,
		"lineHandle": func(l Line) string {
			if l.ProductHandle != "" {
				return l.ProductHandle
			}
			if l.Variant != nil && l.Variant.Product != nil {
				return l.Variant.Product.Handle
			}
			return ""
		},
		// same says whether two values read the same, for a chosen option or address.
		"same":         func(a, b any) bool { return str(a) == str(b) },
		"add":          func(a, b int) int { return a + b },
		"optionAmount": OptionAmount,
		"addressLabel": AddressLabel,
		"cardImg":      CardImg,
	}
}

// CardImg is a product card's square picture, 400 px: eager for the cards at the top of a page,
// and loaded before anything else for the first of them.
func CardImg(address string, eager, first bool) template.HTML {
	pic := Picture(address, 400)
	return ImgTag(ImgAttrs{Src: pic.Src, Srcset: pic.Srcset, Sizes: "(min-width: 1024px) 25vw, (min-width: 720px) 33vw, 50vw",
		Width: 400, Height: 400, Loading: pick(eager, "eager", "lazy"), Priority: pick(first, "high", "auto")})
}
