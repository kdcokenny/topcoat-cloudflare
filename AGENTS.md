# Working in this repository

This repository develops the adapter and its coffee-shop demo. Consumers install the packages into their own applications using the [installation guide](packages/adapter/README.md).

## Relevant guides

- [CONTRIBUTING.md](CONTRIBUTING.md): repository setup and development commands. Local development requires no Cloudflare credentials.
- [Demo guide](examples/starter/README.md): application files and upstream adaptations; the home page is `examples/starter/src/app.rs`.
- [Compatibility](docs/compatibility.md): supported behavior and limitations when changing the runtime.
- [Integration](docs/integration.md): framework features and Workers bindings. Use Topcoat's public APIs and link to its guides rather than duplicating its implementation.

## Boundaries

- `crates/topcoat-cloudflare`: the runtime bridge. Keep bindings request-scoped and bodies streaming. No unsafe code.
- `crates/topcoat-cloudflare-build`: native asset packaging. Keep the asset catalog private.
- `packages/adapter`: build integration invoked by Wrangler. Promote complete builds together; preserve the last good build after failures. Installed adapter code must work without repository-root files; release preparation may read them to generate package metadata. Wrangler owns watching and deployment.
- `tests/fixture`: diagnostic routes, including deliberate panics. Never use it as the production app.
- `examples/starter`: preserve upstream UI components unless the task calls for changing them.
- `examples/ui`, `examples/api`, `examples/d1`: standalone applications using published packages. `tests/sites` tests isolated copies; keep application source in the examples. Preserve upstream licenses in all examples; the API quiz is GPL-3.0.

## Tooling and validation

Write JavaScript tooling in TypeScript with strict checks. Use Oxfmt (`npm run format`) and type-aware Oxlint (`npm run lint`); CI accepts no lint warnings. Keep setup versions in `package.json`, `rust-toolchain.toml`, and `Cargo.toml`, without duplicating them in scripts. Generated JavaScript belongs in the ignored package output.

Choose checks using the [testing guide](docs/testing.md). For documentation-only edits, check formatting, links, and accuracy; runtime tests are unnecessary. Packaging changes need `npm run test:consumer`, which installs packed artifacts outside the checkout. `npm run verify` provides full local verification; the guide covers browser setup.

Local tests use workerd and emulated bindings. Run relevant checks, fix failures caused by the requested change, and rerun affected checks without asking for approval at each step. `test:dev` temporarily edits the starter: stop its dev server and avoid concurrent edits to those files; restore the preview afterward when needed.

Keep credentials, generated output, local binding data, and test artifacts out of Git. Distinguish local workerd tests, CI, and deployed evidence when reporting results.
