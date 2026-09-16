import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const scanRoots = ['apps', 'services', 'packages'];
const sourcePattern = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
const violations = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && sourcePattern.test(entry.name)) files.push(full);
  }
  return files;
}

function topArea(file) {
  return relative(root, file).split(sep)[0];
}

function serviceName(file) {
  const parts = relative(root, file).split(sep);
  return parts[0] === 'services' ? parts[1] : null;
}

function checkImport(file, specifier) {
  const rel = relative(root, file);
  const area = topArea(file);

  if (area === 'packages' && (specifier.startsWith('../../services/') || specifier.startsWith('../../apps/') || specifier.includes('/services/') || specifier.includes('/apps/'))) {
    violations.push(`${rel}: packages must not import apps/services (${specifier})`);
  }

  if (area === 'services') {
    const currentService = serviceName(file);
    const match = specifier.match(/(?:^|\/)services\/([^/]+)/);
    if (match && match[1] !== currentService) {
      violations.push(`${rel}: services must not import another service implementation (${specifier})`);
    }
  }

  if (specifier.startsWith('@videoos/')) {
    const allowed = [
      '@videoos/contracts',
      '@videoos/event-fabric',
      '@videoos/job-queue',
      '@videoos/storage',
      '@videoos/identity',
      '@videoos/node-protocol'
    ];
    if (!allowed.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
      violations.push(`${rel}: unknown internal package boundary (${specifier})`);
    }
  }
}

for (const scanRoot of scanRoots) {
  for (const file of await walk(join(root, scanRoot))) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(importPattern)) checkImport(file, match[1]);
  }
}

if (violations.length) {
  console.error('Architecture boundary violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Architecture boundaries: OK');
