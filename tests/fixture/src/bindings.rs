use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    router::{content::Json, request::headers, route},
};
use worker::send::SendFuture;

#[route(GET "/bindings")]
async fn bindings(cx: &Cx) -> Result<Json<Value>> {
    let env = topcoat_cloudflare::env(cx);
    let key = test_key(cx);
    SendFuture::new(async {
        let kv = env.kv("KV")?;
        kv.put(&key, "kv works")?.execute().await?;
        let kv_value = kv.get(&key).text().await?;
        let db = env.d1("DB")?;
        db.prepare(
            "CREATE TABLE IF NOT EXISTS adapter_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )
        .run()
        .await?;
        db.prepare("INSERT INTO adapter_probe (id, value) VALUES (?, 'd1 works')")
            .bind(&[key.clone().into()])?
            .run()
            .await?;
        let row: Option<Value> = db
            .prepare("SELECT value FROM adapter_probe WHERE id = ?")
            .bind(&[key.clone().into()])?
            .first(None)
            .await?;
        db.prepare("DELETE FROM adapter_probe WHERE id = ?")
            .bind(&[key.clone().into()])?
            .run()
            .await?;
        let bucket = env.bucket("BUCKET")?;
        bucket.put(&key, "r2 works".to_owned()).execute().await?;
        let object = bucket
            .get(&key)
            .execute()
            .await?
            .ok_or_else(|| worker::Error::RustError("R2 object missing".into()))?;
        let r2 = object
            .body()
            .ok_or_else(|| worker::Error::RustError("R2 body missing".into()))?
            .text()
            .await?;
        bucket.delete(&key).await?;
        kv.delete(&key).await?;
        Ok::<_, worker::Error>(Json(json!({"kv":kv_value,"d1":row,"r2":r2})))
    })
    .await
    .map_err(Into::into)
}

#[route(POST "/background")]
async fn background(cx: &Cx) -> Result<&'static str> {
    let kv = topcoat_cloudflare::env(cx).kv("KV")?;
    let key = test_key(cx);
    topcoat_cloudflare::execution_context(cx).wait_until(async move {
        let _ = topcoat_cloudflare::sleep(std::time::Duration::from_millis(100)).await;
        if let Ok(put) = kv.put(&key, "complete") {
            let _ = put.execute().await;
        }
    });
    Ok("scheduled")
}

#[route(GET "/background")]
async fn background_result(cx: &Cx) -> Result<Json<Value>> {
    let kv = topcoat_cloudflare::env(cx).kv("KV")?;
    let key = test_key(cx);
    let value = SendFuture::new(kv.get(&key).text()).await?;
    Ok(Json(json!(value)))
}

fn test_key(cx: &Cx) -> String {
    format!(
        "probe/{}",
        headers(cx)
            .get("x-test-id")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("manual")
    )
}
