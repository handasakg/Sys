'use strict';
const config = require('./config');
const { db } = require('./db');
const { randomToken, sha256, HttpError } = require('./security');
const { KEYS } = require('./permissions');

const COOKIE = config.forceHttps ? '__Host-sid' : 'sid';

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// maxAgeSec = null → עוגיית דפדפן שנמחקת כשהדפדפן נסגר (בלי "זכור אותי")
function cookieAttrs(maxAgeSec) {
  return `Path=/; HttpOnly; SameSite=Strict${config.forceHttps ? '; Secure' : ''}${maxAgeSec === null ? '' : `; Max-Age=${maxAgeSec}`}`;
}
function limits(s) {
  return s.remember ? { idle: config.rememberIdleDays * 86400000, abs: config.rememberDays * 86400000 }
    : { idle: config.sessionIdleMinutes * 60000, abs: config.sessionAbsoluteHours * 3600000 };
}

function createSession(res, userId, req, remember = false) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created, last_seen, ip, ua, remember) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, csrf, now, now, req.socket.remoteAddress || '', String(req.headers['user-agent'] || '').slice(0, 200), remember ? 1 : 0);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs(remember ? config.rememberDays * 86400 : null)}`);
  return csrf;
}

function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`);
}

function effectivePerms(user) {
  const role = db.prepare('SELECT perms FROM roles WHERE id = ?').get(user.role_id);
  const set = new Set(role ? JSON.parse(role.perms) : []);
  for (const p of JSON.parse(user.perm_grant || '[]')) if (KEYS.has(p)) set.add(p);
  for (const p of JSON.parse(user.perm_deny || '[]')) set.delete(p);
  return set;
}

function loadSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const h = sha256(token);
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h);
  if (!s) return null;
  const now = Date.now();
  const lim = limits(s);
  if (now - s.last_seen > lim.idle || now - s.created > lim.abs) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!user || !user.active) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  if (now - s.last_seen > 60000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, h);
  user.perms = effectivePerms(user);
  return { session: s, user };
}

function requireAuth(req) {
  if (!req.user) throw new HttpError(401, 'נדרשת התחברות');
  if (req.user.must_change_pw && !req.allowPwChange) throw new HttpError(403, 'יש להחליף סיסמה לפני המשך עבודה');
}
function can(req, perm) { return !!(req.user && req.user.perms.has(perm)); }
function requirePerm(req, ...perms) {
  requireAuth(req);
  if (!perms.some(p => req.user.perms.has(p))) {
    const e = new HttpError(403, 'אין הרשאה לפעולה זו');
    e.permDenied = perms.join('|');
    throw e;
  }
}

setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE remember = 0 AND created < ?').run(Date.now() - config.sessionAbsoluteHours * 3600000);
  db.prepare('DELETE FROM sessions WHERE remember = 1 AND created < ?').run(Date.now() - config.rememberDays * 86400000);
  db.prepare('DELETE FROM password_resets WHERE expires < ?').run(Date.now() - 86400000);
}, 15 * 60 * 1000).unref();

module.exports = { COOKIE, parseCookies, createSession, destroySession, loadSession, requireAuth, requirePerm, can, effectivePerms };
