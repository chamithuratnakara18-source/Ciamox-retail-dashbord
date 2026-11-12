const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the shared handler so route tests do not need Firebase credentials or
// installed SDK modules. Each direct function must forward the public path.
const shared = require.resolve('../api/[...path].js');
require.cache[shared] = {
  id: shared, filename: shared, loaded: true,
  exports: async (req, res) => res.status(200).json({ path: req.url }),
};

function response() {
  return {
    code: null, payload: null,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test('direct camera route preserves query even if Vercel rewrites the path', async () => {
  const req = { url: '/?barcode=12345', method: 'GET', headers: { host: 'localhost' } };
  const res = response();
  await require('../api/ai-models')(req, res);
  assert.equal(req.url, '/api/ai-models?barcode=12345');
  assert.equal(res.code, 200);
  assert.equal(res.payload.path, '/api/ai-models?barcode=12345');
});

test('scheduled upload route reaches the protected shared path', async () => {
  const req = { url: '/', method: 'GET', headers: { host: 'localhost' } };
  const res = response();
  await require('../api/ultralytics/sync')(req, res);
  assert.equal(req.url, '/api/ultralytics/sync');
  assert.equal(res.code, 200);
  assert.equal(res.payload.path, '/api/ultralytics/sync');
});
