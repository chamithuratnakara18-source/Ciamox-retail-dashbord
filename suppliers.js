const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const MAX_BODY_BYTES = 180_000;
const MAX_NAME_LENGTH = 120;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function requireOwner(req, app) {
  if (process.env.VERCEL_ENV === 'preview' && process.env.RETAILFLOW_PREVIEW_NO_AUTH === 'true') {
    return { uid: 'preview-development', email: 'preview-development@local.invalid', retailRole: 'owner' };
  }
  const allowed = String(process.env.RETAILFLOW_ALLOWED_EMAILS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) fail(503, 'Backend owner access is not configured.');
  const match = /^Bearer (\S+)$/i.exec(String(req.headers.authorization || ''));
  if (!match) fail(401, 'Sign in with an approved Google account first.');
  let claims;
  try { claims = await getAuth(app).verifyIdToken(match[1], true); }
  catch { fail(401, 'Your sign-in expired. Sign in again.'); }
  const email = String(claims.email || '').toLowerCase();
  if (!claims.email_verified || !allowed.includes(email) || claims.firebase?.sign_in_provider !== 'google.com') {
    fail(403, 'This account is not approved for store changes.');
  }
  return { uid: claims.uid, email, retailRole: 'owner' };
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function firestore() {
  const app = getApps()[0] || initializeAdminApp();
  return getFirestore(app);
}

function initializeAdminApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) fail(503, 'Backend is not configured with Firebase Admin credentials.');

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    fail(503, 'Firebase Admin credentials are invalid.');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!serviceAccount.project_id || (projectId && serviceAccount.project_id !== projectId)) {
    fail(503, 'Firebase Admin credentials do not match the configured project.');
  }

  return initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
}

function supplierRef(db, name) {
  const key = name.normalize('NFC').trim().toLocaleLowerCase();
  return db.collection('suppliers').doc(encodeURIComponent(key));
}

function normalizeText(value, label, max = MAX_NAME_LENGTH) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(400, `${label} must be text.`);
  }
  const result = value.trim().normalize('NFC');
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return result;
}

function requiredText(value, label, max = MAX_NAME_LENGTH) {
  const result = normalizeText(value, label, max);
  if (!result) fail(400, `${label} is required.`);
  return result;
}

function optionalNumber(value, label, min, max) {
  if (value == null || value === '') return null;
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) {
    fail(400, `Enter a valid ${label}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    fail(400, `Enter a valid ${label} between ${min} and ${max}.`);
  }
  return parsed;
}

function requestBody(req) {
  const body = req.body ?? {};
  if (!body || (typeof body !== 'string' && (typeof body !== 'object' || Array.isArray(body)))) {
    fail(400, 'Request body must be a JSON object.');
  }
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) fail(413, 'Request is too large.');
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body || '{}') : body;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Request body must be a JSON object.');
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, 'Request body must be valid JSON.');
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return origin === `${proto}://${host}`;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  return !origin || sameOrigin(req) || (process.env.RETAILFLOW_SCANNER_ORIGIN && origin === process.env.RETAILFLOW_SCANNER_ORIGIN);
}

function setHeaders(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const origin = req.headers.origin;
  if (origin && originAllowed(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

async function saveSupplier(db, body, user) {
  const name = requiredText(body.name, 'Supplier name');
  const city = normalizeText(body.city, 'City');
  const country = normalizeText(body.country, 'Country');
  const supplierType = normalizeText(body.supplierType, 'Supplier type', 80);
  const latitude = optionalNumber(body.latitude, 'latitude', -90, 90);
  const longitude = optionalNumber(body.longitude, 'longitude', -180, 180);
  const leadTimeDays = optionalNumber(body.leadTimeDays, 'lead time', 0, 3650);
  const qualityScore = optionalNumber(body.qualityScore, 'quality score', 0, 100);
  const defectRate = optionalNumber(body.defectRate, 'defect rate', 0, 100);
  if ((latitude == null) !== (longitude == null)) {
    fail(400, 'Enter both latitude and longitude to place the supplier on the map.');
  }

  const key = name.toLocaleLowerCase();
  const profile = { key, name, city, country, supplierType, latitude, longitude, leadTimeDays, qualityScore, defectRate };
  const ref = supplierRef(db, name);
  await db.runTransaction(async transaction => {
    const existing = (await transaction.get(ref)).data();
    transaction.set(ref, {
      ...profile,
      archived: false,
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      actorUid: user.uid,
      actorEmail: user.email,
      action: existing ? 'supplier.update' : 'supplier.create',
      target: ref.id,
      detail: { city: Boolean(city), country: Boolean(country), hasCoordinates: latitude != null },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { supplier: profile };
}

async function archiveSupplier(db, body, user) {
  const name = requiredText(body.name, 'Supplier name');
  const key = name.toLocaleLowerCase();
  const ref = supplierRef(db, name);
  await db.runTransaction(async transaction => {
    const existing = (await transaction.get(ref)).data();
    transaction.set(ref, {
      ...existing,
      key,
      name: existing?.name || name,
      archived: true,
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      actorUid: user.uid, actorEmail: user.email, action: 'supplier.archive', target: ref.id,
      detail: {}, createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { supplier: { key, name, archived: true } };
}

module.exports = async function suppliersHandler(req, res) {
  setHeaders(req, res);
  if (!originAllowed(req)) return res.status(403).json({ error: 'Cross-origin requests are not accepted.' });

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }

  const method = String(req.method || '').toUpperCase();
  if (method === 'GET') {
    try {
      const snapshot = await firestore().collection('suppliers').get();
      const suppliers = snapshot.docs.map(doc => {
        const profile = doc.data() || {};
        return {
          key: String(profile.key || profile.name || '').normalize('NFC').trim().toLocaleLowerCase(),
          name: String(profile.name || ''),
          city: profile.city || '',
          country: profile.country || '',
          supplierType: profile.supplierType || '',
          latitude: profile.latitude ?? null,
          longitude: profile.longitude ?? null,
          leadTimeDays: profile.leadTimeDays ?? null,
          qualityScore: profile.qualityScore ?? null,
          defectRate: profile.defectRate ?? null,
          archived: profile.archived === true,
        };
      });
      return res.status(200).json({ suppliers });
    } catch (error) {
      console.error('RetailFlow supplier profile read failed:', error?.message || 'unknown error');
      return res.status(503).json({ error: 'Supplier profiles could not be loaded from the backend.' });
    }
  }
  if (!['POST', 'DELETE'].includes(method)) {
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    return res.status(405).json({ error: 'Use GET to load, POST to save, or DELETE to remove a supplier.' });
  }

  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Request is too large.' });
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Use application/json for API requests.' });
  }

  try {
    const body = requestBody(req);
    const db = firestore();
    const user = await requireOwner(req, getApps()[0]);
    const result = method === 'POST' ? await saveSupplier(db, body, user) : await archiveSupplier(db, body, user);
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error('RetailFlow supplier API operation failed:', error?.message || 'unknown error');
    const message = status === 503 && error instanceof HttpError
      ? error.message
      : status >= 500 ? 'The server could not complete this request.' : error.message;
    return res.status(status).json({ error: message });
  }
};
