//! Topcoat's router, hosted by Cloudflare Workers.
//!
//! Define `fn router(assets: AssetConfig) -> Router`, then call
//! [`entrypoint!`](crate::entrypoint) to export the Worker. The companion CLI
//! supplies the asset catalog from the same build as the application.
//!
//! Platform bindings are request-scoped: use [`env()`] from a handler or component.
//! Use [`sleep`] for asynchronous timers in streamed views.

mod disconnect;
mod timer;

use std::sync::OnceLock;
use topcoat::{
    asset::{AssetConfig, Manifest},
    context::{Cx, request_context},
    router::{Body, Router, request::extensions},
};

pub use timer::sleep;

/// The reserved URL prefix for content-hashed Topcoat assets.
pub const ASSET_PREFIX: &str = "/_topcoat/assets";

/// An application router initialized once per Wasm instance.
///
/// Initialization does not perform I/O. Bindings belong to each call to
/// [`fetch`](Self::fetch), never to this shared value.
pub struct Application {
    factory: fn(AssetConfig) -> Router,
    router: OnceLock<Router>,
}

impl Application {
    /// Creates an application from its router factory.
    pub const fn new(factory: fn(AssetConfig) -> Router) -> Self {
        Self {
            factory,
            router: OnceLock::new(),
        }
    }

    /// Loads the build's asset catalog. Repeated calls are harmless.
    ///
    /// The generated entrypoint calls this before every request, so a new
    /// Wasm instance can initialize after SDK recovery from a previous trap.
    pub fn initialize(&self, manifest: &str) -> Result<(), String> {
        if self.router.get().is_none() {
            let manifest = Manifest::parse(manifest).map_err(|error| error.to_string())?;
            let router = (self.factory)(AssetConfig::hosted_at(ASSET_PREFIX, manifest));
            let _ = self.router.set(router);
        }
        Ok(())
    }

    /// Dispatches a Worker request without buffering either HTTP body.
    pub async fn fetch(
        &self,
        request: worker::HttpRequest,
        env: worker::Env,
        context: worker::Context,
    ) -> worker::Result<http::Response<Body>> {
        if requests_connected_render(request.headers()) {
            return Ok(http::Response::builder()
                .status(http::StatusCode::NOT_IMPLEMENTED)
                .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .header(http::header::CACHE_CONTROL, "no-store")
                .body(Body::from(
                    "Topcoat connected rendering is not supported by this adapter.",
                ))?);
        }
        let router = self.router.get().ok_or_else(|| worker::Error::RustError(
            "Topcoat is not initialized. Build and run the generated entry.js with topcoat-cloudflare.".into()
        ))?;
        let head = request.method() == http::Method::HEAD;
        let signal = request.extensions().get::<worker::AbortSignal>().cloned();
        let mut response = router
            .handle_with(request.map(Body::new), (env, context))
            .await;
        // Fetch rejects bodies for null-body statuses. Also drop the body of a
        // HEAD response, including any suspended render that would produce it.
        if head || null_body_status(response.status()) {
            *response.body_mut() = Body::empty();
        } else if let Some(signal) = signal {
            let body = std::mem::take(response.body_mut());
            *response.body_mut() = disconnect::wrap(body, signal)?;
        }
        Ok(response)
    }
}

fn null_body_status(status: http::StatusCode) -> bool {
    matches!(
        status,
        http::StatusCode::SWITCHING_PROTOCOLS
            | http::StatusCode::NO_CONTENT
            | http::StatusCode::RESET_CONTENT
            | http::StatusCode::NOT_MODIFIED
    )
}

fn requests_connected_render(headers: &http::HeaderMap) -> bool {
    headers
        .get_all(http::header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .any(|protocol| protocol.trim() == "topcoat-runtime")
}

/// Returns the current request's Cloudflare bindings and environment variables.
pub fn env(cx: &Cx) -> &worker::Env {
    request_context(cx)
}

/// Returns the current execution context, including `wait_until`.
pub fn execution_context(cx: &Cx) -> &worker::Context {
    request_context(cx)
}

/// Returns Cloudflare metadata when supplied by the ingress runtime.
pub fn cf(cx: &Cx) -> Option<&worker::Cf> {
    extensions(cx).get()
}

/// Returns the request's abort signal when supplied by the SDK.
pub fn abort_signal(cx: &Cx) -> Option<&worker::AbortSignal> {
    extensions(cx).get()
}

/// Exports a Worker for a function with signature `fn(AssetConfig) -> Router`.
///
/// The application must depend on `worker` with its `http` feature and on
/// `wasm-bindgen`, because their procedural macros generate its exports.
/// The companion CLI generates the JS entrypoint that initializes the catalog.
#[macro_export]
macro_rules! entrypoint {
    ($router:path) => {
        static TOPCOAT_APPLICATION: $crate::Application = $crate::Application::new($router);

        #[wasm_bindgen::prelude::wasm_bindgen]
        pub fn topcoat_cloudflare_init(
            __topcoat_manifest: &str,
        ) -> std::result::Result<(), wasm_bindgen::JsValue> {
            TOPCOAT_APPLICATION
                .initialize(__topcoat_manifest)
                .map_err(|__topcoat_init_error| {
                    wasm_bindgen::JsValue::from_str(&__topcoat_init_error)
                })
        }

        #[worker::event(fetch)]
        async fn fetch(
            __topcoat_request: worker::HttpRequest,
            __topcoat_env: worker::Env,
            __topcoat_context: worker::Context,
        ) -> worker::Result<$crate::__private::Response> {
            TOPCOAT_APPLICATION
                .fetch(__topcoat_request, __topcoat_env, __topcoat_context)
                .await
        }
    };
}

#[doc(hidden)]
pub mod __private {
    pub type Response = http::Response<topcoat::router::Body>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use topcoat::asset::RouterBuilderAssetExt;

    fn router(assets: AssetConfig) -> Router {
        Router::builder().assets(assets).build()
    }

    #[test]
    fn invalid_catalog_does_not_poison_initialization() {
        let app = Application::new(router);
        assert!(app.initialize("version = 999\nassets = []").is_err());
        assert!(app.initialize("version = 1\nassets = []").is_ok());
        assert!(app.initialize("already initialized").is_ok());
    }

    #[test]
    fn connected_protocol_is_recognized_among_other_protocols() {
        let mut headers = http::HeaderMap::new();
        headers.append("sec-websocket-protocol", "other".parse().unwrap());
        headers.append(
            "sec-websocket-protocol",
            "another, topcoat-runtime".parse().unwrap(),
        );
        assert!(requests_connected_render(&headers));
        headers.remove("sec-websocket-protocol");
        assert!(!requests_connected_render(&headers));
    }
}
