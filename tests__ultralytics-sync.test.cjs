const test = require('node:test');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { settings, referenceSet, tarGzip, uploadReferences } = require('../lib/ultralytics-sync');

const photo = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const product = { barcode: '12345', trainingPhotos: Array(6).fill(photo) };

test('sync is opt-in and keeps the key server-side', () => {
  assert.equal(settings({ ULTRALYTICS_SYNC_ENABLED: 'false' }), null);
  assert.deepEqual(settings({ ULTRALYTICS_SYNC_ENABLED: 'true', ULTRALYTICS_API_KEY: 'secret',
    ULTRALYTICS_OWNER: 'store-owner', ULTRALYTICS_DATASET: 'counter-objects' }),
  { key: 'secret', owner: 'store-owner', dataset: 'counter-objects' });
});

test('raw archive contains six images and no invented labels', () => {
  const data = gunzipSync(tarGzip([['images/train/a_front.jpg', Buffer.from('image')]]));
  assert.equal(data.toString('ascii', 0, 24).replaceAll('\0', ''), 'images/train/a_front.jpg');
  assert.equal(referenceSet(product).images.length, 6);
  assert.equal(referenceSet({ barcode: 'x', trainingPhotos: [photo] }), null);
});

test('uploads scanner photos through signed session and queues ingest', async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    const result = path.endsWith('/counter-objects') ? { dataset: { id: 'dataset-id' } }
      : path.endsWith('/signed-url') ? { sessionId: 'session-1', uploadUrl: 'https://storage.example/upload', headers: { 'x-upload-test': 'yes' } }
      : path.endsWith('/ingest') ? { jobId: 'job-1' } : {};
    return { ok: true, json: async () => result };
  };
  const config = { key: 'private-key', owner: 'store-owner', dataset: 'counter-objects' };
  const result = await uploadReferences(product, config, fetcher);
  assert.equal(result.status, 'queued');
  assert.equal(calls.length, 5);
  const signed = JSON.parse(calls[1].options.body);
  assert.equal(signed.assetId, 'dataset-id');
  assert.equal(signed.totalBytes, calls[2].options.body.length);
  assert.equal(calls[2].options.headers['x-upload-test'], 'yes');
  assert.equal(gunzipSync(calls[2].options.body).toString('ascii', 0, 12), 'images/train');
  const ingest = JSON.parse(calls[4].options.body);
  assert.equal(Object.keys(ingest.imageMetadata).length, 6);
  assert.equal(ingest.imageMetadata[Object.keys(ingest.imageMetadata)[0]].retailFlowBarcode, '12345');
  assert.equal((await uploadReferences({ ...product, ultralyticsSync: result }, config, fetcher)).status, 'unchanged');
  assert.equal(calls.length, 5);
});
