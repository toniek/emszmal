import { readFileSync } from 'node:fs';

export function loadLicense(env = process.env) {
  if (env.EMSZMAL_API_ID || env.EMSZMAL_API_KEY) {
    if (!env.EMSZMAL_API_ID || !env.EMSZMAL_API_KEY) throw new Error('Set both EMSZMAL_API_ID and EMSZMAL_API_KEY.');
    return { apiId: env.EMSZMAL_API_ID, apiKey: env.EMSZMAL_API_KEY };
  }
  const lines = readFileSync(env.EMSZMAL_KEYS_FILE ?? 'test_klucze', 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  function readLabel(label) {
    const index = lines.findIndex((line) => label.test(line));
    if (index < 0) return undefined;
    const value = lines[index].replace(label, '').trim() || lines[index + 1];
    return value && !/^(Id licencji|Klucz licencji)(?:\s*:|\s*$)/iu.test(value) ? value : undefined;
  }
  const apiId = readLabel(/^Id licencji\s*:?\s*/iu);
  const apiKey = readLabel(/^Klucz licencji\s*:?\s*/iu);
  if (!apiId || !apiKey) throw new Error('License file must contain Id licencji and Klucz licencji.');
  return { apiId, apiKey };
}
