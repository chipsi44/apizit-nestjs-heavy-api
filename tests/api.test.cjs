const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const contract = require('../contract.json');
const { createApp } = require('../dist/app.js');
let app, client;
const sleeps = [];
const sharp = require('sharp');
const { ModelRegistry, cosine } = require('../dist/heavy.cjs');
let loads = [];
const registry = new ModelRegistry(async (name) => {
  loads.push(name);
  return {
    model_id: `${name}-double`,
    embed: async () => [0.25, 0.5, 0.75],
    classify: async () => [{ label: 'orange', score: 0.8 }],
  };
});
before(async () => {
  app = await createApp({
    sleep: async (duration) => {
      sleeps.push(duration);
    },
    registry,
  });
  client = request(true ? app.getHttpServer() : app);
});
after(async () => {
  if (true) await app.close();
});
test('health and info', async () => {
  const health = await client.get('/health').expect(200);
  assert.deepEqual(health.body, { status: 'ok' });
  assert.deepEqual((await client.get('/info')).body, {
    framework: contract.framework,
    profile: contract.profile,
  });
  assert.deepEqual(sleeps, []);
});
test('echo success preserves fields', async () => {
  const payload = { message: 'hello', count: 2 };
  assert.deepEqual((await client.post('/echo').send(payload).expect(200)).body, {
    received: payload,
  });
});
test('echo validation', async () => {
  for (const payload of [
    null,
    [],
    {},
    { message: '', count: 1 },
    { message: 'x', count: true },
    { message: 'x', count: 1.5 },
    { message: 'x'.repeat(5001), count: 1 },
  ]) {
    await client
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload))
      .expect(400);
  }
  await client.post('/echo').set('Content-Type', 'application/json').send('{').expect(400);
});
test('item contract and validation', async () => {
  assert.deepEqual((await client.get('/items/7').expect(200)).body, {
    item_id: 7,
    include_details: false,
  });
  assert.deepEqual((await client.get('/items/7?include_details=true').expect(200)).body, {
    item_id: 7,
    include_details: true,
    details: 'Reference item 7',
  });
  for (const path of [
    '/items/0',
    '/items/-1',
    '/items/abc',
    '/items/9007199254740992',
    '/items/7?include_details=maybe',
  ])
    await client.get(path).expect(400);
});
test('slow waits exactly 80 seconds through a controlled timer', async () => {
  assert.deepEqual((await client.get('/slow').expect(200)).body, {
    delay_seconds: 80,
    status: 'completed',
  });
  assert.deepEqual(sleeps, [80000]);
});
test('route contract has no accidental documentation or admin endpoints', async () => {
  const instance = true ? app.getHttpAdapter().getInstance() : app;
  const routes = instance.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => ({
          method: method.toUpperCase(),
          path: layer.route.path.replace(':item_id', '{item_id}'),
        })),
    );
  assert.deepEqual(
    routes.sort((a, b) => a.path.localeCompare(b.path)),
    [...contract.routes].sort((a, b) => a.path.localeCompare(b.path)),
  );
  await client.get('/docs').expect(404);
});
test('health never initializes model services', async () => {
  await client.get('/health').expect(200);
  assert.deepEqual(loads, []);
});
test('text and readiness contracts', async () => {
  assert.deepEqual(
    (await client.post('/text/embedding').send({ text: 'hello' }).expect(200)).body,
    { model: 'text-double', dimension: 3, embedding: [0.25, 0.5, 0.75] },
  );
  const result = await client
    .post('/text/similarity')
    .send({ left: 'hello', right: 'hello' })
    .expect(200);
  assert.ok(Math.abs(result.body.similarity - 1) < 1e-6);
  assert.ok(Math.abs(cosine([1, 0], [1, 1]) - Math.SQRT1_2) < 1e-6);
  const ready = await client.get('/ready').expect(200);
  assert.deepEqual(ready.body.models, { text: true, image: true });
});
test('text validation boundaries', async () => {
  for (const payload of [{}, { text: 123 }, { text: '   ' }, { text: 'x'.repeat(5001) }])
    await client.post('/text/embedding').send(payload).expect(400);
  await client.post('/text/similarity').send({ left: 'hello' }).expect(400);
});
test('real image decoding with controlled inference', async () => {
  const png = await sharp({ create: { width: 24, height: 16, channels: 3, background: 'orange' } })
    .png()
    .toBuffer();
  const analyzed = await client
    .post('/image/analyze')
    .attach('file', png, { filename: 'sample.png', contentType: 'image/png' })
    .expect(200);
  assert.deepEqual(analyzed.body.image, { width: 24, height: 16, format: 'PNG' });
  assert.deepEqual(analyzed.body.predictions, [{ label: 'orange', score: 0.8 }]);
  const embedded = await client
    .post('/image/embedding')
    .attach('file', png, { filename: 'sample.png', contentType: 'image/png' })
    .expect(200);
  assert.equal(embedded.body.dimension, embedded.body.embedding.length);
  await client
    .post('/image/analyze')
    .attach('file', Buffer.from('bad'), { filename: 'bad.png', contentType: 'image/png' })
    .expect(400);
  await client
    .post('/image/analyze')
    .attach('file', Buffer.from('bad'), { filename: 'bad.txt', contentType: 'text/plain' })
    .expect(415);
  await client.post('/image/embedding').expect(400);
  await client
    .post('/image/analyze')
    .attach('file', Buffer.alloc(4 * 1024 * 1024 + 1), {
      filename: 'big.png',
      contentType: 'image/png',
    })
    .expect(413);
});
test('registry deduplicates concurrent loads and retries failures', async () => {
  let calls = 0;
  const local = new ModelRegistry(async () => {
    calls++;
    if (calls === 1) throw new Error('controlled');
    return {};
  });
  const results = await Promise.allSettled([local.get('text'), local.get('text')]);
  assert.ok(
    results.every((result) => result.status === 'rejected' && result.reason.status === 503),
  );
  assert.equal(calls, 1);
  await local.get('text');
  assert.equal(calls, 2);
});
test('unavailable readiness returns 503', async () => {
  const failed = await createApp({
    registry: new ModelRegistry(async () => {
      throw new Error('controlled');
    }),
  });
  try {
    await request(true ? failed.getHttpServer() : failed)
      .get('/ready')
      .expect(503);
  } finally {
    if (true) await failed.close();
  }
});
