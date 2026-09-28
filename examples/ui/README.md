# UI showcase

Topcoat's official component showcase running on Cloudflare Workers.

## Run locally

Use Node.js and Rust with the [adapter prerequisites](../../packages/adapter/README.md#prerequisites). From this directory:

```sh
npm ci
npm run dev
```

Open the URL Wrangler prints. No Cloudflare account is needed.

| Try it                             | What it demonstrates   |
| ---------------------------------- | ---------------------- |
| Switch themes, tabs, or checkboxes | Browser signals        |
| Submit an empty project name       | Form validation        |
| Open a dialog, menu, or sheet      | Interactive components |
| Page through the commits table     | Server-rendered shards |

## Make it yours

Edit [src/app.rs](src/app.rs) for the demos, [src/components/](src/components/) for components, and [styles.css](styles.css) for the theme. [src/lib.rs](src/lib.rs) exports the Worker router; [build.rs](build.rs) prepares Tailwind and icons.

`npm run build` builds without deploying. `npx wrangler deploy` builds and deploys. For [automatic deployment](../../packages/adapter/README.md#automatic-deployment), use `examples/ui` as the root directory.

## Verify

From the repository root, run `npm run test:sites -- showcase`. For load measurements, use `npm run benchmark:sites -- showcase`. See [how the suite works and its results](../../docs/benchmarks.md).

## Source

Adapted from [Topcoat's official UI example at 132bdc6](https://github.com/tokio-rs/topcoat/tree/132bdc62f39b16fb13620cf4e3e6b4526d960211/examples/ui), under its included [MIT license](LICENSE).
