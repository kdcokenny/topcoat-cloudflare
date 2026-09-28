# Families on D1

Create, edit, delete, and restore family records with cursor pagination and stale-edit detection.

**Experimental:** uses a pinned, unpublished [Toasty D1 driver](https://github.com/tokio-rs/toasty/pull/1134), not released Toasty 0.11. This example runs locally and has no authentication.

## Run locally

With the [adapter prerequisites](../../packages/adapter/README.md#prerequisites), run from this directory:

```sh
npm ci
npx wrangler d1 migrations apply DB --local
npm run dev
```

Open the URL Wrangler prints and choose **Create family**. No Cloudflare account is needed. Data stays in `.wrangler/` across restarts. To try conflict handling, edit the same family in two tabs and save both.

## Code

| File                           | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| [src/app/](src/app/)           | Pages, forms, and actions                           |
| [src/family.rs](src/family.rs) | Model and cursor queries                            |
| [src/db.rs](src/db.rs)         | Request-scoped D1 access and version-checked writes |
| [migrations/](migrations/)     | Schema                                              |

The driver lacks the interactive transactions Toasty's versioned updates require. Edits, deletes, and restores use one conditional SQL statement instead; stale versions report a conflict.

## Verify

From the repository root, run `npm run test:sites -- f4y` or `npm run benchmark:sites -- f4y`. Tests use a separate database and leave yours untouched. See [benchmarks](../../docs/benchmarks.md).

Adapted from [f4y-example at f6aa014](https://github.com/edinsonjim/f4y-example/tree/f6aa014be8a086400ba8d3e9f33e81b933104589) under its included [MIT license](LICENSE).
