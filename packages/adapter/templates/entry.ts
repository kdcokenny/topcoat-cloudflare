import RustWorker from './worker/index.js';
import manifest from './asset-manifest.txt';

const publicFiles = new Set<string>(/* PUBLIC_FILES */ []);

export default class TopcoatWorker extends RustWorker {
  fetch(request: Request): Promise<Response> {
    if (request.method === 'GET' || request.method === 'HEAD') {
      let path;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {}
      if (path && publicFiles.has(path)) return this.env.ASSETS.fetch(request);
    }
    this.topcoat_cloudflare_init(manifest);
    return super.fetch(request);
  }
}
