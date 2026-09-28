use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{content::Json, route},
    session,
};

fn hex(hash: &session::TokenHash) -> String {
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[route(POST "/session/start")]
async fn start(cx: &Cx) -> Result<Json<Value>> {
    let session = session::start(cx).await?;
    let current_hash = session::token_hash(cx).await?.map(|hash| hex(&hash));
    Ok(Json(
        json!({"hash":hex(&session.token_hash),"current":current_hash,"expires":session.expires_at.duration_since(web_time::UNIX_EPOCH)?.as_secs()}),
    ))
}

#[route(GET "/session")]
async fn current(cx: &Cx) -> Result<Json<Value>> {
    Ok(Json(json!(
        session::token_hash(cx).await?.map(|hash| hex(&hash))
    )))
}

#[route(POST "/session/rotate")]
async fn rotate(cx: &Cx) -> Result<Json<Value>> {
    Ok(Json(json!(session::rotate(cx).await?.map(
        |rotation| json!({"old":hex(&rotation.revoked),"new":hex(&rotation.session.token_hash)})
    ))))
}

#[route(POST "/session/refresh")]
async fn refresh(cx: &Cx) -> Result<Json<Value>> {
    Ok(Json(json!(
        session::refresh(cx)
            .await?
            .map(|session| hex(&session.token_hash))
    )))
}

#[route(POST "/session/stop")]
async fn stop(cx: &Cx) -> Result<Json<Value>> {
    let previous = session::stop(cx).await?.map(|hash| hex(&hash));
    Ok(Json(
        json!({"previous":previous,"current":session::token_hash(cx).await?.map(|hash| hex(&hash))}),
    ))
}
