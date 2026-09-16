import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const taskDirectory = join(root, 'backlog', 'tasks');
const runtimeSource = join(root, 'apps', 'local-runtime', 'src');

const checks = [];

async function main() {
  const state = JSON.parse(await readFile(join(root, '.project', 'state.json'), 'utf8'));
  record('canonical milestone is M4 or later', /^M(?:[4-9]|[1-9]\d+)$/.test(String(state.milestone)), `current=${state.milestone}`);

  const taskNames = await readdir(taskDirectory);
  const vid12Name = taskNames.find((name) => name.toLowerCase().startsWith('vid-12 '));
  if (!vid12Name) throw new Error('VID-12 task file is missing');
  const vid12 = await readFile(join(taskDirectory, vid12Name), 'utf8');
  const youtubeLiveVerified = /^- \[x\] #3 /m.test(vid12);
  const secondProviderGateRecorded = /^- \[x\] #7 /m.test(vid12);
  record('YouTube live private upload/reconciliation is verified', youtubeLiveVerified, youtubeLiveVerified ? 'VID-12 #3 complete' : 'VID-12 #3 pending');
  record('second-provider gate is explicitly satisfied', secondProviderGateRecorded, secondProviderGateRecorded ? 'VID-12 #7 complete' : 'VID-12 #7 pending');

  const runtimeFiles = await readdir(runtimeSource);
  const publisherFiles = runtimeFiles.filter((name) => name.endsWith('-publisher.ts'));
  const unexpectedProviders = publisherFiles.filter((name) => name !== 'youtube-publisher.ts');
  record('no unverified second publishing provider is present', unexpectedProviders.length === 0, unexpectedProviders.length ? unexpectedProviders.join(', ') : 'youtube only');

  await mustExist('docs/operations/backup-restore.md');
  await mustExist('docs/operations/launch-readiness.md');
  record('launch and recovery runbooks are present', true, 'repository docs found');

  const ready = checks.every((check) => check.ok);
  process.stdout.write(`${JSON.stringify({ ready, milestone: state.milestone, checks }, null, 2)}\n`);
  if (!ready) process.exitCode = 1;
}

async function mustExist(relativePath) {
  await access(join(root, relativePath));
}

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

main().catch((error) => {
  process.stderr.write(`launch check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
