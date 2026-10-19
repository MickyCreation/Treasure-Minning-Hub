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
