use crate::components::button::{ButtonSize, ButtonVariant, button_variants};
use topcoat::{
    self, Result,
    asset::{AssetConfig, RouterBuilderAssetExt},
    font::fontsource::fontsource_font,
    router::{Router, RouterBuilderDiscoverExt, Slot, layout, page},
    runtime::RouterBuilderRuntimeExt,
    view::{View, class, view},
};

pub fn router(assets: AssetConfig) -> topcoat::router::Router {
    Router::builder()
        .discover()
        .assets(assets)
        .runtime()
        .build()
}

#[page("/")]
async fn home() -> Result<impl View> {
    Ok(view! {
        <main class=(class!("flex flex-1 items-center justify-center px-4 py-12"))>
            <div
                class=(class!(
                    "flex w-full max-w-2xl flex-col items-center gap-6 text-center",
                ))
            >
                <h1 class=(class!("text-3xl font-semibold tracking-tight sm:text-4xl"))>
                    "Quiz"
                </h1>
                <a
                    href="/quiz"
                    class=(button_variants(ButtonVariant::Primary, ButtonSize::Lg))
                >
                    "Start new quiz"
                </a>
            </div>
        </main>
    })
}

#[layout("/")]
async fn root_layout(slot: Slot<'_>) -> Result<impl View> {
    Ok(view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>"Quiz"</title>
                <meta
                    name="description"
                    content="Test your knowledge with a short quiz."
                />
                topcoat::font::link(font: fontsource_font!(GEIST, host: Asset))
                <link rel="stylesheet" href=(topcoat::asset::asset!(concat!(env!("OUT_DIR"), "/tailwind.css")))>
                topcoat::runtime::script()
            </head>
            <body class=(class!("flex min-h-screen flex-col"))>(slot)</body>
        </html>
    })
}
