// Stop only this deployment's dynamic containers; do not open its databases.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
if (!process.env.OPENDOTS_DATA_DIR) throw new Error('OPENDOTS_DATA_DIR is required.');
const root = resolve(process.env.OPENDOTS_DATA_DIR);
const ids = new Set();
for (const label of ['opendots.desktop.owner', 'opendots.workspaces']) {
  const { stdout } = await exec('docker', ['ps', '-q', '--filter', `label=${label}`]);
  for (const id of stdout.trim().split(/\s+/).filter(Boolean)) ids.add(id);
}
for (const id of ids) {
  const { stdout } = await exec('docker', ['inspect', '--format', '{{json .Config.Labels}}', id]);
  const labels = JSON.parse(stdout), workspace = labels['opendots.workspaces'];
  if (labels['opendots.desktop.owner']?.startsWith(`${root}:`) ||
      workspace === `${root}/workspaces` ||
      typeof workspace === 'string' && workspace.startsWith(`${root}/users/`) && workspace.endsWith('/workspaces')) {
    await exec('docker', ['stop', '--time', '10', id], { timeout: 30_000 });
    console.log(`Stopped computer ${id}.`);
  }
}
