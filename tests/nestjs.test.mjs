import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmszmalModule, EMSZMAL_CLIENT, InjectEmszmalClient, EmszmalClient } from '../packages/nestjs/dist/index.js';
import { bank, mockApi } from './helpers.mjs';

test('Nest module exports the same client by class, token and decorator', async () => {
  const api = mockApi();
  class Consumer { constructor(client) { this.client = client; } }
  InjectEmszmalClient()(Consumer, undefined, 0);
  const module = await Test.createTestingModule({ imports: [EmszmalModule.forRoot(api.options)], providers: [Consumer] }).compile();
  try {
    const client = module.get(EMSZMAL_CLIENT);
    assert.ok(client instanceof EmszmalClient);
    assert.equal(module.get(EmszmalClient), client);
    assert.equal(module.get(Consumer).client, client);
    await module.get(Consumer).client.getAccounts(bank);
    assert.equal(api.calls.length, 3);
  } finally { await module.close(); }
});

test('async factory receives dependencies from imported modules', async () => {
  const api = mockApi();
  const CONFIG = Symbol('config');
  class ConfigModule {}
  Module({ providers: [{ provide: CONFIG, useValue: api.options }], exports: [CONFIG] })(ConfigModule);
  let calls = 0;
  const module = await Test.createTestingModule({ imports: [EmszmalModule.forRootAsync({
    imports: [ConfigModule], inject: [CONFIG],
    useFactory: async (config) => { calls++; return config; },
  })] }).compile();
  try { await module.get(EMSZMAL_CLIENT).getAccounts(bank); assert.equal(calls, 1); }
  finally { await module.close(); }
});

test('invalid async configuration fails at module initialization without HTTP calls', async () => {
  await assert.rejects(Test.createTestingModule({ imports: [EmszmalModule.forRootAsync({ useFactory: async () => ({ license: { apiId: '', apiKey: '' } }) })] }).compile(), { code: 'VALIDATION' });
});

test('global registration makes the client visible in an unrelated feature module', async () => {
  const api = mockApi();
  class Consumer { constructor(client) { this.client = client; } }
  InjectEmszmalClient()(Consumer, undefined, 0);
  class FeatureModule {}
  Module({ providers: [Consumer], exports: [Consumer] })(FeatureModule);
  const module = await Test.createTestingModule({ imports: [EmszmalModule.forRoot({ ...api.options, isGlobal: true }), FeatureModule] }).compile();
  try { assert.equal(module.get(Consumer).client, module.get(EMSZMAL_CLIENT)); }
  finally { await module.close(); }
});

test('separate Nest contexts never reuse client configuration', async () => {
  const one = mockApi();
  const two = mockApi();
  const first = await Test.createTestingModule({ imports: [EmszmalModule.forRoot(one.options)] }).compile();
  const second = await Test.createTestingModule({ imports: [EmszmalModule.forRoot(two.options)] }).compile();
  try {
    assert.notEqual(first.get(EMSZMAL_CLIENT), second.get(EMSZMAL_CLIENT));
    await first.get(EMSZMAL_CLIENT).getAccounts(bank);
    assert.equal(one.calls.length, 3); assert.equal(two.calls.length, 0);
  } finally { await first.close(); await second.close(); }
});
