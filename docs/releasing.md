# Releasing the adapter

The release unit is a Rust runtime crate plus an npm build integration package. The npm package includes Worker templates, generated version metadata, and the native asset packager's normalized Cargo manifest, lockfile, and source. Consumers compile that tool once into their own Cargo target directory. Examples, fixtures, and repository tooling are not installed in their applications.

## Prepare and verify

After contributor setup:

```sh
npm run verify
```

This verifies the runtime and packages, then installs the release artifacts into an independent copy of the coffee-shop application. `npm run package` prepares artifacts without running the consumer test. Outputs are under `artifacts/release/`:

- `topcoat-cloudflare-<version>.crate`: verified Rust runtime package.
- `topcoat-cloudflare-adapter-<version>.tgz`: standalone npm package.
- `demo/`, `consumer.ts`, and `artifacts.json`: CI inputs, not published packages.

The consumer test installs the npm tarball and substitutes the extracted `.crate` through Cargo's registry patch mechanism. This tests the artifacts just built, regardless of which version is available in the registries. It checks setup, Wrangler development, a deployment dry run, pages, assets, and a procedure. CI downloads only these inputs without checking out the adapter repository.

Only the runtime crate is published to crates.io. The native build crate is carried inside npm so consumers do not manage a third package or manually locate a build executable.

## Configure publishing once

Both registries use GitHub Actions trusted publishing (OIDC). The release workflow requests temporary credentials; it needs no stored npm or crates.io publishing tokens.

The first version must be published manually before either registry accepts a trusted publisher:

1. Sign in with `npm login` and create or join the `topcoat-cloudflare` npm organization.
2. Create a temporary crates.io token with permission to publish the new `topcoat-cloudflare` crate. Supply it through `CARGO_REGISTRY_TOKEN`.
3. Publish the verified runtime with `cargo publish -p topcoat-cloudflare --locked`, then publish the npm tarball with `npm publish artifacts/release/topcoat-cloudflare-adapter-<version>.tgz --access public`.
4. Revoke the temporary crates.io token and remove it from the environment.
5. Add a GitHub Actions trusted publisher in each package's registry settings, using the values below.

| Setting           | Value                |
| ----------------- | -------------------- |
| Repository owner  | `kdcokenny`          |
| Repository        | `topcoat-cloudflare` |
| Workflow filename | `release.yml`        |
| Environment       | `release`            |

Create the `release` environment in the GitHub repository settings. On npm, allow the trusted publisher to publish directly. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [crates.io trusted publishing](https://crates.io/docs/trusted-publishing) for the registry setup.

## Publish a release

Update the workspace and npm package versions together, including the Rust dependency in the installation guide. Preparation rejects mismatched package versions. Generated toolchain metadata comes from the repository manifests; do not edit it by hand. Confirm that documentation links are accessible to package users.

Commit the release changes and create a version tag such as `v0.2.0`. In GitHub Actions, open **Release → Run workflow** and select that tag.

The workflow checks that the tag matches the package version, runs CI, publishes the Rust crate, and publishes the tested npm tarball. It then installs both packages from the public registries into an independent application and checks development, deployment packaging, pages, assets, and procedures. If a step fails after one package has been published, use **Re-run failed jobs** to continue without republishing the successful package.

For the same installation check after the initial manual release, run:

```sh
node tests/consumer.ts artifacts/release --registry
```

Keep the tested Rust, Topcoat, worker-build, and npm package combination in the release notes. The registry installation check confirms that the published packages are available and work together.

After publication, update the adapter dependencies and lockfiles in `examples/` and `tests/sites/locks/`, then run `npm run test:sites` against the published packages.
