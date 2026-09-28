# Contributing

This checkout is for adapter development. To deploy your own application, use the [installation guide](packages/adapter/README.md).

Use the Node release in `.node-version`, then run `npm ci` and `npm run dev`. Installation prepares the same package contents shipped to consumers. Edit `examples/starter/src/app.rs` to work on the demo; `npm run dev -- --port 3001` selects a port.

Keep changes focused on the runtime boundary, build tooling, or a documented compatibility gap. Add a regression test for behavior that was broken; avoid duplicating Topcoat's own implementation tests.

Run the checks in [testing.md](docs/testing.md). Runtime behavior must be tested in workerd, and changes affecting browser interactions need a browser test. Include the supported version combination and any limitations in a pull request.

Use normal errors for expected failures. Keep platform bindings request-scoped. Preserve streaming and cancellation. Never commit credentials, generated build output, local binding data, or test artifacts.

Write tooling and tests in TypeScript. `npm run format` uses Oxfmt for TypeScript, JSON, YAML, TOML, CSS, and Markdown; format Rust with `cargo fmt --all`. `npm run lint` runs Oxlint with type-aware rules, and `npm run lint:fix` applies automatic fixes. `npm run check` runs formatting, linting, strict TypeScript checks, and Rust checks. Keep public APIs documented and examples small enough to read in one sitting.

When upgrading dependencies, keep transitive versions within their parent packages' supported ranges. Update the npm `allowScripts` entries for esbuild, workerd, and Parcel watcher when those versions change; their install scripts prepare native binaries. Run `npm run verify` and update the [tested versions](docs/compatibility.md#tested-versions).
