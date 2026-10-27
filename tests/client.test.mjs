import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { EmszmalClient, EmszmalError, API_URLS } from '../packages/client/dist/index.js';
import { account, bank, deferred, json, license, mockApi, recentRange, transaction } from './helpers.mjs';

test('accounts request uses the documented envelope, cookie and independent cleanup', async () => {
  const api = mockApi();
  const client = new EmszmalClient(api.options);
  assert.deepEqual(await client.getAccounts(bank), { Accounts: [account] });
  assert.deepEqual(api.calls.map((c) => c.path), ['/Common/SayHello', '/Accounts/GetAccountsList', '/Common/SayBye']);
  assert.deepEqual(api.calls[0].body, { License: { APIId: license.apiId, APIKey: license.apiKey } });
  assert.deepEqual(api.calls[1].body, {
    SessionId: 'session-1', ProviderId: 0, ProviderConfiguration: '',
    Authentication: { UserLogin: bank.login, UserPassword: bank.password, UserContext: '', TokenValue: '' },
    License: { APIId: license.apiId, APIKey: license.apiKey },
  });
  for (const c of api.calls.slice(1)) assert.equal(c.headers.Cookie, 'session=session-1');
  assert.equal(api.calls[1].redirect, 'error');
  assert.equal(api.calls[1].headers.Accept, 'application/json');
});

test('single and multiple histories preserve wire values, grouping and optional queries', async () => {
  const api = mockApi();
  const client = new EmszmalClient(api.options);
  const range = recentRange();
  assert.deepEqual(await client.getAccountHistory(bank, { accountNumber: '000123', ...range }), { Transactions: [transaction] });
  assert.deepEqual(api.calls[1].body.Data, { AccountNumber: '000123', DateSince: range.dateSince, DateTo: range.dateTo });
  assert.deepEqual(await client.getAccountsHistory(bank, { accountNumbers: ['000123'], ...range }), { Accounts: [account], Transactions: [[transaction]] });
  assert.deepEqual(api.calls[4].body.Data, { AccountNumbers: ['000123'], DateSince: range.dateSince, DateTo: range.dateTo });
  await client.getAccountsHistory(bank);
  assert.deepEqual(api.calls[7].body.Data, {});
});

test('provider configuration, authentication context and upstream proxy are forwarded', async () => {
  const api = mockApi();
  await new EmszmalClient(api.options).getAccounts({ ...bank, userContext: 'company', tokenValue: 'token', providerConfiguration: 'settings', proxy: { host: 'proxy.example', port: 8080 } });
  assert.equal(api.calls[1].body.Authentication.UserContext, 'company');
  assert.equal(api.calls[1].body.Authentication.TokenValue, 'token');
  assert.equal(api.calls[1].body.ProviderConfiguration, 'settings');
  assert.deepEqual(api.calls[1].body.Proxy, { Host: 'proxy.example', Port: 8080, Login: '', Password: '' });
});

test('concurrent operations never share session ids or cookies', async () => {
  const api = mockApi();
  const client = new EmszmalClient(api.options);
  await Promise.all(Array.from({ length: 8 }, () => client.getAccounts(bank)));
  const requests = api.calls.filter((c) => c.path === '/Accounts/GetAccountsList');
  assert.equal(new Set(requests.map((c) => c.body.SessionId)).size, 8);
  for (const call of api.calls.filter((c) => c.body.SessionId)) assert.equal(call.headers.Cookie, `session=${call.body.SessionId}`);
});

test('cookies rotate, respect their paths, and handle multiple Set-Cookie headers', async () => {
  const api = mockApi((call) => {
    if (call.path === '/Common/SayHello') {
      const headers = new Headers();
      headers.append('Set-Cookie', 'session=original; Path=/; Secure; Expires=Wed, 01 Jan 2031 00:00:00 GMT');
      headers.append('Set-Cookie', 'other=private; Path=/other; Secure');
      return json({ SessionId: 'rotating' }, headers);
    }
    if (call.path === '/Accounts/GetAccountsList') return json({ Accounts: [] }, { 'Set-Cookie': 'session=rotated; Path=/; Secure' });
  });
  await new EmszmalClient(api.options).getAccounts(bank);
  assert.equal(api.calls[1].headers.Cookie, 'session=original');
  assert.equal(api.calls[2].headers.Cookie, 'session=rotated');
});

test('manual session permits one data operation and idempotent close', async () => {
  const api = mockApi();
  const session = await new EmszmalClient(api.options).openSession();
  const first = session.getAccounts(bank);
  await assert.rejects(session.getAccounts(bank), { code: 'SESSION_STATE' });
  await first;
  await assert.rejects(session.getSecondPhaseAuthenticationData(), { code: 'SESSION_STATE' });
  await Promise.all([session.close(), session.close()]);
  await assert.rejects(session.getAccounts(bank), { code: 'SESSION_STATE' });
  assert.equal(api.calls.filter((c) => c.path.endsWith('SayBye')).length, 1);
});

test('withSession closes unused sessions and preserves a callback error', async () => {
  const api = mockApi();
  const error = new Error('Caller-owned error');
  await assert.rejects(new EmszmalClient(api.options).withSession(async () => { throw error; }), (actual) => actual === error);
  assert.equal(api.calls.at(-1).path, '/Common/SayBye');
});

for (const [name, reply, code] of [
  ['HTTP status', () => new Response('secret', { status: 503 }), 'HTTP'],
  ['invalid JSON', () => new Response('test-secret-key'), 'INVALID_RESPONSE'],
  ['non-object', () => json(null), 'INVALID_RESPONSE'],
  ['API envelope', () => json({ Error: 'test-secret-key' }), 'API'],
  ['API success flag', () => json({ Success: false }), 'API'],
  ['API exception', () => json({ ExceptionMessage: 'test-secret-key' }), 'API'],
  ['wrong account shape', () => json({ Accounts: [{}] }), 'INVALID_RESPONSE'],
  ['transport failure', () => { throw new Error('fixture-password'); }, 'TRANSPORT'],
]) {
  test(`${name} is sanitized and still closes the session`, async () => {
    const api = mockApi((call) => call.path.startsWith('/Accounts/') ? reply() : undefined);
    await assert.rejects(new EmszmalClient(api.options).getAccounts(bank), (error) => {
      assert.ok(error instanceof EmszmalError);
      assert.equal(error.code, code);
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /test-secret-key|fixture-password/);
      if (code === 'HTTP') assert.equal(error.status, 503);
      return true;
    });
    assert.equal(api.calls.at(-1).path, '/Common/SayBye');
  });
}

test('failed opening does not invent a session or start a data operation', async () => {
  const api = mockApi(() => json({}));
  await assert.rejects(new EmszmalClient(api.options).getAccounts(bank), { code: 'INVALID_RESPONSE' });
  assert.equal(api.calls.length, 1);
});

test('session id without a cookie is rejected and cleanup is attempted', async () => {
  const api = mockApi((c) => c.path.endsWith('SayHello') ? json({ SessionId: 'missing-cookie' }) : undefined);
  await assert.rejects(new EmszmalClient(api.options).getAccounts(bank), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(api.calls.map((c) => c.path), ['/Common/SayHello', '/Common/SayBye']);
});

test('cleanup failure is visible without overwriting an operation failure', async () => {
  const api = mockApi((c) => c.path.endsWith('SayBye') ? new Response('', { status: 502 }) : c.path.startsWith('/Accounts/') ? new Response('', { status: 401 }) : undefined);
  await assert.rejects(new EmszmalClient(api.options).getAccounts(bank), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.cleanupError.status, 502);
    return true;
  });
  const cleanupOnly = mockApi((c) => c.path.endsWith('SayBye') ? new Response('', { status: 502 }) : undefined);
  await assert.rejects(new EmszmalClient(cleanupOnly.options).getAccounts(bank), { code: 'HTTP', status: 502 });
});

test('timeout bounds an unresponsive transport and still attempts cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const api = mockApi((c) => c.path.startsWith('/Accounts/') ? new Promise(() => {}) : undefined);
  const operation = new EmszmalClient({ ...api.options, requestTimeoutMs: 50 }).getAccounts(bank);
  const rejected = assert.rejects(operation, { code: 'TIMEOUT' });
  await setImmediate();
  t.mock.timers.tick(50);
  await rejected;
  assert.equal(api.calls.at(-1).path, '/Common/SayBye');
});

test('timeout includes streaming the response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const api = mockApi((c) => c.path.startsWith('/Accounts/') ? new Response(new ReadableStream({ start() {} })) : undefined);
  const operation = new EmszmalClient({ ...api.options, requestTimeoutMs: 50 }).getAccounts(bank);
  const rejected = assert.rejects(operation, { code: 'TIMEOUT' });
  await setImmediate();
  t.mock.timers.tick(50);
  await rejected;
});

test('abort before opening avoids all requests; abort during data still closes', async () => {
  const api = mockApi((c) => c.path.startsWith('/Accounts/') ? new Promise(() => {}) : undefined);
  const client = new EmszmalClient(api.options);
  await assert.rejects(client.getAccounts(bank, { signal: AbortSignal.abort('private reason') }), { code: 'ABORTED' });
  assert.equal(api.calls.length, 0);
  const controller = new AbortController();
  const operation = client.getAccounts(bank, { signal: controller.signal });
  const rejected = assert.rejects(operation, { code: 'ABORTED' });
  await setImmediate();
  controller.abort('private reason');
  await rejected;
  const cleanup = api.calls.at(-1);
  assert.equal(cleanup.path, '/Common/SayBye');
  assert.equal(cleanup.signal.aborted, false);
});

test('configuration rejects invalid URLs, secrets, timers and environment', () => {
  for (const options of [
    {}, { license: { apiId: '', apiKey: 'key' } },
    { license, baseUrl: 'http://remote.example/api' }, { license, baseUrl: 'bad' },
    { license, baseUrl: 'https://user:password@example.com' }, { license, baseUrl: 'https://example.com?q=1' },
    { license, environment: 'unknown' }, { license, requestTimeoutMs: 0 }, { license, cleanupTimeoutMs: NaN },
    { license, secondPhaseDelayMs: 9999 }, { license, fetch: 'invalid' },
  ]) assert.throws(() => new EmszmalClient(options), { code: 'VALIDATION' });
  assert.doesNotThrow(() => new EmszmalClient({ license, baseUrl: 'http://127.0.0.1:1234/api' }));
  assert.equal(API_URLS.test, 'https://web.emszmal.pl/apidev');
});

test('invalid credentials and history filters are rejected before any request', () => {
  const api = mockApi();
  const client = new EmszmalClient(api.options);
  for (const invalid of [undefined, { ...bank, providerId: -1 }, { ...bank, password: '' }, { ...bank, userContext: 1 }, { ...bank, proxy: { host: 'x', port: 0 } }, { ...bank, proxy: { host: 'x', port: 12, login: 1 } }]) {
    assert.throws(() => client.getAccounts(invalid), { code: 'VALIDATION' });
  }
  for (const query of [undefined, { accountNumber: '', ...recentRange() }, { accountNumber: 'a', dateSince: '2026-02-30', dateTo: '2026-03-01' }, { accountNumber: 'a', dateSince: 'x', dateTo: 'y' }]) {
    assert.throws(() => client.getAccountHistory(bank, query), { code: 'VALIDATION' });
  }
  for (const query of [null, [], { dateSince: '2026-10-01' }, { accountNumbers: Array(11).fill('1') }, { accountNumbers: [''] }, { accountNumbers: 'wrong' }]) {
    assert.throws(() => client.getAccountsHistory(bank, query), { code: 'VALIDATION' });
  }
  assert.throws(() => client.getAccounts(bank, { onSecondPhase: 'invalid' }), { code: 'VALIDATION' });
  assert.equal(api.calls.length, 0);
});

test('calendar validation handles month end, range boundaries and reversed dates', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-31T12:00:00Z') });
  const api = mockApi();
  const client = new EmszmalClient(api.options);
  await client.getAccountHistory(bank, { accountNumber: 'a', dateSince: '2026-02-28', dateTo: '2026-03-07' });
  for (const [dateSince, dateTo] of [['2026-02-27', '2026-02-28'], ['2026-03-01', '2026-03-09'], ['2026-03-09', '2026-03-01']]) {
    assert.throws(() => client.getAccountHistory(bank, { accountNumber: 'a', dateSince, dateTo }), { code: 'VALIDATION' });
  }
});

test('history responses reject malformed rows and mismatched grouping', async () => {
  const api = mockApi((c) => c.path.endsWith('GetAccountHistory') ? json({ Transactions: [{}] }) : c.path.endsWith('GetAccountsHistory') ? json({ Accounts: [account], Transactions: [] }) : undefined);
  const client = new EmszmalClient(api.options);
  await assert.rejects(client.getAccountHistory(bank, { accountNumber: 'a', ...recentRange() }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(client.getAccountsHistory(bank), { code: 'INVALID_RESPONSE' });
});

test('input mutation cannot change credentials or filters after starting an operation', async () => {
  const gate = deferred();
  const api = mockApi(async (c) => { if (c.path.endsWith('SayHello')) await gate.promise; });
  const options = { ...api.options, license: { ...license } };
  const client = new EmszmalClient(options);
  const mutableBank = { ...bank, proxy: { host: 'original', port: 80 } };
  const query = { accountNumbers: ['original'] };
  const operation = client.getAccountsHistory(mutableBank, query);
  mutableBank.password = 'changed'; mutableBank.proxy.host = 'changed'; query.accountNumbers.push('changed'); options.license.apiKey = 'changed';
  gate.resolve();
  await operation;
  assert.equal(api.calls[1].body.Authentication.UserPassword, bank.password);
  assert.equal(api.calls[1].body.Proxy.Host, 'original');
  assert.deepEqual(api.calls[1].body.Data.AccountNumbers, ['original']);
  assert.equal(api.calls[1].body.License.APIKey, license.apiKey);
});
