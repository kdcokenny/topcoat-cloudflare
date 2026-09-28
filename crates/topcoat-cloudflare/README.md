# Topcoat on Cloudflare Workers

The runtime adapter for Topcoat HTTP applications. Rust executes as server-side Wasm; Topcoat still generates ordinary browser JavaScript.

```rust
use topcoat::{asset::{AssetConfig, RouterBuilderAssetExt}, router::Router};

fn router(assets: AssetConfig) -> Router {
    Router::builder().assets(assets).build()
}

topcoat_cloudflare::entrypoint!(router);
```

Use a `cdylib` target and depend directly on `worker` with its `http` feature and `wasm-bindgen`. Wrangler invokes the companion `@topcoat-cloudflare/adapter` npm package to build the Worker and bundle Topcoat assets.

See the [installation guide](https://www.npmjs.com/package/@topcoat-cloudflare/adapter) for the complete configuration. Access Cloudflare bindings through `env(cx)` and `execution_context(cx)`; use `sleep` in streaming views.

Supports HTTP rendering, procedures, reactive shards, streaming, cookies, and Workers bindings. Persistent Topcoat connected rendering and native Tokio/filesystem/database integrations require separate platform support.
