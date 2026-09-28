# Topcoat on Cloudflare Workers

Install the adapter in your Topcoat application, then use Wrangler to develop and deploy it. Wrangler builds the Rust Worker and Topcoat assets automatically.

## Prerequisites

Use Node.js 22 or newer, Rust's native C/C++ build tools, and (on Linux) `pkg-config` plus OpenSSL development headers. On Ubuntu/Debian: `sudo apt-get install build-essential pkg-config libssl-dev`. Linux is tested; use WSL on Windows.

## 1. Install and configure the adapter

Run these commands in your application crate, alongside its `Cargo.toml`:

```sh
npm install --save-dev @topcoat-cloudflare/adapter
npx topcoat-cloudflare setup
npm install
```

`setup` adds Wrangler configuration and a Rust toolchain file when absent, preserves your npm scripts and Rust source, and records the required npm dependencies. Run it once and commit the configuration. Builds install missing Rust tools automatically; the first build can take several minutes, and later builds reuse installed tools.

## 2. Export your router

Configure your application's `Cargo.toml`:

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
topcoat = { version = "=0.9.0", default-features = false, features = ["router", "view", "runtime", "asset"] }
topcoat-cloudflare = "=0.1.0"
worker = { version = "=0.8.7", features = ["http"] }
wasm-bindgen = "0.2"
```

Enable any additional Topcoat features your application uses. Native server, filesystem, and WebSocket features must stay outside the Wasm dependency graph. A native executable needs a library entrypoint; keep its HTTP routes in reusable modules.

In `src/lib.rs`, export your application's router:

```rust
mod app;
topcoat_cloudflare::entrypoint!(app::router);
```

In `src/app.rs`, accept and register the supplied asset configuration alongside your routes:

```rust
use topcoat::{
    asset::{AssetConfig, RouterBuilderAssetExt},
    router::{module_router, Router},
};

pub fn router(assets: AssetConfig) -> Router {
    module_router!().assets(assets).build()
}
```

Use `topcoat::runtime::script()` in the HTML shell and Topcoat's normal `asset!` declarations. Keep your routes in the router above and register the supplied `AssetConfig`.

## 3. Develop locally

Generate the Cargo lockfile, then start Wrangler:

```sh
cargo generate-lockfile
npx wrangler dev --live-reload
```

For another port, add `--port 3001`. No Cloudflare account is required for local development. Commit `Cargo.lock`, `package-lock.json`, `rust-toolchain.toml`, and your Wrangler configuration.

## 4. Deploy

Set your Worker name and bindings in `wrangler.jsonc`, then:

```sh
npx wrangler login
npx wrangler deploy --dry-run
npx wrangler deploy
```

The dry run checks deployment packaging without uploading. Deployment builds an optimized release. To build release output without deploying, run `npx topcoat-cloudflare build`.

See [Wrangler configuration](https://github.com/kdcokenny/topcoat-cloudflare/blob/main/docs/deployment.md) for watch paths, environments, and build output.

### Automatic deployment

For Workers Builds, connect **your application's repository** and use:

- Root directory: your application directory (containing `wrangler.jsonc`).
- Build command: leave empty.
- Deploy command: `npx wrangler deploy`.

Leave automatic dependency installation enabled. Wrangler performs the release build through the configured build hook, including tool preparation. Cloudflare supplies deployment credentials through its Git integration; `setup` is not part of deployment.

## Compatibility

This release targets Topcoat 0.9.0 and Workers HTTP applications. Browser signals, procedures, shards, cookies, and progressive HTML remain Topcoat features. Native database clients and filesystem/network servers need Workers-compatible alternatives. Persistent `connected(cx)` rendering is unsupported.

See the [integration guide](https://github.com/kdcokenny/topcoat-cloudflare/blob/main/docs/integration.md) for bindings, sessions, timers, and public files, and the [compatibility matrix](https://github.com/kdcokenny/topcoat-cloudflare/blob/main/docs/compatibility.md) for tested scope.
