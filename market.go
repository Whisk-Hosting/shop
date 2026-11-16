// Where the shop sells, as far as its pages need it: which market's site a request was made to,
// read from SHOP_MARKETS ("nz=example.co.nz, au=example.com.au"). Setup and the storefront's own
// context (shop.go) carry the rest (src/lib/market.ts). Pure; table-tested.
package main

import (
	"regexp"
	"strings"
)

var portSuffix = regexp.MustCompile(`:\d+$`)

// BareHost is a domain as the shop compares them: lower case, without a port, a last dot or "www.".
func BareHost(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	h = portSuffix.ReplaceAllString(h, "")
	return strings.TrimPrefix(strings.TrimSuffix(h, "."), "www.")
}

// MarketHosts is each market's key and domain from SHOP_MARKETS, in order; nothing for a shop that
// sells in one market.
func MarketHosts(raw string) [][2]string {
	entries := filter(mapOf(strings.Split(raw, ","), strings.TrimSpace), func(s string) bool { return s != "" })
	return mapOf(entries, func(e string) [2]string {
		key, host, _ := strings.Cut(e, "=")
		return [2]string{strings.ToLower(strings.TrimSpace(key)), BareHost(host)}
	})
}

// SiteMarket is the market whose site a host is, in a shop that sells in several: the one
// SHOP_MARKETS gives it, or the first; "" in a shop that sells in one.
func SiteMarket(markets [][2]string, host string) string {
	if len(markets) < 2 {
		return ""
	}
	if m, ok := find(markets, func(m [2]string) bool { return m[1] == BareHost(host) }); ok {
		return m[0]
	}
	return markets[0][0]
}
