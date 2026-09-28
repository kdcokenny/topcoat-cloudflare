# Bindings and runtime APIs

First follow the [installation guide](https://www.npmjs.com/package/@topcoat-cloudflare/adapter) to export your router and configure Wrangler. This page covers using Workers services from Topcoat.

## Request context

The router is shared across requests. Keep application state that is safe to share on the router; retrieve bindings and per-request state from `&Cx`.

## Platform bindings

`env(cx)` returns the SDK's `worker::Env`. Use its typed methods for the bindings declared in Wrangler. Some SDK futures do not implement `Send`; wrap the operation with the SDK's `SendFuture` when necessary:

```rust
use topcoat::{Result, context::Cx};
use worker::send::SendFuture;

async fn load_message(cx: &Cx) -> Result<Option<String>> {
    let kv = topcoat_cloudflare::env(cx).kv("MESSAGES")?;
    Ok(SendFuture::new(kv.get("welcome").text()).await?)
}
```

The adapter injects the environment and execution context into each `Router::handle_with` call. These values survive Topcoat's HTTP page reruns. They are not stored in process-wide mutable state.

Use `execution_context(cx).wait_until(future)` for bounded work that may complete after the HTTP response. A deployment platform's invocation lifecycle is not a durable job queue; use the appropriate Cloudflare service when work must survive restarts.

The same `SendFuture` boundary applies to reqwest's Wasm client. Wrap the whole operation, including reading the response body, so a non-`Send` response does not remain live across an outer await:

```rust
let data = SendFuture::new(async move {
    reqwest::get(url).await?.json::<ApiResponse>().await
}).await?;
```

The quiz application exercises this path with a real Worker subrequest to a controlled HTTP endpoint.

`cf(cx)` may be absent in local development. `abort_signal(cx)` exposes the SDK's incoming request signal. Configure application client-IP handling for your actual ingress; the adapter does not invent a native peer socket address or trust arbitrary forwarded headers.

## Cookies and sessions

Use Topcoat's normal `.cookies()` and `.sessions(SessionConfig::default())` setup. Repeated `Set-Cookie` headers are preserved. The adapter enables the `time` crate's Wasm clock so cookie removal can calculate its expiration on Workers.

Topcoat generates tokens and manages their transport. Your application still stores token hashes and expiry, associates sessions with users, checks expiration and revocation, and persists rotation. The adapter does not choose a session database. The fixture tests the token lifecycle; its diagnostic endpoints are not a production authentication system.

Cookie changes must happen before a streaming response commits its headers, just as in native Topcoat. Use HTTPS for production session cookies.

## Streaming and timers

Topcoat response bodies stay incremental across the Worker bridge. Use the adapter timer in `live!` bodies:

```rust
topcoat_cloudflare::sleep(std::time::Duration::from_millis(250)).await?;
```

It uses Workers' scheduler, follows the future's current waker, and cancels its timer when dropped. The pinned SDK's `worker::Delay` exposed a stalled-render case during integration testing, so it is not used here.

The required `enable_request_signal` flag lets the adapter drop a suspended response body when the platform reports a disconnect. The adapter removes its event listener when the body is dropped. Application-owned detached work and remote service operations need their own cancellation policy.

Compression and intermediary buffering can coalesce small HTML chunks. The incremental transport test requests identity encoding; the browser test independently verifies that Topcoat applies the streamed update to the DOM.

## Static files

Continue using Topcoat's `asset!` declarations. Its native bundler scans the raw Wasm artifact and generates the catalog and content-hashed files. The adapter generates `_headers` entries that preserve content types and enable immutable caching. Assets with a common extension and content type share one rule; conflicting types retain individual rules. The build rejects output exceeding Cloudflare's [100-rule or 2,000-character line limits](https://developers.cloudflare.com/workers/static-assets/headers/), including custom rules, before deployment.

Files in the application's `public` directory are also copied and served at their exact paths for GET and HEAD. Public files are publicly accessible and take precedence at those exact paths. Keep authenticated downloads in Topcoat routes. Dotfiles are omitted, symlinks are rejected, and `public/_topcoat` is reserved.

Custom `public/_headers` rules are retained before the generated asset rules. Define redirects as Topcoat routes; `public/_redirects` is rejected because Worker-first routing would give it inconsistent application-wide behavior. The asset manifest and build metadata stay outside the public directory.

### Tailwind and Iconify

Topcoat 0.9's `tailwind` and `icon-iconify` facade features include native build tools. Enable them on the build dependency, then reference the generated stylesheet from application code:

```rust
topcoat::asset::asset!(concat!(env!("OUT_DIR"), "/tailwind.css"))
```

For Iconify, enable `icon` on the application's Topcoat dependency and add `topcoat-icon-macro = { version = "=0.9.0", features = ["iconify"] }`. Import `topcoat_icon_macro::iconify_icon` directly. The existing build script still stages the icon set; the downloader stays outside the Wasm dependency graph. The quiz and official UI showcase verify these combinations.

## Framework documentation

Topcoat's [API guide for agents](https://github.com/tokio-rs/topcoat/blob/96e8f9e0932ea883ced2859d462e9d6d3f52ea59/llms.txt) links to routing, components, signals, procedures, shards, cookies, and assets at the exact revision used here. Use those APIs normally; this guide covers only the Workers boundary.
