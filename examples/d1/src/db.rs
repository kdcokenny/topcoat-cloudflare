use crate::family::Family;
use jiff::Timestamp;
use topcoat::{Result, context::Cx};

pub async fn connect(cx: &Cx) -> Result<toasty::Db> {
    let binding = topcoat_cloudflare::env(cx).d1("DB")?;
    let driver = toasty_driver_d1::D1::new("DB", binding);
    Ok(toasty::Db::builder()
        .models(toasty::models!(crate::*))
        .build(driver)
        .await?)
}

impl Family {
    // D1 cannot use the prototype's interactive transaction for versioned updates.
    pub(crate) async fn persist(
        &mut self,
        db: &mut toasty::Db,
        name: String,
        summary: Option<String>,
        deleted_at: Option<Timestamp>,
    ) -> toasty::Result<()> {
        let updated_at = Timestamp::now();
        let changed = toasty::sql::statement(
            "UPDATE families SET name = ?1, summary = ?2, deleted_at = ?3, \
             version = version + 1, updated_at = ?4 WHERE id = ?5 AND version = ?6",
        )
        .bind(name.clone())
        .bind_typed(summary.clone(), toasty::schema::db::Type::Text)
        .bind_typed(
            deleted_at.map(|value| value.to_string()),
            toasty::schema::db::Type::Text,
        )
        .bind(updated_at.to_string())
        .bind(self.id)
        .bind(self.version)
        .exec(db)
        .await?;
        if changed != 1 {
            return Err(toasty::Error::condition_failed(
                "Family changed before the update",
            ));
        }
        self.name = name;
        self.summary = summary;
        self.deleted_at = deleted_at;
        self.updated_at = updated_at;
        self.version += 1;
        Ok(())
    }
}
