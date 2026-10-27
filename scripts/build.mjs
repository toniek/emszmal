import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = process.argv[2] === 'all' ? ['client', 'nestjs'] : [process.argv[2]];
if (names.some((name) => !['client', 'nestjs'].includes(name))) throw new Error('Expected client, nestjs or all.');
for (const name of names) {
  const pkg = join(root, 'packages', name);
  const dist = join(pkg, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'cjs'), { recursive: true });
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(pkg, 'tsconfig.json'),
    '--module', 'CommonJS', '--moduleResolution', 'Node', '--outDir', join(dist, 'cjs')], { stdio: 'inherit' });
  writeFileSync(join(dist, 'cjs/package.json'), '{"type":"commonjs"}\n');
  writeFileSync(join(dist, 'index.cjs'), "module.exports = require('./cjs/index.js');\n");
  // A single runtime graph preserves class identity when import and require mix.
  const keys = Object.keys(require(join(dist, 'index.cjs')));
  writeFileSync(join(dist, 'index.js'), "import api from './index.cjs';\n" + keys.map((key) => `export const ${key} = api.${key};\n`).join(''));
  mkdirSync(join(dist, 'types'), { recursive: true });
  for (const entry of readdirSync(join(dist, 'cjs'))) {
    if (entry.endsWith('.d.ts')) cpSync(join(dist, 'cjs', entry), join(dist, 'types', entry));
  }
  writeFileSync(join(dist, 'types/package.json'), '{"type":"module"}\n');
  writeFileSync(join(dist, 'index.d.ts'), "export * from './types/index.js';\n");
  writeFileSync(join(dist, 'index.d.cts'), "export * from './cjs/index.js';\n");
  console.log(`Built ${name} (CommonJS, ESM facade, declarations).`);
}
