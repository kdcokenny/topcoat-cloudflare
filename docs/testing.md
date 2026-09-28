# Testing

After `npm ci`:

```sh
npx playwright install --with-deps chromium
npm run verify
```

Or set `PROBE_CHROMIUM=/path/to/chromium` to use an installed browser. Verification runs static checks, runtime/browser tests, consumer installation, deployment packaging, and the dependency audit. It does not deploy or require Cloudflare credentials.

## Choose a check

| Change                                       | Command                                   |
| -------------------------------------------- | ----------------------------------------- |
| Formatting, linting, types, Rust             | `npm run check`                           |
| Setup, configuration, build staging          | `npm run test:unit`                       |
| Runtime, bindings, HTTP, assets              | `npm run test:integration`                |
| Coffee-shop pages and interactions           | `npm run test:smoke`                      |
| Watching and build recovery                  | `npm run test:dev`                        |
| Package contents and standalone installation | `npm run test:consumer`                   |
| UI, API, and D1 examples                     | `npm run test:sites -- showcase quiz f4y` |

**Before `test:dev`, stop the starter's dev server.** The test temporarily edits its source files and restores them afterward.

Local tests use workerd and emulated bindings. Consumer tests install packed artifacts outside the checkout; CI also runs them on Node 22 and 24. See [benchmarks](benchmarks.md) for application workloads and load tests.

## Results

Reports go to `artifacts/`; browser failure traces go to `test-results/`. Find results for a commit in [CI](https://github.com/kdcokenny/topcoat-cloudflare/actions/workflows/ci.yml) or [Real applications](https://github.com/kdcokenny/topcoat-cloudflare/actions/workflows/sites.yml). Check each run's artifacts for logs and screenshots.

## Deployed checks

For a deployed coffee-shop demo:

```sh
TOPCOAT_SMOKE_URL=https://your-worker.example npm run test:smoke
```

For the full runtime suite, set `TOPCOAT_TEST_URL` to a disposable deployed fixture. It writes test data and triggers a panic. Two instance-local disconnect-counter tests skip remotely; verify cleanup through logs. Local binding emulation does not prove deployed consistency or latency.
