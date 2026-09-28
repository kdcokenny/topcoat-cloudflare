# Working in this repository

Start with [README.md](README.md). Prioritize the consumer installation guide in `packages/adapter/README.md`. Users install packages into their own applications; this repository contains adapter development tools and its coffee-shop demo.

## Set up and run

From the repository root, run `npm ci`, then `npm run dev`. Installation prepares the local adapter package; the first build installs any missing Rust tools. For another port, use `npm run dev -- --port 3001`. Local development requires no Cloudflare credentials.

Edit `examples/starter/src/app.rs` for the home page. The [demo guide](examples/starter/README.md) maps the other application files. Preserve the upstream UI components and their license unless the task calls for changing them.

## Boundaries

- `crates/topcoat-cloudflare`: the runtime bridge. Keep bindings request-scoped and bodies streaming. No unsafe code.
- `crates/topcoat-cloudflare-build`: native asset packaging. Keep the asset catalog private.
- `packages/adapter`: TypeScript build integration invoked by Wrangler. Promote complete builds together; preserve the last good build after failures.
- `tests/fixture`: diagnostic routes, including deliberate panics. Never use it as the production app.
- `examples/ui`, `examples/api`, `examples/d1`: standalone applications using published packages. `tests/sites` tests isolated copies; keep application source in the examples and local state out of Git. Preserve each example's upstream license; the API quiz is GPL-3.0.

Read [compatibility](docs/compatibility.md) before changing runtime behavior and [integration](docs/integration.md) before adding framework features. Use Topcoat's public APIs; link to its guides instead of duplicating its implementation.

## Verify changes

`npm run verify` runs runtime and consumer checks locally. CI splits them so the consumer job can run with no adapter source checkout. It requires Chromium: install it with `npx playwright install --with-deps chromium`, or set `PROBE_CHROMIUM` to an installed executable. For focused work, see the check-to-change map in [testing.md](docs/testing.md).

The development test temporarily edits the starter. Stop its dev server and avoid editing the same files while that test runs; restart the preview afterward when needed.

When changing packaging, run `npm run test:consumer`; it installs packed artifacts into an independent app. Keep installed adapter code independent of repository-root files. Release preparation may read those files and generate package metadata.

Keep tests at the layer that owns the behavior. Explain constraints and surprising decisions in comments; use names for policy limits and timing settings. Keep setup versions in `package.json`, `rust-toolchain.toml`, and `Cargo.toml`. Do not add a second version list to scripts.

Never commit credentials, generated output, local binding data, or test artifacts. Distinguish local workerd tests, CI, and deployed evidence when reporting results.

Write JavaScript tooling in TypeScript with strict checks. Use Oxfmt (`npm run format`) and type-aware Oxlint (`npm run lint`); CI accepts no lint warnings. Wrangler owns development watching and deployment; keep the adapter focused on setup and building. Generated JavaScript belongs only in the ignored package output.
