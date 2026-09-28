// The SDK generates this module for each application; this is the bridge contract we use.
declare module '*worker/index.js' {
  export default class RustWorker {
    env: { ASSETS: { fetch(request: Request): Promise<Response> } };
    topcoat_cloudflare_init(manifest: string): void;
    fetch(request: Request): Promise<Response>;
  }
}
declare module '*.txt' {
  const text: string;
  export default text;
}
