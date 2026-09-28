use crate::components::pagination::{
    pagination, pagination_content, pagination_item, pagination_next, pagination_previous,
};
use topcoat::{
    Result,
    view::{View, attributes, component, view},
};

/// Cursor navigation for a paginated list.
///
/// The caller provides optional destinations for the previous and next pages.
#[component]
pub async fn cursor_pagination(
    previous_url: Option<String>,
    next_url: Option<String>,
) -> Result<impl View> {
    Ok(view! {
        if previous_url.is_some() || next_url.is_some() {
            pagination(
                pagination_content(
                    if let Some(url) = previous_url {
                        pagination_item(
                            pagination_previous(attrs: attributes! { href=(url) })
                        )
                    }
                    if let Some(url) = next_url {
                        pagination_item(
                            pagination_next(attrs: attributes! { href=(url) })
                        )
                    }
                )
            )
        }
    })
}
