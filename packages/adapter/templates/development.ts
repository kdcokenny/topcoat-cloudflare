import Worker from './entry.ts';

// Wrangler's local proxy can fail the next request after an upload is canceled:
// https://github.com/cloudflare/workers-sdk/issues/15709
// Finish reading rejected uploads, as Wrangler's unused-body middleware does.
// This entrypoint is used only by local development, never by deployment.
export default class DevelopmentWorker extends Worker {
  async fetch(request: Request): Promise<Response> {
    if (!request.body) return super.fetch(request);

    const reader = request.body.getReader();
    let canceled = false;
    let draining: Promise<void> | undefined;
    let pulling: Promise<void> | undefined;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (canceled) return;
          pulling = (async () => {
            try {
              const { value, done } = await reader.read();
              if (canceled) return;
              if (done) {
                controller.close();
                reader.releaseLock();
              } else controller.enqueue(value);
            } catch (error) {
              if (!canceled) {
                controller.error(error);
                reader.releaseLock();
              }
            }
          })();
          return pulling;
        },
        cancel() {
          canceled = true;
          draining = (async () => {
            // A multipart parser can finish while one pull is still pending.
            // Settle that read before draining or releasing its reader.
            await pulling;
            while (!(await reader.read()).done) {}
          })().finally(() => reader.releaseLock());
          return draining;
        },
      },
      { highWaterMark: 0 },
    );

    try {
      return await super.fetch(new Request(request, { method: request.method, body }));
    } finally {
      if (draining) await draining;
    }
  }
}
