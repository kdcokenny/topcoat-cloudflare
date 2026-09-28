use jiff::Timestamp;

/// Maximum number of active families returned in one page.
pub const ACTIVE_PAGE_SIZE: usize = 20;

/// A family record.
///
/// Soft deletes are represented by [`Family::deleted_at`]: a record is active
/// while that column is `None`, and restoring it only clears the column. The
/// row is never physically removed, so history stays inspectable.
#[derive(Debug, toasty::Model)]
pub struct Family {
    /// Surrogate primary key, assigned by the database.
    #[key]
    #[auto]
    pub id: i64,

    /// Display name. Not unique: duplicate names are allowed.
    pub name: String,

    /// Optional free-form description.
    pub summary: Option<String>,

    /// When the record was soft-deleted, or `None` while it is active.
    ///
    /// Indexed because every list query filters on it.
    #[index]
    pub deleted_at: Option<Timestamp>,

    /// Optimistic concurrency token.
    ///
    /// Starts at `1` and increments on every successful update. A
    /// stale write is rejected instead of silently overwriting, so a form must
    /// carry the version it was rendered with.
    #[version]
    pub version: u64,

    /// Set once, when the record is first inserted.
    #[auto]
    pub created_at: Timestamp,

    /// Refreshed on every create and update.
    #[auto]
    pub updated_at: Timestamp,
}

impl Family {
    /// Create a family. Toasty initializes its version and timestamps.
    pub async fn create_record(
        db: &mut toasty::Db,
        name: impl Into<String>,
        summary: Option<String>,
    ) -> toasty::Result<Self> {
        toasty::create!(Family {
            name: name.into(),
            summary,
        })
        .exec(db)
        .await
    }

    /// Find a family by ID unless it has been soft-deleted.
    pub async fn find_active(db: &mut toasty::Db, id: i64) -> toasty::Result<Option<Self>> {
        Self::filter_by_id(id)
            .filter(Self::fields().deleted_at().is_none())
            .first()
            .exec(db)
            .await
    }

    /// Find a soft-deleted family by ID so it can be restored.
    pub async fn find_deleted(db: &mut toasty::Db, id: i64) -> toasty::Result<Option<Self>> {
        Self::filter_by_id(id)
            .filter(Self::fields().deleted_at().is_some())
            .first()
            .exec(db)
            .await
    }

    /// Update editable fields, incrementing the optimistic-lock version.
    pub async fn update_details(
        &mut self,
        db: &mut toasty::Db,
        name: impl Into<String>,
        summary: Option<String>,
    ) -> toasty::Result<()> {
        self.persist(db, name.into(), summary, self.deleted_at)
            .await
    }

    /// Soft-delete the family while preserving the row for restoration.
    pub async fn soft_delete(&mut self, db: &mut toasty::Db) -> toasty::Result<()> {
        self.persist(
            db,
            self.name.clone(),
            self.summary.clone(),
            Some(Timestamp::now()),
        )
        .await
    }

    /// Restore a soft-deleted family.
    pub async fn restore(&mut self, db: &mut toasty::Db) -> toasty::Result<()> {
        self.persist(db, self.name.clone(), self.summary.clone(), None)
            .await
    }

    /// Fetch the first page of active families, newest first.
    ///
    /// Families are ordered by their auto-incrementing ID, which gives the
    /// cursor a unique and stable sort key. Active pages exclude soft-deleted
    /// records and contain at most [`ACTIVE_PAGE_SIZE`] rows.
    pub async fn first_active_page(
        db: &mut toasty::Db,
    ) -> toasty::Result<toasty::stmt::Page<Self>> {
        Self::filter(Self::fields().deleted_at().is_none())
            .order_by(Self::fields().id().desc())
            .paginate(ACTIVE_PAGE_SIZE)
            .exec(db)
            .await
    }

    /// Fetch the next active page after the family with `cursor_id`.
    pub async fn active_page_after(
        db: &mut toasty::Db,
        cursor_id: i64,
    ) -> toasty::Result<toasty::stmt::Page<Self>> {
        Self::filter(Self::fields().deleted_at().is_none())
            .order_by(Self::fields().id().desc())
            .paginate(ACTIVE_PAGE_SIZE)
            .after(cursor_id)
            .exec(db)
            .await
    }

    /// Fetch the previous active page before the family with `cursor_id`.
    pub async fn active_page_before(
        db: &mut toasty::Db,
        cursor_id: i64,
    ) -> toasty::Result<toasty::stmt::Page<Self>> {
        Self::filter(Self::fields().deleted_at().is_none())
            .order_by(Self::fields().id().desc())
            .paginate(ACTIVE_PAGE_SIZE)
            .before(cursor_id)
            .exec(db)
            .await
    }

    /// Fetch the first page of soft-deleted families, newest first.
    pub async fn first_deleted_page(
        db: &mut toasty::Db,
    ) -> toasty::Result<toasty::stmt::Page<Self>> {
        Self::filter(Self::fields().deleted_at().is_some())
            .order_by(Self::fields().id().desc())
            .paginate(ACTIVE_PAGE_SIZE)
            .exec(db)
            .await
    }

    /// Fetch the next deleted page after the family with `cursor_id`.
    pub async fn deleted_page_after(
        db: &mut toasty::Db,
        cursor_id: i64,
    ) -> toasty::Result<toasty::stmt::Page<Self>> {
        Self::filter(Self::fields().deleted_at().is_some())
            .order_by(Self::fields().id().desc())
            .paginate(ACTIVE_PAGE_SIZE)
            .after(cursor_id)
            .exec(db)
            .await
    }

    /// Fetch the previous deleted page before the family with `cursor_id`.
    pub async fn deleted_page_before(
        db: &mut toasty::Db,
        cursor_id: i64,
    ) -> toasty::Result<toasty::stmt::Page<Self>> {
        Self::filter(Self::fields().deleted_at().is_some())
            .order_by(Self::fields().id().desc())
            .paginate(ACTIVE_PAGE_SIZE)
            .before(cursor_id)
            .exec(db)
            .await
    }
}
