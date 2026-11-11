'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db } = require('./db');

// ---------- סיסמאות: scrypt עם salt ייחודי ----------
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw.normalize('NFKC'), salt, 64, SCRYPT, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}
// השוואה בזמן קבוע. כשהמשתמש לא קיים עדיין מחשבים hash כדי לא לחשוף קיום משתמשים בתזמון.
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
function verifyPassword(pw, stored) {
  return new Promise((resolve) => {
    const parts = String(stored || DUMMY_HASH).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, N, r, p, saltB64, keyB64] = parts;
    const expected = Buffer.from(keyB64, 'base64');
    crypto.scrypt(String(pw).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length,
      { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem }, (err, key) => {
        if (err) return resolve(false);
        resolve(crypto.timingSafeEqual(key, expected) && stored !== undefined && stored !== null);
      });
  });
}

const COMMON = new Set(['123456789012', 'password1234', 'qwertyuiop12', 'aaaaaaaaaaaa', '111111111111', 'admin1234567', 'Aa123456789!', 'P@ssw0rd1234']);
function passwordProblems(pw, username) {
  const errs = [];
  if (typeof pw !== 'string' || pw.length < 12) errs.push('לפחות 12 תווים');
  if (typeof pw === 'string' && pw.length > 128) errs.push('עד 128 תווים');
  if (!/[a-zא-ת]/i.test(pw || '') || !/\d/.test(pw || '')) errs.push('לשלב אותיות וספרות');
  if (COMMON.has(pw) || (username && String(pw).toLowerCase().includes(String(username).toLowerCase()))) errs.push('סיסמה נפוצה או מכילה את שם המשתמש');
  return errs;
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- כותרות אבטחה ----------
// עמוד המפה (map.html) הוא היחיד שמותר לו לטעון את GovMap, ורק בתוך האתר עצמו (iframe מאותו מקור)
const GOVMAP = 'https://www.govmap.gov.il https://*.govmap.gov.il';
function securityHeaders(res, { isHtml = false, map = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', map ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (map) res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Content-Security-Policy', map
    ? `default-src 'self'; script-src 'self' ${GOVMAP}; style-src 'self' 'unsafe-inline' ${GOVMAP}; img-src 'self' data: blob: ${GOVMAP}; font-src 'self' data: ${GOVMAP}; ` +
      `connect-src 'self' ${GOVMAP}; frame-src ${GOVMAP}; worker-src blob:; form-action 'none'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'` + (config.forceHttps ? '; upgrade-insecure-requests' : '')
    : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; form-action 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'" +
    (config.forceHttps ? '; upgrade-insecure-requests' : ''));
  if (config.forceHttps) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  if (!isHtml) res.setHeader('Cache-Control', 'no-store');
}

// ---------- הגבלת קצב ----------
// ברירת מחדל בזיכרון (מהיר). הגבלות על כניסה, איפוס וסיסמה נשמרות במסד (persist) –
// לא מתאפסות בהפעלה מחדש של השרת ומשותפות לכל תהליך שמשתמש באותו מסד.
db.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)');
const rlGet = db.prepare('SELECT start, count FROM rate_limits WHERE key = ?');
const rlSet = db.prepare('INSERT INTO rate_limits (key, start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET start = excluded.start, count = excluded.count');
const buckets = new Map();
function rateLimit(key, limit, windowMs, { persist = false } = {}) {
  const now = Date.now();
  let b = persist ? rlGet.get(key) : buckets.get(key);
  if (!b || now - b.start > windowMs) b = { start: now, count: 0 };
  b = { start: b.start, count: b.count + 1 };
  if (persist) rlSet.run(key, b.start, b.count); else buckets.set(key, b);
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.start + windowMs - now) / 1000) };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > 60 * 60 * 1000) buckets.delete(k);
  db.prepare('DELETE FROM rate_limits WHERE start < ?').run(now - 24 * 3600 * 1000);
}, 10 * 60 * 1000).unref();

// ---------- יומן פעילות ואבטחה ----------
const secLog = path.join(config.logDir, 'security.log');
const insAudit = db.prepare('INSERT INTO audit_log (user_id, username, action, severity, ip, details) VALUES (?, ?, ?, ?, ?, ?)');
function audit(req, action, details = {}, severity = 'info') {
  const u = req && req.user;
  const ip = req ? clientIp(req) : null;
  const det = JSON.stringify(details).slice(0, 4000);
  try { insAudit.run(u ? u.id : null, u ? u.username : (details.username || null), action, severity, ip, det); } catch { /* ignore */ }
  if (severity !== 'info') {
    fs.appendFile(secLog, `${new Date().toISOString()}\t${severity}\t${action}\t${ip}\t${u ? u.username : '-'}\t${det}\n`, { mode: 0o600 }, () => {});
  }
}

function clientIp(req) {
  if (config.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

// ---------- ניקוי וולידציה ----------
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function str(v, { max = 500, required = false, name = 'שדה', pattern } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${name}: שדה חובה`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new ValidationError(`${name}: ערך לא תקין`);
  const s = String(v).replace(CTRL, '').trim();
  if (required && !s) throw new ValidationError(`${name}: שדה חובה`);
  if (s.length > max) throw new ValidationError(`${name}: עד ${max} תווים`);
  if (pattern && s && !pattern.test(s)) throw new ValidationError(`${name}: פורמט לא תקין`);
  return s || null;
}
function num(v, { min = 0, max = 1e12, required = false, name = 'מספר' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${name}: שדה חובה`);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name}: מספר בין ${min} ל-${max}`);
  return Math.round(n * 100) / 100;
}
function id(v, { required = false, name = 'מזהה' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${name}: שדה חובה`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 31) throw new ValidationError(`${name}: לא תקין`);
  return n;
}
function date(v, { required = false, name = 'תאריך' } = {}) {
  const s = str(v, { max: 10, required, name, pattern: /^\d{4}-\d{2}-\d{2}$/ });
  if (s && Number.isNaN(Date.parse(s))) throw new ValidationError(`${name}: תאריך לא תקין`);
  return s;
}
function oneOf(v, list, { required = false, name = 'ערך' } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return null;
  if (!list.includes(v)) throw new ValidationError(`${name}: ערך לא מותר`);
  return v;
}
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
class ValidationError extends Error { constructor(m) { super(m); this.status = 400; this.expose = true; } }
class HttpError extends Error { constructor(status, m) { super(m); this.status = status; this.expose = true; } }

module.exports = {
  hashPassword, verifyPassword, passwordProblems, randomToken, sha256,
  securityHeaders, rateLimit, audit, clientIp,
  v: { str, num, id, date, oneOf, EMAIL }, ValidationError, HttpError,
};
