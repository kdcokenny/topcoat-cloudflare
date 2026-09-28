mod app;
mod components;
mod db;
mod family;

use topcoat::{
    asset::{AssetConfig, RouterBuilderAssetExt},
    router::RouterBuilderDiscoverExt,
    runtime::RouterBuilderRuntimeExt,
};

fn router(assets: AssetConfig) -> topcoat::router::Router {
    topcoat::router::module_router!()
        .discover()
        .assets(assets)
        .runtime()
        .build()
}

topcoat_cloudflare::entrypoint!(router);
