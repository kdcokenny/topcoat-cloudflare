import { run, rustTool } from '../packages/adapter/src/process.ts';
import { repository } from './project.ts';
import { join } from 'node:path';
import { wasmTarget } from '../packages/adapter/src/project.ts';

const cargo = await rustTool('cargo');
for (const example of ['api', 'd1', 'ui']) {
  await run(cargo, ['fmt', '--all', '--', '--check'], {
    cwd: join(repository, 'examples', example),
  });
}
const commands = [
  ['fmt', '--all', '--', '--check'],
  ['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'],
  [
    'clippy',
    '-p',
    'topcoat-cloudflare-starter',
    '-p',
    'topcoat-cloudflare-fixture',
    '--target',
    wasmTarget,
    '--locked',
    '--',
    '-D',
    'warnings',
  ],
  ['test', '-p', 'topcoat-cloudflare', '-p', 'topcoat-cloudflare-build', '--locked'],
  ['doc', '-p', 'topcoat-cloudflare', '--no-deps', '--locked'],
];
for (const args of commands) {
  await run(cargo, args, { cwd: repository, env: { RUSTDOCFLAGS: '-D warnings' } });
}
