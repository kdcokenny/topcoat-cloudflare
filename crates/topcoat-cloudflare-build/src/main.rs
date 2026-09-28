//! Called by the adapter build hook after worker-build preserves the raw Cargo artifact.
mod headers;

use std::{error::Error, fs, path::Path};
use topcoat_asset::{Bundler, BundlerConfig, Manifest};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 3 {
        return Err(
            "usage: topcoat-cloudflare-build <raw.wasm> <staging-directory> <cache-directory>"
                .into(),
        );
    }
    let binary = fs::read(&args[0])?;
    let stage = Path::new(&args[1]);
    let assets = stage.join("public/_topcoat/assets");
    let config = BundlerConfig::new().cache_dir(args[2].clone().into());
    Bundler::new(&config).bundle(&binary, &assets)?;
    let manifest_path = assets.join("manifest.toml");
    let manifest = Manifest::load(&manifest_path)?;
    let headers = headers::generate(
        manifest
            .assets
            .iter()
            .map(|entry| (entry.file.as_str(), entry.content_type.as_str())),
    )?;
    fs::write(stage.join("public/_headers"), headers)?;
    fs::rename(manifest_path, stage.join("asset-manifest.txt"))?;
    println!("Bundled {} Topcoat assets.", manifest.assets.len());
    Ok(())
}
