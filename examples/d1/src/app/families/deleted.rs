use super::navigation::FamilyPageNavigation;
use super::row_actions::restore_action;
use crate::{
    components::{
        button::{ButtonSize, ButtonVariant, button_variants},
        card::{card, card_content, card_description, card_header, card_title},
        cursor_pagination::cursor_pagination,
        table::{table, table_body, table_cell, table_head, table_header, table_row},
    },
    family::Family,
};
use topcoat::{
    Result,
    context::Cx,
    router::{page, query_params},
    view::{View, component, view},
};

const DELETED_AT_TIME_ZONE: &str = "Europe/Rome";

#[query_params(error = bad_request)]
struct DeletedFamiliesQuery {
    after: Option<i64>,
    before: Option<i64>,
    conflict: Option<bool>,
}

#[page("/families/deleted")]
async fn index(cx: &Cx) -> Result<impl View> {
    let mut db = crate::db::connect(cx).await?;
    let query = query_params::<DeletedFamiliesQuery>(cx)?;
    let families = match (query.after, query.before) {
        (Some(cursor_id), _) => Family::deleted_page_after(&mut db, cursor_id).await?,
        (None, Some(cursor_id)) => Family::deleted_page_before(&mut db, cursor_id).await?,
        (None, None) => Family::first_deleted_page(&mut db).await?,
    };
    let previous_url = families.previous_url();
    let next_url = families.next_url();

    Ok(view! {
        <main class="mx-auto flex max-w-5xl flex-col gap-6 p-8">
            card(
                card_header(
                    card_title("Deleted families")
                    card_description("Restore a family to make it active again.")
                )
                card_content(
                    <a
                        href="/families"
                        class=(button_variants(ButtonVariant::Outline, ButtonSize::Md))
                    >
                        "Back to families"
                    </a>
                    if query.conflict.unwrap_or(false) {
                        <div role="alert" class="my-4 rounded-lg border border-destructive p-3 text-sm text-destructive">
                            "This family changed before it could be restored. Review the latest deleted families and try again."
                        </div>
                    }
                    deleted_rows(families: families)
                    cursor_pagination(
                        previous_url: previous_url,
                        next_url: next_url,
                    )
                )
            )
        </main>
    })
}

#[component]
async fn deleted_rows(families: toasty::stmt::Page<Family>) -> Result<impl View> {
    Ok(view! {
        if families.is_empty() {
            <p class="py-6 text-center text-sm text-muted-foreground">
                "No deleted families."
            </p>
        } else {
            table(
                table_header(
                    table_row(
                        table_head("ID")
                        table_head("Name")
                        table_head("Summary")
                        table_head("Deleted at (Europe/Rome)")
                        table_head("Actions")
                    )
                )
                table_body(
                    for family in families.items {
                        deleted_family_row(family: family)
                    }
                )
            )
        }
    })
}

#[component]
async fn deleted_family_row(family: Family) -> Result<impl View> {
    let deleted_at = if let Some(timestamp) = family.deleted_at {
        let local_time = timestamp.in_tz(DELETED_AT_TIME_ZONE)?;
        Some((
            timestamp.to_string(),
            local_time.strftime("%b %d, %Y, %-I:%M %p").to_string(),
        ))
    } else {
        None
    };

    Ok(view! {
        table_row(
            table_cell((family.id))
            table_cell((family.name))
            table_cell(
                if let Some(summary) = family.summary {
                    (summary)
                } else {
                    <span class="text-muted-foreground">"—"</span>
                }
            )
            table_cell(
                if let Some((datetime, label)) = deleted_at {
                    <time datetime=(datetime)>(label)</time>
                } else {
                    <span class="text-muted-foreground">"—"</span>
                }
            )
            table_cell(restore_action(family_id: family.id, version: family.version))
        )
    })
}
