import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function packageManifest(name, resolver = require) {
  for (const directory of resolver.resolve.paths(name) ?? []) {
    const path = join(directory, name, 'package.json');
    if (existsSync(path)) return realpathSync(path);
  }
  throw new Error(`Cannot locate installed package ${name}.`);
}
const artifacts = join(root, '.artifacts');
mkdirSync(artifacts, { recursive: true });
const packed = [];
for (const folder of ['client', 'nestjs']) {
  const output = join(artifacts, `pack-${folder}.json`);
  const fd = openSync(output, 'w');
  try {
    execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', artifacts], { cwd: join(root, 'packages', folder), stdio: ['ignore', fd, 'inherit'] });
  } finally { closeSync(fd); }
  // Older npm releases may prefix --json output with lifecycle script logs.
  const outputText = readFileSync(output, 'utf8');
  const [pack] = JSON.parse(outputText.slice(outputText.lastIndexOf('\n[') + 1));
  rmSync(output);
  for (const { path } of pack.files) {
    assert.ok(/^(dist\/|package\.json$|README\.md$|LICENSE$|CHANGELOG\.md$)/.test(path), `Unexpected published file: ${path}`);
    assert.ok(!/test_klucze|\.env|node_modules/.test(path), `Unexpected private file: ${path}`);
  }
  for (const path of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts', 'dist/index.d.cts', 'LICENSE', 'README.md']) {
    assert.ok(pack.files.some((entry) => entry.path === path), `Missing ${path} in ${pack.name}`);
  }
  // npm 8 reports scoped names as @scope/name-version.tgz in JSON but writes
  // the tarball as scope-name-version.tgz. Newer versions report the filename.
  let file = join(artifacts, pack.filename);
  if (!existsSync(file)) file = join(artifacts, pack.filename.replace(/^@/, '').replace('/', '-'));
  assert.ok(existsSync(file), `Missing packed tarball for ${pack.name}`);
  packed.push({ name: pack.name, file });
}

const consumer = mkdtempSync(join(tmpdir(), 'emszmal-consumer-'));
try {
  const tools = ['@nestjs/common', '@nestjs/core', '@nestjs/testing', 'reflect-metadata', 'rxjs', 'typescript', '@types/node'];
  const dependencies = Object.fromEntries(packed.map(({ name, file }) => [name, `file:${file}`]));
  for (const name of tools) dependencies[name] = JSON.parse(readFileSync(packageManifest(name), 'utf8')).version;
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }, null, 2));

  // Offline artifact check when registry tarballs are unavailable. Copy declared
  // dependencies and unpack the two archives; never link workspace source.
  if (process.argv.includes('--reuse-installed')) {
    const visited = new Set();
    function copyDependency(name, resolver) {
      const manifest = packageManifest(name, resolver);
      const source = dirname(realpathSync(manifest));
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (visited.has(name)) return;
      visited.add(name);
      const target = join(consumer, 'node_modules', name);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true, dereference: true, filter: (path) => !path.startsWith(join(source, 'node_modules')) });
      const localRequire = createRequire(manifest);
      for (const child of Object.keys(pkg.dependencies ?? {})) copyDependency(child, localRequire);
      for (const child of Object.keys(pkg.peerDependencies ?? {})) {
        if (!pkg.peerDependenciesMeta?.[child]?.optional) copyDependency(child, localRequire);
      }
    }
    for (const name of [...tools, 'tough-cookie']) copyDependency(name, require);
    for (const { name, file } of packed) {
      const target = join(consumer, 'node_modules', name);
      mkdirSync(target, { recursive: true });
      execFileSync('tar', ['-xzf', file, '--strip-components=1', '-C', target], { stdio: 'inherit' });
    }
    console.log('Offline mode: testing unpacked npm archives with installed dependencies.');
  } else {
    execFileSync(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'inherit' });
  }
  writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { EmszmalClient, EmszmalError } from '@toniekw/emszmal-client';
import { EmszmalModule, EMSZMAL_CLIENT } from '@toniekw/nestjs-emszmal';
const require = createRequire(import.meta.url);
assert.equal(require('@toniekw/emszmal-client').EmszmalClient, EmszmalClient);
assert.equal(require('@toniekw/emszmal-client').EmszmalError, EmszmalError);
assert.equal(require('@toniekw/nestjs-emszmal').EmszmalModule, EmszmalModule);
assert.equal(require('@toniekw/nestjs-emszmal').EMSZMAL_CLIENT, EMSZMAL_CLIENT);
const calls = [];
const options = { license: { apiId: 'fixture', apiKey: 'fixture' }, fetch: async (url) => {
  calls.push(url);
  if (url.endsWith('SayHello')) return Response.json({ SessionId: 'fixture' }, { headers: { 'Set-Cookie': 'session=fixture; Path=/; Secure' } });
  return Response.json(url.endsWith('GetAccountsList') ? { Accounts: [] } : {});
}};
const module = await Test.createTestingModule({ imports: [EmszmalModule.forRoot(options)] }).compile();
try {
  assert.ok(module.get(EMSZMAL_CLIENT) instanceof EmszmalClient);
  assert.deepEqual(await module.get(EMSZMAL_CLIENT).getAccounts({ providerId: 0, login: 'fixture', password: 'fixture' }), { Accounts: [] });
  assert.equal(calls.length, 3);
} finally { await module.close(); }
`);
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, stdio: 'inherit' });
  const types = `
import { EmszmalClient, type ClientOptions, type BankCredentials, type AccountsHistoryResponse } from '@toniekw/emszmal-client';
import { EmszmalModule, type EmszmalModuleAsyncOptions } from '@toniekw/nestjs-emszmal';
const config: ClientOptions = { license: { apiId: 'fixture', apiKey: 'fixture' } };
const bank: BankCredentials = { providerId: 0, login: 'fixture', password: 'fixture' };
const result: Promise<AccountsHistoryResponse> = new EmszmalClient(config).getAccountsHistory(bank);
const options: EmszmalModuleAsyncOptions = { inject: ['CONFIG'], useFactory: async (value: ClientOptions) => value };
EmszmalModule.forRoot(config);
EmszmalModule.forRootAsync(options);
void result;
// @ts-expect-error license keys must be strings
new EmszmalClient({ license: { apiId: 123, apiKey: 'fixture' } });
`;
  for (const ext of ['mts', 'cts']) writeFileSync(join(consumer, `types.${ext}`), types);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, noEmit: true }, files: ['types.mts', 'types.cts'] }));
  execFileSync(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: consumer, stdio: 'inherit' });
  console.log('Packed packages passed ESM, CommonJS, NestJS DI and TypeScript consumer checks.');
  for (const { file } of packed) console.log(file);
} finally { rmSync(consumer, { recursive: true, force: true }); }
