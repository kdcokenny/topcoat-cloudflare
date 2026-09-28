CREATE TABLE IF NOT EXISTS "families" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "deleted_at" TEXT,
    "version" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);
-- #[toasty::breakpoint]
CREATE INDEX IF NOT EXISTS "index_families_by_deleted_at" ON "families" ("deleted_at");
