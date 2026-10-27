import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLicense } from '../scripts/live-config.mjs';

test('live credentials loader accepts environment values without reading a file', () => {
  assert.deepEqual(loadLicense({ EMSZMAL_API_ID: 'fake-id', EMSZMAL_API_KEY: 'fake-key', EMSZMAL_KEYS_FILE: '/missing' }), { apiId: 'fake-id', apiKey: 'fake-key' });
  assert.throws(() => loadLicense({ EMSZMAL_API_ID: 'fake-id' }), /Set both/);
});

test('live credentials loader supports both documented label layouts and rejects incomplete files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'emszmal-fixture-'));
  const file = join(directory, 'keys.txt');
  try {
    for (const content of ['Id licencji:\nfake-id\nKlucz licencji:\nfake-key', 'Id licencji: fake-id\r\nKlucz licencji: fake-key']) {
      writeFileSync(file, content);
      assert.deepEqual(loadLicense({ EMSZMAL_KEYS_FILE: file }), { apiId: 'fake-id', apiKey: 'fake-key' });
    }
    for (const content of ['invalid', 'Id licencji:\nKlucz licencji:\nfake-key', 'Id licencji\nKlucz licencji\nfake-key']) {
      writeFileSync(file, content);
      assert.throws(() => loadLicense({ EMSZMAL_KEYS_FILE: file }), /License file/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
