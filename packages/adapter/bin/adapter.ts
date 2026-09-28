#!/usr/bin/env node
import { build } from '../src/build.ts';
import { init } from '../src/init.ts';
import { readRelease } from '../src/project.ts';
import { errorMessage } from '../src/errors.ts';

const [command, ...args] = process.argv.slice(2);
const usage = `Topcoat Cloudflare adapter

  topcoat-cloudflare setup    Configure this application (run once)
  topcoat-cloudflare build    Build the Worker and assets (called by Wrangler)

Use wrangler dev and wrangler deploy to run your application.
`;
const controller = new AbortController();
const stop = () => controller.abort();
// npm and Wrangler can both forward a signal while the build lock is being released.
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  if (!command || command === '--help' || command === '-h') console.log(usage);
  else if (args.length)
    throw new Error('This command takes no arguments. Run it in your application directory.');
  else if (command === 'setup') {
    const release = await readRelease();
    await init(process.cwd(), release);
    console.log(
      'Configured. Run npm install, add the Rust entrypoint from the adapter guide, then run npx wrangler dev.',
    );
  } else if (command === 'build') {
    await build({ cwd: process.cwd(), signal: controller.signal });
  } else throw new Error(`Unknown command: ${command}.\n${usage}`);
} catch (error) {
  if (!controller.signal.aborted) console.error(`topcoat-cloudflare: ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
