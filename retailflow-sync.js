// Single-store pilot: move scanner reference photos to a private Platform dataset.
// These are raw images with metadata, not object-detection labels or trained weights.
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');

const VIEWS = ['front', 'back', 'top', 'bottom', 'left', 'right'];
const BASE = 'https://platform.ultralytics.com/api';

function settings(env = process.env) {
  if (env.ULTRALYTICS_SYNC_ENABLED !== 'true') return null;
  const { ULTRALYTICS_API_KEY: key, ULTRALYTICS_OWNER: owner, ULTRALYTICS_DATASET: dataset } = env;
  if (!key || !/^[\w-]{1,128}$/.test(owner || '') || !/^[\w-]{1,128}$/.test(dataset || ''))
    throw new Error('Ultralytics sync needs a server-side API key, owner and dataset slug.');
  return { key, owner, dataset };
}

function photoBytes(value) {
  if (typeof value !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid JPEG reference photo.');
  const bytes = Buffer.from(value.slice('data:image/jpeg;base64,'.length), 'base64');
  if (!bytes.length || bytes.length > 100_000) throw new Error('Reference photo exceeds the size limit.');
  return bytes;
}

function referenceSet(product) {
  const photos = product.trainingPhotos;
  if (!Array.isArray(photos) || photos.length !== 6 || photos.some(p => !p)) return null;
  const images = photos.map(photoBytes);
  const hash = createHash('sha256');
  hash.update(String(product.barcode));
  images.forEach(image => hash.update(image));
  return { images, hash: hash.digest('hex') };
}

function octal(header, offset, length, value) {
  header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
}
function tarGzip(entries) {
  const blocks = [];
  for (const [name, contents] of entries) {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    if (!/^[a-zA-Z0-9/_-]+\.(?:jpg|yaml)$/.test(name) || Buffer.byteLength(name) > 100) throw new Error('Invalid archive entry.');
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'ascii');
    octal(header, 100, 8, 0o644); octal(header, 108, 8, 0); octal(header, 116, 8, 0);
    octal(header, 124, 12, data.length); octal(header, 136, 12, 0);
    header.fill(32, 148, 156); header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    octal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0));
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

async function jsonRequest(fetcher, url, key, options = {}) {
  const response = await fetcher(url, {
    ...options, signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${key}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (!response.ok) throw new Error(`Ultralytics API returned ${response.status} at ${new URL(url).pathname}.`);
  return response.json();
}

async function uploadReferences(product, config, fetcher = fetch) {
  const refs = referenceSet(product);
  if (!refs) return { status: 'no_six_views' };
  if (product.ultralyticsSync?.hash === refs.hash && product.ultralyticsSync?.status === 'queued')
    return { status: 'unchanged', hash: refs.hash };

  const datasetUrl = `${BASE}/datasets/${config.owner}/${config.dataset}`;
  const datasetResponse = await jsonRequest(fetcher, datasetUrl, config.key);
  const datasetId = datasetResponse.dataset?.id || datasetResponse.id;
  if (!datasetId) throw new Error('Ultralytics did not return a dataset ID; check the owner and dataset slug.');
  const prefix = `retail_${refs.hash.slice(0, 20)}`;
  const entries = refs.images.map((bytes, index) => [`images/train/${prefix}_${VIEWS[index]}.jpg`, bytes]);
  const archive = tarGzip(entries);
  const upload = await jsonRequest(fetcher, `${BASE}/upload/signed-url`, config.key, {
    method: 'POST', body: JSON.stringify({ assetType: 'datasets', assetId: datasetId,
      filename: `${prefix}.tar.gz`, contentType: 'application/gzip', totalBytes: archive.length }),
  });
  if (!upload.sessionId || !upload.uploadUrl || new URL(upload.uploadUrl).protocol !== 'https:') throw new Error('Invalid signed upload response.');
  const put = await fetcher(upload.uploadUrl, { method: 'PUT', body: archive, signal: AbortSignal.timeout(25_000),
    headers: { 'Content-Type': 'application/gzip', ...(upload.headers || {}) } });
  if (!put.ok) throw new Error(`Ultralytics upload returned ${put.status}.`);
  await jsonRequest(fetcher, `${BASE}/upload/complete`, config.key, {
    method: 'POST', body: JSON.stringify({ sessionId: upload.sessionId }),
  });
  const metadata = Object.fromEntries(entries.map(([name], index) => [name, {
    retailFlowBarcode: String(product.barcode).slice(0, 128), view: VIEWS[index],
  }]));
  const ingest = await jsonRequest(fetcher, `${datasetUrl}/ingest`, config.key, {
    method: 'POST', body: JSON.stringify({ sessionId: upload.sessionId, targetSplit: 'train', imageMetadata: metadata,
      conflictPolicy: 'skip' }),
  });
  if (!ingest.jobId) throw new Error('Ultralytics did not queue the dataset ingest.');
  return { status: 'queued', hash: refs.hash, jobId: ingest.jobId };
}

module.exports = { settings, referenceSet, tarGzip, uploadReferences };
