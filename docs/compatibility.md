# Compatibility

Topcoat HTTP applications run in Workers. Native database clients, filesystem access, listeners, processes, and threads need Workers-compatible replacements.

## Tested versions

| Component                 | Version                                                      |
| ------------------------- | ------------------------------------------------------------ |
| Topcoat                   | 0.9.0                                                        |
| Rust                      | 1.98.1, `wasm32-unknown-unknown`                             |
| `worker` / `worker-build` | 0.8.7                                                        |
| Wrangler                  | 4.142.0                                                      |
| Compatibility date        | 2026-09-27                                                   |
| Node.js                   | Full suite: 26.10.0; consumer installation: 22.23.3, 24.21.0 |

Tests run on Linux. Other tool versions are pinned in [package-lock.json](../package-lock.json) and [Cargo.lock](../Cargo.lock).

## Feature matrix

| Status          | Features                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Tested          | SSR, routes, redirects, errors, procedures, shards, signals, browser events, progressive HTML         |
| Tested          | Cookies and session tokens; text, JSON, binary, streamed bodies, multipart uploads                    |
| Tested locally  | KV, D1, R2, variables, `wait_until`, disconnect cleanup, recovery after a panic                       |
| Tested          | Static/public assets, Tailwind, self-hosted fonts, staged Iconify icons                               |
| Unsupported     | Persistent `connected(cx)` rendering, Topcoat's native WebSocket server, built-in Tokio SSE keepalive |
| Not yet covered | Hyperdrive, Queues, Durable Objects, other SDK bindings, third-party authentication                   |

Browser interactions use JavaScript, without browser Wasm. Session storage and revocation remain application responsibilities. A Wasm panic can affect concurrent requests sharing an instance; only subsequent-request recovery is tested.

For binding access, assets, and timers, see [integration](integration.md).

## Real application coverage

These checks use published adapter 0.1.0 in local workerd. Runnable apps have been ported; they are not unchanged native applications. [Source revisions and licenses](../tests/sites/sources.ts) are pinned.

| ID / project                                                                                           | Result             | Main adaptation or blocker                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------- |
| `showcase` — [UI](../examples/ui/README.md)                                                            | Pass               | Worker entrypoint and build-time assets                                      |
| `quiz` — [API](../examples/api/README.md)                                                              | Pass               | Wasm-compatible HTTP/randomness; browser-carried quiz state                  |
| `f4y` — [D1](../examples/d1/README.md)                                                                 | Pass, experimental | Pinned Toasty D1 prototype; conditional SQL writes                           |
| `coldfront` — [Cold Front](https://github.com/superposition/coldfront)                                 | Pass               | Topcoat 0.4 → 0.9 migration; Clerk authentication untested                   |
| `blocks` — [Topcoat Blocks](https://github.com/superposition/topcoat-blocks)                           | Build blocked      | Native HTTP/TLS dependencies                                                 |
| `gitcoat` — [GitCoat](https://github.com/Tryanks/GitCoat)                                              | Build blocked      | Native networking; filesystem and blocking tasks also need redesign          |
| `cangnu` / `mousuo` — [Cangnu](https://github.com/zzy/cangnu), [Mousuo](https://github.com/zzy/mousuo) | Build blocked      | Native Tokio networking, even with their required sibling framework checkout |

Build probes require the expected compiler diagnostic; unrelated failures do not count as confirmed blockers. See [test commands and measurements](benchmarks.md).

The [coffee-shop demo](../examples/starter/README.md) uses bundled menu data in place of SQLite. It does not prove database compatibility; the D1 example has separate storage tests.
