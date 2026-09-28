# Little Crema on Workers

This is the [official Topcoat coffee-shop demo](https://github.com/tokio-rs/topcoat/tree/4257795ef9d1f79f38d8441f04e9e817b1d50855/demos/coffee-shop), adapted for Cloudflare Workers. The pages, copy, illustration, vendored UI components, and theme come from that revision under the [upstream MIT license](LICENSE.topcoat).

From this directory (`examples/starter`):

```sh
npm ci
npm run dev
npm run build
npm run deploy
```

The same scripts work from the repository root. No database, account binding, or migration is required.

## Try it

1. Leave your name on the home page and reload; a cookie remembers it.
2. Browse the six drinks. Search by name, try an empty result, then clear the search.
3. Open a drink and change its quantity. The price updates in the browser.
4. Select **Order**. A Topcoat server procedure returns a personalized confirmation.
5. Return home and select **Not …?** to remove the cookie.

The menu streams behind a loading skeleton. Search uses a server-rendered shard. The site uses Topcoat's generated JavaScript; no Wasm runs in the browser.

## Source map

- `src/app.rs`: layout, home page, and customer form.
- `src/app/menu.rs`: live search, streamed loading state, and drink cards.
- `src/app/menu/drink.rs`: parameterized drink pages, reactive prices, and ordering.
- `src/customer.rs`: the upstream cookie helpers.
- `src/models.rs` and `src/menu.json`: the bundled menu and request memoization.
- `src/components/`, `styles.css`, and `components.toml`: upstream UI components and theme.
- `src/lib.rs`: the Worker export.

## Workers adaptations

Upstream seeds native in-memory SQLite through Toasty. This version bundles exactly the same six drinks in `src/menu.json`, preserving their order, names, prices, roast profiles, and descriptions. Topcoat memoization shares the parsed menu between the page and layout. Replace that loader with a binding-backed query when a dynamic menu is needed. This demo does not establish SQLite or Toasty compatibility on Workers.

The Worker entrypoint supplies its asset catalog to the router instead of loading assets from a native filesystem. The artificial 500 ms lookup delay uses the Workers scheduler instead of Tokio. Tailwind runs in `build.rs` on the host using the version locked in npm, avoiding a separate standalone-executable download. Build through the npm commands so `tailwindcss` is available on `PATH`; its generated CSS is declared directly as a Topcoat asset so the native downloader stays out of the Worker. Geist fonts are downloaded during bundling and served from the same site. Wrangler handles development reloads.

The layout adds a language, character encoding, and viewport declaration for mobile browsers. Otherwise the upstream presentation and interactions are retained. Like upstream, an order only returns a confirmation: it is not saved and no payment is taken.

From the repository root, run `npm run test:smoke` to verify the demo locally, or set `TOPCOAT_SMOKE_URL` to test an existing deployment. The separate integration fixture retains the adapter's broader runtime coverage.

## Automatic deployment

Deploy this demo with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) using these settings:

| Setting           | Value                          |
| ----------------- | ------------------------------ |
| Repository        | `kdcokenny/topcoat-cloudflare` |
| Worker name       | `topcoat-cloudflare-starter`   |
| Production branch | `main`                         |
| Root directory    | `examples/starter`             |
| Build command     | Leave empty                    |
| Deploy command    | `npm run deploy`               |

Leave automatic dependency installation enabled; remove `SKIP_DEPENDENCY_INSTALL` if previously set. The example's `.node-version` points to the repository's Node version.

The standard npm install lifecycle prepares the workspace adapter. Wrangler then builds and deploys the app, installing missing Rust tools automatically. A separate Cloudflare build command would compile the application twice. Cloudflare supplies credentials through its Git integration.

GitHub CI tests the adapter and performs a deployment dry run. Workers Builds deploys separately. Require CI before merging if deployment must wait for tests. After deployment, run the [live smoke checks](../../docs/testing.md#deployed-checks).
