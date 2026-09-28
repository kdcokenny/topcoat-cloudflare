# Wrangler configuration

Follow the [installation guide](https://www.npmjs.com/package/@topcoat-cloudflare/adapter) for setup, local development, and deployment commands. This page explains the generated configuration and build behavior.

## Required settings

Wrangler's standard `wrangler.jsonc`, `wrangler.json`, and `wrangler.toml` filenames are supported. Setup generates JSONC and the adapter validates these settings:

- `main` points to `.topcoat-cloudflare/dist/entry.ts`.
- `assets.directory` points to `.topcoat-cloudflare/dist/public`, with binding `ASSETS`.
- `assets.html_handling` and `assets.not_found_handling` are `none`.
- `assets.run_worker_first` is `["/*", "!/_topcoat/assets/*"]`.
- `compatibility_date` is explicit and `enable_request_signal` is enabled.
- A text-module rule imports the private asset catalog.
- `build.command` invokes the adapter build hook.

## Development and environments

Wrangler invokes the build hook during development and deployment. The hook installs the supported Rust toolchain, Wasm target, and `worker-build` when missing and reuses them on later builds. Its `WRANGLER_COMMAND` variable selects a development build for `dev` and an optimized release otherwise.

Setup adds source watch paths. Add external source or asset directories to `build.watch_dir` when needed. Keep generated output out of the watch paths to avoid rebuild loops.

Wrangler environments can change bindings, variables, and names. Keep `main`, `assets`, and `build` at the top level; overrides of those fields are rejected. Node compatibility is not required by the adapter. Applications needing Node APIs should test their own compatibility flags.

## Build output

The adapter generates this directory in your application:

```text
.topcoat-cloudflare/
  cache/
  dist/
    entry.ts
    application.ts
    asset-manifest.txt
    build.json
    worker/
      index.js
      index_bg.wasm
    public/
      _headers
      _topcoat/assets/...
```

The Worker and private asset catalog come from the same compilation. The adapter replaces `dist` only after the entire build succeeds. `build.json` records the build profile and hashes of the Wasm and catalog. Deploy the complete output through Wrangler; mixing artifacts from different builds can break asset resolution.

## Failed and interrupted builds

During development, a failed rebuild reports its error and lets Wrangler resume serving the previous development build. An initial build with no previous development output still fails. Deployment build failures always return a nonzero exit status.

A lock prevents simultaneous builds of the same application, and cancellation releases it. After a forced kill, check the PID recorded in `.topcoat-cloudflare/build.lock`. Remove the lock only after confirming that process has stopped.

## Local upload workaround

Development output drains unread rejected uploads to avoid [Wrangler's cancellation/proxy failure](https://github.com/cloudflare/workers-sdk/issues/15709). Bytes are discarded without accumulating the body in memory. A rejection may wait for the upload to finish; accepted streams remain incremental. The build hook selects this entrypoint automatically for `wrangler dev`. Release output uses the normal platform cancellation behavior.
