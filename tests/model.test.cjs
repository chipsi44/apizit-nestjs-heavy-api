const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createHeavy } = require('../dist/heavy.cjs');
test('opt-in real CPU model inference', { timeout: 600000 }, async () => {
  const heavy = createHeavy();
  assert.equal((await heavy.ready()).statusCode, 200);
  const text = await heavy.textEmbedding({ text: 'A calm API launch' });
  assert.equal(text.dimension, 384);
  assert.ok(text.embedding.every(Number.isFinite));
  assert.ok((await heavy.similarity({ left: 'hello', right: 'hello' })).similarity > 0.99);
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: 'orange' },
  })
    .png()
    .toBuffer();
  const image = { buffer, mimetype: 'image/png' };
  assert.ok((await heavy.imageAnalyze(image)).predictions.length > 0);
  const embedded = await heavy.imageEmbedding(image);
  assert.ok(embedded.dimension > 0 && embedded.embedding.every(Number.isFinite));
});
