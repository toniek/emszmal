import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const expected = process.argv[2];
for (const name of ['client', 'nestjs']) {
  const pkg = JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8'));
  assert.ok(pkg.author, `${pkg.name}: set the real author before publishing.`);
  assert.ok(pkg.repository?.url, `${pkg.name}: set repository.url before publishing.`);
  assert.ok(pkg.bugs?.url, `${pkg.name}: set bugs.url before publishing.`);
  assert.equal(pkg.license, 'MIT');
  if (expected) assert.equal(pkg.version, expected, `${pkg.name}: version differs from requested release.`);
  if (process.env.GITHUB_REPOSITORY) {
    const actual = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
    assert.equal(actual, `https://github.com/${process.env.GITHUB_REPOSITORY}`, 'Repository must match the OIDC publisher.');
  }
}
console.log('Release metadata checked.');
