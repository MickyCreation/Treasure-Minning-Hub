import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const env = {
  APP_ORIGIN: 'http://localhost:5173',
};

test('health endpoint reports service status without database access', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/api/health'),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'Treasure Minning Hub API',
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('unknown API route returns 404 JSON', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/api/not-a-route'),
    env,
  );
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /Route not found/);
});

test('cross-origin API request is rejected', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/api/health', {
      headers: { Origin: 'https://attacker.example' },
    }),
    env,
  );
  assert.equal(response.status, 403);
});


test('administrator overview is protected by authentication', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/api/admin/overview'),
    env,
  );
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign in/i);
});

test('Kora webhook rejects an invalid signature before database access', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/api/webhooks/korapay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'charge.success', data: { reference: 'TMH-TEST-REF', status: 'success' } }),
    }),
    { ...env, KORA_SECRET_KEY: 'test_secret_only' },
  );
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /signature/i);
});


test('Flutterwave webhook rejects an invalid secret hash before database access', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/api/webhooks/flutterwave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'verif-hash': 'wrong-hash' },
      body: JSON.stringify({ event: 'charge.completed', data: { id: 123, tx_ref: 'FLW-TEST-REFERENCE', status: 'successful' } }),
    }),
    { ...env, FLW_SECRET_KEY: 'test_secret_only', FLW_SECRET_HASH: 'expected-hash' },
  );
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /signature/i);
});
