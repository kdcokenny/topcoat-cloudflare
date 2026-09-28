# API-backed quiz

A five-question quiz demonstrating Worker API requests, streamed loading, error recovery, and reactive shards.

## Run locally

Use Node.js and Rust with the [adapter prerequisites](../../packages/adapter/README.md#prerequisites). From this directory:

```sh
npm ci
npm run dev
```

Open the URL Wrangler prints and choose **Start new quiz**. Questions come from [QuizzAPI](https://quizzapi.fr/) in French; the interface is in English. You need internet access, but no Cloudflare account or API key.

## How it works

| Step                | Behavior                                                 | Code                                                               |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Start               | Fetch and validate five questions; show loading or retry | [quiz/api.rs](src/quiz/api.rs), [quiz/model.rs](src/quiz/model.rs) |
| Select an answer    | Update a browser signal                                  | [quiz.rs](src/quiz.rs)                                             |
| Validate or advance | Render a shard using the existing questions              | [quiz.rs](src/quiz.rs)                                             |

Questions and progress travel with each shard request, so a quiz can continue on another Worker without fetching again. **Scores are browser-controlled:** this is a practice quiz. Trusted grading needs server-side storage and validation.

## Make it yours

Edit [src/app.rs](src/app.rs) for the home page and layout. To use another question service, change `QUIZ_API_URL` in [wrangler.jsonc](wrangler.jsonc) and adapt [quiz/api.rs](src/quiz/api.rs) and [quiz/model.rs](src/quiz/model.rs). The current request asks for five easy questions and times out after five seconds, including body reads.

`npm run build` builds without deploying. `npx wrangler deploy` builds and deploys. For [automatic deployment](../../packages/adapter/README.md#automatic-deployment), use `examples/api` as the root directory.

## Verify

From the repository root, run `npm run test:sites -- quiz`. For load measurements, use `npm run benchmark:sites -- quiz`. Both use a controlled local API; they send no traffic to QuizzAPI. See [workloads and results](../../docs/benchmarks.md).

## Source

Adapted from [AlexPiquard/topcoat-quiz at a31d817](https://github.com/AlexPiquard/topcoat-quiz/tree/a31d817e31d755aca4c9461b10f51244962aadee), under its included [GPL-3.0 license](LICENSE). This example retains that license separately from the MIT adapter.
