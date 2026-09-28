//! Integration fixture. These diagnostic endpoints are not an application template.
mod bindings;
mod sessions;

use serde_json::{Value, json};
use std::{
    sync::atomic::{AtomicU32, Ordering},
    time::Duration,
};
use topcoat::{
    Result,
    asset::{AssetConfig, RouterBuilderAssetExt, asset},
    context::Cx,
    cookie::{Cookies, RouterBuilderCookieExt, cookies},
    router::{
        Body, BodyLimit, Router, RouterBuilderDiscoverExt,
        content::{Json, multipart::Multipart},
        page,
        request::{headers, uri},
        response::Response,
        route,
    },
    runtime::{RouterBuilderRuntimeExt, procedure, shard, signal},
    session::{RouterBuilderSessionExt, SessionConfig},
    view::{View, emit, live, view},
};

topcoat_cloudflare::entrypoint!(router);

fn router(assets: AssetConfig) -> Router {
    Router::builder()
        .discover()
        .assets(assets)
        .cookies()
        .sessions(SessionConfig::default())
        .layer(BodyLimit::max(1024).at("/limited"))
        .runtime()
        .build()
}

#[page("/")]
async fn home(cx: &Cx) -> Result<impl View> {
    let count = signal(cx, || 1u32);
    let greeting = topcoat_cloudflare::env(cx).var("GREETING")?.to_string();
    Ok(view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <title>"Adapter test fixture"</title>
                <link rel="stylesheet" href=(asset!("../assets/site.css"))>
                <link rel="alternate" href=(asset!("../assets/custom.data", content_type: "application/x-topcoat-test"))>
                <link rel="alternate" href=(asset!("../assets/café@2x.data", content_type: "application/x-topcoat-unicode"))>
                topcoat::runtime::script()
            </head>
            <body>
                <h1>"Topcoat on Workers"</h1>
                <p id="greeting">(greeting)</p>
                <button id="increment" @click=$(|_event| count.increment())>"Increment"</button>
                <button id="double" @click=$(async |_event| count.set(double(count.get()).await))>"Double"</button>
                <p id="count">$(count.get())</p>
                results(query: $(count.get()))
            </body>
        </html>
    })
}

#[procedure("/api/double")]
async fn double(value: u32) -> Result<u32> {
    value
        .checked_mul(2)
        .ok_or_else(|| topcoat::Error::msg("overflow"))
}

#[shard("/api/results")]
async fn results(cx: &Cx, query: u32) -> Result<impl View> {
    let greeting = topcoat_cloudflare::env(cx).var("GREETING")?.to_string();
    Ok(view! { <p id="results" data-context=(greeting)>"Result: " (query)</p> })
}

#[route(GET "/health")]
async fn health() -> Result<&'static str> {
    Ok("ready")
}

#[route(GET "/request")]
async fn request(cx: &Cx) -> Result<Json<Value>> {
    let id = headers(cx)
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    topcoat_cloudflare::sleep(Duration::from_millis(15)).await?;
    Ok(Json(
        json!({ "id": id, "uri": uri(cx).to_string(), "greeting": topcoat_cloudflare::env(cx).var("GREETING")?.to_string(), "abortSignal": topcoat_cloudflare::abort_signal(cx).is_some() }),
    ))
}

#[route(POST "/echo")]
async fn echo(body: Body) -> Result<Body> {
    Ok(body)
}

#[route(POST "/limited")]
async fn limited(body: String) -> Result<String> {
    Ok(body)
}

#[route(POST "/json")]
async fn json_echo(Json(body): Json<Value>) -> Result<Json<Value>> {
    Ok(Json(body))
}

#[route(POST "/upload")]
async fn upload(mut multipart: Multipart) -> Result<Json<Value>> {
    let mut fields = Vec::new();
    while let Some(field) = multipart.next_field().await? {
        let name = field.name().map(str::to_owned);
        let filename = field.file_name().map(str::to_owned);
        let bytes = field.bytes().await?;
        fields.push(json!({"name":name,"filename":filename,"bytes":bytes.len(),"text":String::from_utf8_lossy(&bytes)}));
    }
    Ok(Json(json!(fields)))
}

#[route(GET "/cookies")]
async fn cookie_probe(cx: &Cx) -> Result<&'static str> {
    cookies(cx).add(("first", "one"));
    cookies(cx).add(("second", "two"));
    Ok("cookies set")
}

#[route(GET "/redirect")]
async fn redirect() -> Result<&'static str> {
    Err(topcoat::router::error::redirect("/").into())
}

#[route(GET "/empty")]
async fn empty() -> Result<Response> {
    Ok(Response::builder()
        .status(204)
        .body(Body::from("must be dropped"))?)
}

#[route(GET "/reset")]
async fn reset() -> Result<Response> {
    Ok(Response::builder()
        .status(205)
        .body(Body::from("must be dropped"))?)
}

#[route(GET "/not-modified")]
async fn not_modified() -> Result<Response> {
    Ok(Response::builder()
        .status(304)
        .header("etag", "fixture-v1")
        .body(Body::from("must be dropped"))?)
}

#[route(GET "/head")]
async fn head_get() -> Result<&'static str> {
    Ok("body")
}

#[route(HEAD "/head")]
async fn head() -> Result<Response> {
    Ok(Response::builder()
        .header("x-head", "preserved")
        .body(Body::from("must be dropped"))?)
}

#[route(GET "/error")]
async fn error() -> Result<&'static str> {
    Err(topcoat::Error::msg("fixture error: private diagnostic"))
}

#[route(GET "/panic")]
async fn panic_probe() -> Result<&'static str> {
    panic!("intentional integration-test panic")
}

#[page("/stream")]
async fn stream() -> Result<impl View> {
    Ok(view! {
        <!DOCTYPE html><html><head><title>"Streaming"</title></head><body>
        <h1>"Streaming"</h1>
        (live! {
            emit! { <p id="live-state">"Loading"</p> }?;
            topcoat_cloudflare::sleep(Duration::from_millis(500)).await?;
            emit! { <p id="live-state">"Finished"</p> }
        })
        </body></html>
    })
}

static ACTIVE_STREAMS: AtomicU32 = AtomicU32::new(0);
struct StreamGuard;
impl StreamGuard {
    fn new() -> Self {
        ACTIVE_STREAMS.fetch_add(1, Ordering::Relaxed);
        Self
    }
}
impl Drop for StreamGuard {
    fn drop(&mut self) {
        ACTIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
    }
}

#[page("/stream/open")]
async fn open_stream() -> Result<impl View> {
    Ok(live! {
        let _guard = StreamGuard::new();
        for index in 0..60u32 {
            emit! { <p>"tick " (index)</p> }?;
            topcoat_cloudflare::sleep(Duration::from_secs(1)).await?;
        }
        emit! { <p>"done"</p> }
    })
}

#[route(GET "/stream/active")]
async fn active_streams() -> Result<Json<Value>> {
    Ok(Json(json!(ACTIVE_STREAMS.load(Ordering::Relaxed))))
}
