# Topcoat on Cloudflare Workers

Deploy your Topcoat application to Cloudflare Workers. Rust runs as Wasm on the server; Topcoat generates ordinary browser JavaScript.

## Install in your application

Install the `topcoat-cloudflare` Rust crate and `@topcoat-cloudflare/adapter` npm package in your existing application.

1. Install the adapter and run `npx topcoat-cloudflare setup` in your app.
2. Add the Rust dependency and export your router through `entrypoint!`.
3. Use `npx wrangler dev` or `npx wrangler deploy`. Wrangler builds automatically.

[Installation guide](packages/adapter/README.md)

## What works

Server-rendered pages, browser signals, procedures, reactive shards, progressive HTML, cookies, and Workers bindings are covered by the runtime tests. Persistent `connected(cx)` rendering is unsupported. See the [compatibility matrix](docs/compatibility.md) for scope and limitations.

The official **Little Crema** coffee-shop demo exercises the adapter, including menu search, customer cookies, reactive prices, and order confirmations. [Try it →](https://topcoat.kdco.dev/) · [Demo source and adaptations →](examples/starter/README.md)

Additional runnable examples use the published adapter packages:

| Example                                      | Demonstrates                                                 |
| -------------------------------------------- | ------------------------------------------------------------ |
| [UI showcase](examples/ui/README.md)         | Components, themes, forms, dialogs, and server pagination    |
| [API-backed quiz](examples/api/README.md)    | Remote JSON, streaming, error recovery, and reactive shards  |
| [Experimental D1 app](examples/d1/README.md) | Persistent records, forms, pagination, and conflict handling |

Tests and benchmarks run isolated copies of these examples. Each guide includes setup, source attribution, and its test command.

## Learn more

- [Bindings, sessions, streaming, and assets](docs/integration.md)
- [Build output and deployment configuration](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Real application compatibility and benchmarks](docs/benchmarks.md)

To work on the adapter itself, see [CONTRIBUTING.md](CONTRIBUTING.md). Agents should start with [AGENTS.md](AGENTS.md).

Independent integration for [Topcoat](https://github.com/tokio-rs/topcoat) and [Cloudflare Workers](https://developers.cloudflare.com/workers/).
