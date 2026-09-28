use crate::components::button::{ButtonSize, ButtonVariant, button, button_variants};
use topcoat::{
    Result,
    view::{View, attributes, component, view},
};

#[component]
pub(super) async fn row_actions(family_id: i64, version: u64) -> Result<impl View> {
    let edit_url = format!("/families/{family_id}/edit");
    let delete_url = format!("/families/{family_id}/delete");

    Ok(view! {
        <div class="flex items-center gap-2">
            <a
                href=(edit_url)
                class=(button_variants(ButtonVariant::Outline, ButtonSize::Sm))
            >
                "Edit"
            </a>
            version_action_form(
                action: delete_url,
                version: version,
                label: "Delete",
                variant: ButtonVariant::Destructive,
            )
        </div>
    })
}

#[component]
pub(super) async fn restore_action(family_id: i64, version: u64) -> Result<impl View> {
    Ok(view! {
        version_action_form(
            action: format!("/families/{family_id}/restore"),
            version: version,
            label: "Restore",
            variant: ButtonVariant::Outline,
        )
    })
}

#[component]
async fn version_action_form(
    action: String,
    version: u64,
    label: &'static str,
    variant: ButtonVariant,
) -> Result<impl View> {
    Ok(view! {
        <form method="post" action=(action)>
            <input type="hidden" name="version" value=(version)>
            button(
                variant: variant,
                size: ButtonSize::Sm,
                attrs: attributes! { type="submit" },
                (label)
            )
        </form>
    })
}
