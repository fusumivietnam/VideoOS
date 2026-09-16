import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: pnpm generate:service -- <kebab-case-name>');
  process.exit(1);
}

const dir = join(process.cwd(), 'services', name);
try { await access(dir); console.error(`Service already exists: ${name}`); process.exit(1); } catch {}
await mkdir(join(dir, 'src'), { recursive: true });

const pkg = {
  name: `@videoos/${name}`,
  private: true,
  version: '0.0.0',
  type: 'module',
  scripts: { typecheck: 'tsc --noEmit' },
  dependencies: { '@videoos/contracts': 'workspace:*' },
  devDependencies: { typescript: '^5.9.0' }
};

await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
await writeFile(join(dir, 'tsconfig.json'), '{\n  "extends": "../../tsconfig.base.json",\n  "include": ["src/**/*.ts"]\n}\n');
await writeFile(join(dir, 'src/index.ts'), `import type { ProjectId } from '@videoos/contracts';\n\nexport interface ${name.split('-').map(x=>x[0].toUpperCase()+x.slice(1)).join('')}Service {\n  health(projectId: ProjectId): Promise<'ok'>;\n}\n`);
await writeFile(join(dir, 'README.md'), `# ${name}\n\nGenerated VideoOS service. Keep external providers behind adapters and communicate with other services through contracts/events/queues.\n`);
console.log(`Created services/${name}`);
