//! Propagate the platform's abort event even when its response stream is not canceled.
use http_body::{Body as HttpBody, Frame, SizeHint};
use std::{
    cell::RefCell,
    pin::Pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};
use topcoat::router::Body;
use wasm_bindgen::{JsCast, prelude::Closure};
use worker::{AbortSignal, send::SendWrapper};

struct State {
    body: Option<Body>,
    waker: Option<Waker>,
}

struct Listener {
    signal: AbortSignal,
    callback: Closure<dyn FnMut()>,
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = self
            .signal
            .remove_event_listener_with_callback("abort", self.callback.as_ref().unchecked_ref());
    }
}

pub(crate) fn wrap(body: Body, signal: AbortSignal) -> worker::Result<Body> {
    if signal.aborted() {
        return Ok(Body::empty());
    }
    if body.is_end_stream() {
        return Ok(body);
    }
    let state = Rc::new(RefCell::new(State {
        body: Some(body),
        waker: None,
    }));
    let weak = Rc::downgrade(&state);
    let callback = Closure::wrap_assert_unwind_safe(Box::new(move || {
        if let Some(state) = weak.upgrade() {
            let (body, waker) = {
                let mut state = state.borrow_mut();
                (state.body.take(), state.waker.take())
            };
            // Release the borrow before dropping application futures, whose
            // destructors may themselves interact with the JS host.
            drop(body);
            if let Some(waker) = waker {
                waker.wake();
            }
        }
    }) as Box<dyn FnMut()>);
    signal.add_event_listener_with_callback("abort", callback.as_ref().unchecked_ref())?;
    Ok(Body::new(DisconnectBody {
        state: SendWrapper::new(state),
        _listener: SendWrapper::new(Listener { signal, callback }),
    }))
}

// The SDK SendWrapper keeps JS values on their originating thread.
struct DisconnectBody {
    state: SendWrapper<Rc<RefCell<State>>>,
    _listener: SendWrapper<Listener>,
}

impl HttpBody for DisconnectBody {
    type Data = <Body as HttpBody>::Data;
    type Error = <Body as HttpBody>::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        let mut state = self.state.borrow_mut();
        state.waker = Some(cx.waker().clone());
        let Some(body) = state.body.as_mut() else {
            return Poll::Ready(None);
        };
        let result = Pin::new(body).poll_frame(cx);
        if matches!(result, Poll::Ready(None)) {
            state.body = None;
            state.waker = None;
        }
        result
    }

    fn is_end_stream(&self) -> bool {
        self.state
            .borrow()
            .body
            .as_ref()
            .is_none_or(HttpBody::is_end_stream)
    }

    fn size_hint(&self) -> SizeHint {
        self.state
            .borrow()
            .body
            .as_ref()
            .map_or_else(|| SizeHint::with_exact(0), HttpBody::size_hint)
    }
}
