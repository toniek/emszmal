import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { EmszmalClient } from '../packages/client/dist/index.js';
import { account, bank, deferred, json, mockApi } from './helpers.mjs';

for (const method of ['SMS', 'TOKEN', 'MOBILE_APP']) {
  test(`${method}: second phase runs while data is pending and respects ten seconds`, async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
    const data = deferred();
    const challenge = { AuthenticationMethod: method, PreAuthenticationCode: 'challenge', AuthenticationCodeHint: 'hint' };
    const api = mockApi((c) => {
      if (c.path.endsWith('GetAccountsList')) return data.promise;
      if (c.path.endsWith('GetSecondPhaseAuthenticationData')) return json(challenge);
      if (c.path.endsWith('DoSecondPhaseAuthentication')) {
        assert.equal(c.body.AuthenticationCode, '123456');
        data.resolve(json({ Accounts: [account] }));
        return json({});
      }
    });
    let callbackCount = 0;
    const operation = new EmszmalClient(api.options).getAccounts(bank, {
      onSecondPhase: async (actual, { signal }) => {
        callbackCount++;
        assert.deepEqual(actual, challenge);
        assert.equal(signal.aborted, false);
        if (method === 'MOBILE_APP') data.resolve(json({ Accounts: [account] }));
        else return '123456';
      },
    });
    await setImmediate();
    t.mock.timers.tick(9999);
    await setImmediate();
    assert.equal(api.calls.length, 2);
    t.mock.timers.tick(1);
    assert.deepEqual(await operation, { Accounts: [account] });
    assert.equal(callbackCount, 1);
    assert.equal(api.calls.filter((c) => c.path.endsWith('DoSecondPhaseAuthentication')).length, method === 'MOBILE_APP' ? 0 : 1);
    assert.equal(api.calls.at(-1).path, '/Common/SayBye');
    for (const call of api.calls.slice(1)) {
      assert.equal(call.body.SessionId, 'session-1');
      assert.equal(call.headers.Cookie, 'session=session-1');
    }
  });
}

test('quick data response cancels delayed authentication without additional requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const api = mockApi();
  await new EmszmalClient(api.options).getAccounts(bank, { onSecondPhase: () => assert.fail('must not ask for a code') });
  t.mock.timers.tick(120_000);
  assert.equal(api.calls.length, 3);
});

test('failed authentication callback aborts the data request and sanitizes the error', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const api = mockApi((c) => {
    if (c.path.endsWith('GetAccountsList')) return new Promise(() => {});
    if (c.path.endsWith('GetSecondPhaseAuthenticationData')) return json({ AuthenticationMethod: 'SMS', PreAuthenticationCode: '', AuthenticationCodeHint: '' });
  });
  const operation = new EmszmalClient(api.options).getAccounts(bank, { onSecondPhase: () => { throw new Error('private-code'); } });
  const rejected = assert.rejects(operation, (error) => {
    assert.equal(error.code, 'AUTHENTICATION');
    assert.doesNotMatch(error.stack, /private-code/);
    return true;
  });
  await setImmediate();
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(api.calls[1].signal.aborted, true);
  assert.equal(api.calls.at(-1).path, '/Common/SayBye');
});

test('cancellation releases a hanging callback and closes the session', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const api = mockApi((c) => {
    if (c.path.endsWith('GetAccountsList')) return new Promise(() => {});
    if (c.path.endsWith('GetSecondPhaseAuthenticationData')) return json({ AuthenticationMethod: 'TOKEN', PreAuthenticationCode: '', AuthenticationCodeHint: '' });
  });
  let callbackSignal;
  const controller = new AbortController();
  const operation = new EmszmalClient(api.options).getAccounts(bank, {
    signal: controller.signal,
    onSecondPhase: (_, { signal }) => { callbackSignal = signal; return new Promise(() => {}); },
  });
  const rejected = assert.rejects(operation, { code: 'ABORTED' });
  await setImmediate();
  t.mock.timers.tick(10_000);
  await setImmediate();
  assert.ok(callbackSignal);
  controller.abort();
  await rejected;
  assert.equal(callbackSignal.aborted, true);
  assert.equal(api.calls.at(-1).path, '/Common/SayBye');
});

test('unknown authentication methods fail without submitting a guessed code', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const api = mockApi((c) => {
    if (c.path.endsWith('GetAccountsList')) return new Promise(() => {});
    if (c.path.endsWith('GetSecondPhaseAuthenticationData')) return json({ AuthenticationMethod: 'FUTURE_METHOD' });
  });
  const operation = new EmszmalClient(api.options).getAccounts(bank, { onSecondPhase: () => assert.fail('unknown method') });
  const rejected = assert.rejects(operation, { code: 'INVALID_RESPONSE' });
  await setImmediate();
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(api.calls.some((c) => c.path.endsWith('DoSecondPhaseAuthentication')), false);
});

test('manual authentication rejects invalid states and duplicate submissions', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const data = deferred();
  const api = mockApi((c) => {
    if (c.path.endsWith('GetAccountsList')) return data.promise;
    if (c.path.endsWith('GetSecondPhaseAuthenticationData')) return json({ AuthenticationMethod: 'SMS', PreAuthenticationCode: '', AuthenticationCodeHint: '' });
    if (c.path.endsWith('DoSecondPhaseAuthentication')) return json({});
  });
  const session = await new EmszmalClient(api.options).openSession();
  await assert.rejects(session.getSecondPhaseAuthenticationData(), { code: 'SESSION_STATE' });
  const operation = session.getAccounts(bank);
  await assert.rejects(session.doSecondPhaseAuthentication('123'), { code: 'SESSION_STATE' });
  const challenge = session.getSecondPhaseAuthenticationData();
  const duplicate = session.getSecondPhaseAuthenticationData();
  t.mock.timers.tick(10_000);
  assert.deepEqual(await challenge, await duplicate);
  await assert.rejects(session.doSecondPhaseAuthentication(''), { code: 'VALIDATION' });
  await session.doSecondPhaseAuthentication('123');
  await assert.rejects(session.doSecondPhaseAuthentication('456'), { code: 'SESSION_STATE' });
  data.resolve(json({ Accounts: [] }));
  await operation;
  await session.close();
  assert.equal(api.calls.filter((c) => c.path.endsWith('GetSecondPhaseAuthenticationData')).length, 1);
});
