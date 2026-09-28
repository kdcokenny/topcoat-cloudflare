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

mod actions;
mod deleted;
mod form;
mod navigation;
mod row_actions;

use navigation::FamilyPageNavigation;
use row_actions::row_actions as family_row_actions;

#[query_params(error = bad_request)]
struct FamiliesQuery {
    after: Option<i64>,
    before: Option<i64>,
}

#[page("/families")]
async fn index(cx: &Cx) -> Result<impl View> {
    let mut handle = crate::db::connect(cx).await?;
    let query = query_params::<FamiliesQuery>(cx)?;
    let families = match (query.after, query.before) {
        (Some(cursor_id), _) => Family::active_page_after(&mut handle, cursor_id).await?,
        (None, Some(cursor_id)) => Family::active_page_before(&mut handle, cursor_id).await?,
        (None, None) => Family::first_active_page(&mut handle).await?,
    };
    let previous_url = families.previous_url();
    let next_url = families.next_url();

    Ok(view! {
        <main class="mx-auto flex max-w-5xl flex-col gap-6 p-8">
            card(
                card_header(
                    card_title("Families")
                    card_description("CRUD built with Topcoat 0.9, Toasty and D1.")
                )
                card_content(
                    <div class="mb-5 flex flex-wrap gap-3">
                        <a
                            href="/families/new"
                            class=(button_variants(ButtonVariant::Primary, ButtonSize::Md))
                        >
                            "Create family"
                        </a>
                        <a
                            href="/families/deleted"
                            class=(button_variants(ButtonVariant::Outline, ButtonSize::Md))
                        >
                            "Deleted families"
                        </a>
                    </div>
                    rows(
                        families: families,
                    )
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
async fn rows(families: toasty::stmt::Page<Family>) -> Result<impl View> {
    Ok(view! {
        if families.is_empty() {
            <p class="py-6 text-center text-sm text-muted-foreground">
                "No families yet."
            </p>
        } else {
            table(
                table_header(
                    table_row(
                        table_head("ID")
                        table_head("Name")
                        table_head("Summary")
                        table_head("Version")
                        table_head("Actions")
                    )
                )
                table_body(
                    for family in families.items {
                        table_row(
                            table_cell((family.id))
                            table_cell((family.name))
                            // An absent summary is marked rather than left
                            // blank, so it does not read as a rendering bug.
                            table_cell(
                                if let Some(text) = family.summary {
                                    (text)
                                } else {
                                    <span class="text-muted-foreground">"—"</span>
                                }
                            )
                            table_cell((family.version))
                            table_cell(family_row_actions(family_id: family.id, version: family.version))
                        )
                    }
                )
            )
        }
    })
}
