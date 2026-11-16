// Talking to the shop's store API (Whisk's commerce engine, in Medusa's shape) for one request:
// the visitor's cookies go with every call, and any cookie the API sets (a new session, a sign-in
// code's nonce) goes with the calls after it and back to the browser.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// APIError is the API's refusal: its status and its message.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return e.Message }

// refused is the API's refusal of a request (a status under 500), as the message to show; false
// for any other failure, which the page reports as its own.
func refused(err error) (string, bool) {
	var e *APIError
	if errors.As(err, &e) && e.Status < 500 {
		return e.Message, true
	}
	return "", false
}

func statusOf(err error) int {
	var e *APIError
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

// Visit is what the API is told of the visitor's request.
type Visit struct {
	Cookie       string
	Proto        string
	Host         string
	ForwardedFor string
}

// API is the store API for one request.
type API struct {
	shop   Storefront
	visit  Visit
	client *http.Client
	mu     sync.Mutex
	set    []string // cookies the API set during this request, in order
}

// NewAPI is the store API for one visit to the shop.
func NewAPI(shop Storefront, visit Visit, client *http.Client) *API {
	return &API{shop: shop, visit: visit, client: client}
}

// SetCookies are the cookies the API set during this request, for the answer to carry.
func (a *API) SetCookies() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.set...)
}

func (a *API) send(ctx context.Context, method, path string, body any, bearer string, into any) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var payload io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.shop.API+path, payload)
	if err != nil {
		return err
	}
	h := req.Header
	h.Set("accept", "application/json")
	h.Set("x-publishable-api-key", a.shop.PublishableKey)
	// The API sets Secure cookies only on a request it knows came over HTTPS; the edge ended it.
	h.Set("x-forwarded-proto", a.visit.Proto)
	// The domain the visitor came to, so the API's emails link to that market's site.
	h.Set("x-forwarded-host", a.visit.Host)
	if a.visit.ForwardedFor != "" {
		h.Set("x-forwarded-for", a.visit.ForwardedFor)
	}
	if cookie := MergedCookies(a.visit.Cookie, a.SetCookies()); cookie != "" {
		h.Set("cookie", cookie)
	}
	if bearer != "" {
		h.Set("authorization", "Bearer "+bearer)
	}
	if a.shop.App != "" {
		h.Set(shopAppHeader, a.shop.App)
	}
	if body != nil {
		h.Set("content-type", "application/json")
	}
	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	a.mu.Lock()
	a.set = append(a.set, res.Header.Values("set-cookie")...)
	a.mu.Unlock()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 {
		return &APIError{Status: res.StatusCode, Message: ErrorMessage(raw, res.StatusCode)}
	}
	if into == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, into)
}

// Get reads path into into.
func (a *API) Get(ctx context.Context, path string, into any) error {
	return a.send(ctx, http.MethodGet, path, nil, "", into)
}

// Post sends body to path, as bearer when one is given, and reads the answer into into.
func (a *API) Post(ctx context.Context, path string, body any, bearer string, into any) error {
	if body == nil {
		body = map[string]any{}
	}
	return a.send(ctx, http.MethodPost, path, body, bearer, into)
}

// Delete deletes path.
func (a *API) Delete(ctx context.Context, path string) error {
	return a.send(ctx, http.MethodDelete, path, nil, "", nil)
}

// ErrorMessage is what the API's error says, or a sentence for its status.
func ErrorMessage(raw []byte, status int) string {
	var body struct {
		Message string `json:"message"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &body) == nil {
		if m := pick(body.Error.Message != "", body.Error.Message, body.Message); m != "" {
			return m
		}
	}
	if text := strings.TrimSpace(string(raw)); text != "" && !strings.HasPrefix(text, "{") && len(text) < 300 {
		return text
	}
	return fmt.Sprintf("The shop answered %d.", status)
}

var expiredCookie = regexp.MustCompile(`(?i);\s*(max-age=0|expires=thu, 01 jan 1970)`)

// MergedCookies are the browser's cookies with any the API has just set laid over them, so a call
// made after sign-in carries the new session. A cookie keeps its place; an expired one goes.
func MergedCookies(header string, set []string) string {
	type pair struct{ name, value string }
	put := func(jar []pair, name, value string) []pair {
		if i := index(jar, func(p pair) bool { return p.name == name }); i >= 0 {
			rest := append(append([]pair{}, jar[:i]...), jar[i+1:]...)
			if value == "" {
				return rest
			}
			return append(append(append([]pair{}, jar[:i]...), pair{name, value}), jar[i+1:]...)
		}
		if value == "" {
			return jar
		}
		return append(append([]pair{}, jar...), pair{name, value})
	}
	jar := []pair{}
	for _, part := range strings.Split(header, ";") {
		if name, value, ok := strings.Cut(strings.TrimSpace(part), "="); ok && name != "" {
			jar = put(jar, name, value)
		}
	}
	for _, sc := range set {
		first, _, _ := strings.Cut(sc, ";")
		if name, value, ok := strings.Cut(first, "="); ok && name != "" {
			jar = put(jar, name, pick(expiredCookie.MatchString(sc), "", value))
		}
	}
	return strings.Join(mapOf(jar, func(p pair) string { return p.name + "=" + p.value }), "; ")
}

func index[T any](xs []T, ok func(T) bool) int {
	for i, x := range xs {
		if ok(x) {
			return i
		}
	}
	return -1
}

// Query is a query from params, leaving out empty values and repeating lists.
func Query(params ...any) string {
	q := url.Values{}
	for i := 0; i+1 < len(params); i += 2 {
		k := str(params[i])
		switch v := params[i+1].(type) {
		case []string:
			for _, x := range v {
				q.Add(k, x)
			}
		case nil:
		default:
			if s := str(v); s != "" {
				q.Set(k, s)
			}
		}
	}
	return withMark(encodeOrdered(q, params))
}

// encodeOrdered encodes q in the order its keys were given, so a query reads as it was written.
func encodeOrdered(q url.Values, params []any) string {
	var parts []string
	seen := map[string]bool{}
	for i := 0; i+1 < len(params); i += 2 {
		k := str(params[i])
		if seen[k] {
			continue
		}
		seen[k] = true
		for _, v := range q[k] {
			parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(parts, "&")
}
