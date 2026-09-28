use std::{future::Future, time::Duration};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use worker::send::SendFuture;

// Keep the Promise owned by the Rust future so its waker can change as a view
// moves from the initial render into response-body polling. Abort on drop.
#[wasm_bindgen(inline_js = "
export class TopcoatTimer {
    constructor(ms) {
        this.controller = new AbortController();
        this.promise = scheduler.wait(ms, { signal: this.controller.signal });
        this.promise.catch(() => {});
    }
    cancel() { this.controller.abort(); }
}
")]
extern "C" {
    type TopcoatTimer;
    #[wasm_bindgen(constructor)]
    fn new(ms: u32) -> TopcoatTimer;
    #[wasm_bindgen(method, getter)]
    fn promise(this: &TopcoatTimer) -> js_sys::Promise;
    #[wasm_bindgen(method)]
    fn cancel(this: &TopcoatTimer);
}

struct TimerGuard(TopcoatTimer);
impl Drop for TimerGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

/// Waits using Workers' scheduler, including inside a streaming view.
///
/// Dropping the future cancels the underlying timer. Durations beyond the
/// scheduler's signed 32-bit millisecond range return an error.
pub fn sleep(duration: Duration) -> impl Future<Output = worker::Result<()>> + Send {
    SendFuture::new(async move {
        let milliseconds = u32::try_from(duration.as_millis())
            .ok()
            .filter(|value| *value <= i32::MAX as u32)
            .ok_or_else(|| {
                worker::Error::RustError("timer exceeds 2,147,483,647 milliseconds".into())
            })?;
        let timer = TimerGuard(TopcoatTimer::new(milliseconds));
        JsFuture::from(timer.0.promise())
            .await
            .map_err(worker::Error::from)?;
        Ok(())
    })
}
