import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const [kind, name] = process.argv.slice(2);
for (const value of [kind, name]) {
  if (!value || !/^[a-z][a-z0-9-]*$/.test(value)) {
    console.error('Usage: pnpm generate:adapter -- <kind> <kebab-case-name>');
    process.exit(1);
  }
}

const dirName = `${kind}-${name}`;
const dir = join(process.cwd(), 'packages', 'adapters', dirName);
try { await access(dir); console.error(`Adapter already exists: ${dirName}`); process.exit(1); } catch {}
await mkdir(join(dir, 'src'), { recursive: true });

const pkg = {
  name: `@videoos/adapter-${dirName}`,
  private: true,
  version: '0.0.0',
  type: 'module',
  scripts: { typecheck: 'tsc --noEmit' },
  dependencies: { '@videoos/contracts': 'workspace:*' },
  devDependencies: { typescript: '^5.9.0' }
};

await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
await writeFile(join(dir, 'tsconfig.json'), '{\n  "extends": "../../../tsconfig.base.json",\n  "include": ["src/**/*.ts"]\n}\n');
await writeFile(join(dir, 'src/index.ts'), `/** ${kind}/${name} adapter boundary. Provider SDK types stay inside this package. */\nexport const adapterId = '${kind}:${name}' as const;\n`);
await writeFile(join(dir, 'README.md'), `# ${kind}/${name} adapter\n\nTranslate between VideoOS canonical contracts and the external provider. Normalize errors, expose capabilities, and keep credentials/provider SDK types private to this package.\n`);
console.log(`Created packages/adapters/${dirName}`);
