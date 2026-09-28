use topcoat::{
    Result,
    font::fontsource::fontsource_font,
    router::{Slot, layout, page},
    view::{View, view},
};

mod families;

/// The root document. Every page in this module is rendered inside it.
#[layout("/")]
async fn document(slot: Slot<'_>) -> Result<impl View> {
    Ok(view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>"Families"</title>
                topcoat::font::link(font: fontsource_font!(GEIST))
                <link rel="stylesheet" href=(topcoat::asset::asset!(concat!(env!("OUT_DIR"), "/tailwind.css")))>
                topcoat::dev::script()
                topcoat::runtime::script()
            </head>
            <body>
                (slot)
            </body>
        </html>
    })
}

#[page("/")]
async fn home() -> Result<()> {
    Err(topcoat::router::error::see_other("/families").into())
}
