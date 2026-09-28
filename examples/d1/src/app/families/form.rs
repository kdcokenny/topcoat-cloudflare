use crate::{
    components::{
        button::button,
        card::{card, card_content, card_description, card_header, card_title},
        field::{field, field_group, field_label},
        input::input,
        textarea::textarea,
    },
    family::Family,
};
use serde::Deserialize;
use topcoat::{
    Result,
    context::Cx,
    router::{error::not_found, page, path_param, query_params},
    view::{View, attributes, component, view},
};

path_param!(family_id: i64, error = not_found);

#[query_params(error = bad_request)]
struct EditQuery {
    conflict: Option<bool>,
}

#[derive(Deserialize)]
pub(super) struct CreateFamilyInput {
    pub name: String,
    pub summary: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct UpdateFamilyInput {
    pub name: String,
    pub summary: Option<String>,
    pub version: u64,
}

#[derive(Deserialize)]
pub(super) struct VersionInput {
    pub version: u64,
}

#[page("/families/new")]
async fn new_family() -> Result<impl View> {
    Ok(view! {
        <main class="mx-auto max-w-2xl p-8">
            family_form(
                action: "/families".to_owned(),
                submit_label: "Create family",
                family: None,
                conflict: false,
            )
        </main>
    })
}

#[page("/families/{family_id}/edit")]
async fn edit_family(cx: &Cx) -> Result<impl View> {
    let family_id = path_param::<FamilyId>(cx)?;
    let query = query_params::<EditQuery>(cx)?;
    let mut db = crate::db::connect(cx).await?;
    let Some(family) = Family::find_active(&mut db, *family_id).await? else {
        return Err(not_found().into());
    };

    Ok(view! {
        <main class="mx-auto max-w-2xl p-8">
            family_form(
                action: format!("/families/{}", family.id),
                submit_label: "Save changes",
                family: Some(family),
                conflict: query.conflict.unwrap_or(false),
            )
        </main>
    })
}

#[component]
pub(super) async fn family_form(
    action: String,
    submit_label: &'static str,
    family: Option<Family>,
    conflict: bool,
) -> Result<impl View> {
    let title = if family.is_some() {
        "Edit family"
    } else {
        "Create family"
    };
    let name = family
        .as_ref()
        .map(|family| family.name.clone())
        .unwrap_or_default();
    let summary = family
        .as_ref()
        .and_then(|family| family.summary.clone())
        .unwrap_or_default();
    let version = family.as_ref().map(|family| family.version);

    Ok(view! {
        card(
            card_header(
                card_title((title))
                card_description("Manage the family name and optional summary.")
            )
            card_content(
                if conflict {
                    <div role="alert" class="mb-5 rounded-lg border border-destructive p-3 text-sm text-destructive">
                        "This family changed after you opened the form. The latest values are shown; review them before saving."
                    </div>
                }
                <form method="post" action=(action) class="flex flex-col gap-5">
                    field_group(
                        field(
                            field_label(attrs: attributes! { for="name" }, "Name")
                            input(attrs: attributes! {
                                id="name"
                                name="name"
                                type="text"
                                value=(name)
                                required=""
                                autocomplete="off"
                            })
                        )
                        field(
                            field_label(attrs: attributes! { for="summary" }, "Summary")
                            textarea(
                                attrs: attributes! {
                                    id="summary"
                                    name="summary"
                                    rows="4"
                                    placeholder="Optional summary"
                                },
                                (summary)
                            )
                        )
                    )
                    if let Some(version) = version {
                        <input type="hidden" name="version" value=(version)>
                    }
                    <div class="flex items-center gap-3">
                        button(attrs: attributes! { type="submit" }, (submit_label))
                        <a href="/families" class="cursor-pointer text-sm text-muted-foreground underline underline-offset-4">
                            "Cancel"
                        </a>
                    </div>
                </form>
            )
        )
    })
}
