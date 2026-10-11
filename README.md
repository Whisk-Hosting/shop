# whisk-shop

A business's website and online shop on Whisk, headless, in one app on one address. Astro draws
every page from two back ends beside it: [Medusa](https://medusajs.com) for products, prices,
stock, carts, orders and payments, and [Payload](https://payloadcms.com) for the website's pages,
each product's story, the menus and the pictures. It sells in New Zealand dollars with GST
included, or in Australia (`SHOP_COUNTRY`, below), takes cards, Apple Pay, Google Pay and
Afterpay through Stripe, cards through Windcave, PayPal, and bank transfer, and emails customers
their orders. Customers sign in with an emailed code or a password. Any business can run it.
It needs about 700 MB of memory, which a Promoted app has; trade ordering (companies, trade
prices, approvals, pay on account) comes only with a Promoted app (`promoted: true` and
`b2b: true`).

The business's Whisk team runs everything from one admin at `/app` with their Whisk sign-in:
orders, products and customers, and beside them Pages, Product pages, Menu and Media, which open
Payload's editor inside the admin. A page is a list of blocks (hero, text, picture, columns,
products, form, HTML) at an address; drafts are seen only by the team, in a preview that follows
the edit. A product's page at `/products/<handle>` shows its live price, options and stock from
Medusa, then the blocks of the product page with the same handle. A form block posts to
`/forms/<name>`, kept in the database's `form_entries` table.

The shop's pages are at `/shop` (its home), `/products`, `/categories`, `/collections`, `/cart`,
`/checkout`, `/account`, `/order` and `/search`; every other address is the website's, with one
`sitemap.xml` and `robots.txt` for both. `/` is the website's page at `/`, or the shop's home
until there is one. Old addresses go in `redirects.json` (`{"from": "/old", "to": "/new"}`, or
`"status": 410` for a page that is gone). Starting content goes in `cms/content/` and is added
once, never over an edit (`cms/src/content.ts` says how).

The look is `storefront/` (Astro): the layout, the blocks (`storefront/src/blocks`, one per
Payload block in `cms/src/blocks`) and `src/styles/shop.css`. Change a block in both places, then
`cd cms && npx payload migrate:create <name>` for the database.

```
medusa-config.ts            Medusa on Whisk: database, cache, storage, email, payments
migrate.ts                  the migrate step: Medusa's migrations, src/scripts/setup.ts, Payload's
src/scripts/setup.ts        NZD with GST, the New Zealand region, delivery, the storefront's key
src/api/middlewares.ts      staff-only admin, rate limits, the editor at /cms, the storefront
src/lib/cms.ts              starts Payload beside Medusa and passes /cms to it
src/admin/routes/           Pages, Product pages, Menu and Media in the admin
src/api/auth/               sign-in codes for customers; /auth/whisk signs staff in
src/modules/                Whisk storage and email, and the Windcave and PayPal providers
src/subscribers/, src/jobs/ order and password emails
storefront/                 every page: the website's blocks and the shop's pages
cms/                        Payload: pages, product pages, menus, media, its migrations
scripts/shop.mjs            build, start, migrate, dev
```

## Run it

`whisk dev` needs Docker with the compose plugin. It starts Postgres, the cache and a local edge,
then runs the shop with the environment it has in production:

```
npm install
npm run build
whisk dev --as you@example.com --roles owner -- npm run start
```

These lines work the same in PowerShell, Command Prompt and a Unix shell. `whisk dev` runs the
migration (`node migrate.js` in the build) first. Open http://127.0.0.1:3000 for the shop and
http://127.0.0.1:3000/app for the admin. `npm run dev` instead rebuilds the server as its source
changes.

## Where it sells

New Zealand, in New Zealand dollars with 15% GST included in prices, unless `env` in
`whisk.yaml` says otherwise before the first deploy (setup adds the market's region, tax and
delivery once and then leaves them to the admin):

| Setting | Values |
|---|---|
| `SHOP_COUNTRY` | `nz` (default) or `au`: Australian dollars, 10% GST |
| `SHOP_PRICES_INCLUDE_TAX` | `false` when prices are entered before tax and the tax is added at checkout |
| `SHOP_TIME_ZONE` | the time zone order dates are shown in, such as `Australia/Perth` |

With prices before tax, the cart, checkout, order pages and emails show lines and the subtotal
before tax, the tax on its own line, then the total.

## Start with a catalogue

`catalogue/catalogue.json` lists products to start with: `{"products": [{"handle":
"impairment-goggles", "title": "Impairment Goggles", "price": 325, "sku": "IG", "categories":
["Goggles"], "options": [{"title": "Type", "values": ["Low", "High"]}], "images":
["goggles.jpg"]}]}`. Prices are entered as the market enters them (with or without tax);
`inStock: false` lists a product as sold out until staff add stock. A picture is a file in
`catalogue/images`, stored on Whisk, or an address (`/catalogue/goggles.jpg` from
`storefront/public`, or `https://…`) used as it is. A job adds every product and category the
shop does not have yet, by handle, within a minute of each deploy, so products staff change in
the admin are never overwritten.

## Take payments

Bank transfer is on once the business's account is in the admin: Settings, Store, Metadata,
`bank_account_name` and `bank_account_number`. Each other way to pay is on when its secrets are
declared under `secrets` in `whisk.yaml` and a person sets their values in the dashboard (the
deploy waits until they have):

| Provider | Secrets |
|---|---|
| Stripe | `STRIPE_API_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`; its webhook goes to `https://<shop>/hooks/payment/stripe_stripe` |
| Windcave | `WINDCAVE_USERNAME`, `WINDCAVE_API_KEY` |
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` |

`*_CAPTURE: manual` in `whisk.yaml` takes payment when an order is sent rather than when it is
placed; `WINDCAVE_ENVIRONMENT` and `PAYPAL_ENVIRONMENT` other than `live` use their test
systems.

## Test it

`npm test` runs the unit tests; `npm run typecheck` checks the types of the server and the pages,
and `cd cms && npm run typecheck` those of the editor.

## Ship it

`whisk doctor`, then `whisk deploy -m "<what changed, for the shop's customers and staff>"`.
