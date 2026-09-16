import { readdir, readFile } from 'node:fs/promises';
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

function partsFor(file) {
  return relative(root, file).split(sep);
}

function topArea(file) {
  return partsFor(file)[0];
}

function serviceName(file) {
  const parts = partsFor(file);
  return parts[0] === 'services' ? parts[1] : null;
}

function isConcreteAdapterImport(specifier) {
  return specifier.startsWith('@videoos/adapter-')
    || specifier.includes('/packages/adapters/')
    || specifier.startsWith('../../packages/adapters/')
    || specifier.startsWith('../../../packages/adapters/');
}

function checkImport(file, specifier) {
  const rel = relative(root, file);
  const area = topArea(file);

  if (area === 'packages' && (specifier.startsWith('../../services/') || specifier.startsWith('../../apps/') || specifier.includes('/services/') || specifier.includes('/apps/'))) {
    violations.push(`${rel}: packages must not import apps/services (${specifier})`);
  }

  if (area !== 'apps' && isConcreteAdapterImport(specifier)) {
    violations.push(`${rel}: concrete adapters may only be selected by app composition roots (${specifier})`);
  }

  if (area === 'services') {
    const currentService = serviceName(file);
    const match = specifier.match(/(?:^|\/)services\/([^/]+)/);
    if (match && match[1] !== currentService) {
      violations.push(`${rel}: services must not import another service implementation (${specifier})`);
    }
  }

  if (specifier.startsWith('@videoos/')) {
    const allowedCore = [
      '@videoos/contracts',
      '@videoos/event-fabric',
      '@videoos/job-queue',
      '@videoos/storage',
      '@videoos/identity',
      '@videoos/node-protocol'
    ];
    const coreImport = allowedCore.some((name) => specifier === name || specifier.startsWith(`${name}/`));
    const appAdapterImport = area === 'apps' && specifier.startsWith('@videoos/adapter-');
    if (!coreImport && !appAdapterImport) {
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
