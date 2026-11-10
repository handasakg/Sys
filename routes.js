'use strict';
const fs = require('node:fs');
const config = require('./config');
const { db, tx, getSetting, setSetting } = require('./db');
const sec = require('./security');
const { v, HttpError, audit } = sec;
const auth = require('./auth');
const { requireAuth, requirePerm, can } = auth;
const { PERMISSIONS, KEYS } = require('./permissions');
const W = require('./workflow');
const up = require('./uploads');
const backup = require('./backup');
const mailer = require('./mailer');

// ---------------- נתב ----------------
const table = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '/?$');
  table.push({ method, re, keys, handler });
}
function match(method, p) {
  for (const r of table) {
    if (r.method !== method) continue;
    const m = p.match(r.re);
    if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])])) };
  }
  return null;
}
const status = (code, body) => ({ __status: code, body });

// ---------------- עזר ----------------
const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
function addDays(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' '); }
function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, email: u.email, phone: u.phone, department: u.department,
    role_id: u.role_id, infra_body_id: u.infra_body_id, active: !!u.active, must_change_pw: !!u.must_change_pw,
    locked: !!(u.locked_until && u.locked_until > Date.now()), last_login: u.last_login, created_at: u.created_at,
    perm_grant: JSON.parse(u.perm_grant || '[]'), perm_deny: JSON.parse(u.perm_deny || '[]') };
}
function notify(userId, text, link) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)').run(userId, String(text).slice(0, 300), link || null);
}
function notifyPerm(perm, text, link, exceptId) {
  for (const u of db.prepare('SELECT * FROM users WHERE active = 1').all()) {
    if (u.id !== exceptId && auth.effectivePerms(u).has(perm)) notify(u.id, text, link);
  }
}
function history(requestId, userId, action, details) {
  db.prepare('INSERT INTO request_history (request_id, user_id, action, details) VALUES (?, ?, ?, ?)')
    .run(requestId, userId, action, details ? String(details).slice(0, 2000) : null);
}
function permsList(req) { return [...req.user.perms]; }

// ---------------- אימות משתמשים ----------------
route('GET', '/api/health', () => ({ ok: true }));

route('POST', '/api/auth/login', async (req, res) => {
  const ip = sec.clientIp(req);
  const username = v.str(req.body.username, { max: 60, required: true, name: 'שם משתמש' });
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 256) : '';
  const rlIp = sec.rateLimit('login-ip:' + ip, 20, 15 * 60000, { persist: true });
  const rlUser = sec.rateLimit('login-user:' + username.toLowerCase(), 10, 15 * 60000, { persist: true });
  if (!rlIp.ok || !rlUser.ok) {
    audit(req, 'login_rate_limited', { username }, 'warning');
    res.setHeader('Retry-After', Math.max(rlIp.retryAfter, rlUser.retryAfter));
    return status(429, { error: 'יותר מדי ניסיונות התחברות. נסו שוב מאוחר יותר.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = await sec.verifyPassword(password, user ? user.password_hash : null);
  if (user && user.locked_until && user.locked_until > Date.now()) {
    audit(req, 'login_locked_account', { username }, 'warning');
    return status(401, { error: 'שם משתמש או סיסמה שגויים, או שהחשבון נעול זמנית' });
  }
  if (!user || !ok || !user.active) {
    if (user) {
      const fails = user.failed_attempts + 1;
      const lock = fails >= 5 ? Date.now() + 15 * 60000 : null;
      db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id);
      if (lock) audit(req, 'account_locked', { username }, 'critical');
    }
    audit(req, 'login_failed', { username }, 'warning');
    return status(401, { error: 'שם משתמש או סיסמה שגויים, או שהחשבון נעול זמנית' });
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = ? WHERE id = ?').run(nowIso(), user.id);
  auth.destroySession(req, res); // סשן חדש בכל התחברות
  const remember = req.body.remember === true;
  const csrf = auth.createSession(res, user.id, req, remember);
  req.user = user;
  audit(req, 'login_success', { remember });
  return { ok: true, csrf, must_change_pw: !!user.must_change_pw };
});

route('POST', '/api/auth/logout', (req, res) => {
  if (req.user) audit(req, 'logout', {});
  auth.destroySession(req, res);
  return { ok: true };
});

route('GET', '/api/auth/me', (req) => {
  if (!req.user) return status(401, { error: 'לא מחובר', title: getSetting('org.system_title'), org: getSetting('org.name'), logo: getSetting('org.logo') || null });
  const u = req.user;
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(u.id).c;
  return { user: publicUser(u), perms: permsList(req), csrf: req.session.csrf, prefs: JSON.parse(u.prefs || '{}'),
    title: getSetting('org.system_title'), org: getSetting('org.name'), logo: getSetting('org.logo') || null, unread,
    meta: { types: W.TYPES, statuses: W.STATUSES, tracks: W.TRACKS, trackStatus: W.TRACK_STATUS,
      files: { allowed: up.allowedExt(), maxMb: Math.round(up.maxBytes() / 1048576) } } };
});

route('POST', '/api/auth/change-password', async (req, res) => {
  req.allowPwChange = true; requireAuth(req);
  const rl = sec.rateLimit('pwchange:' + req.user.id, 5, 15 * 60000, { persist: true });
  if (!rl.ok) return status(429, { error: 'יותר מדי ניסיונות' });
  const current = String(req.body.current || '').slice(0, 256);
  const next = String(req.body.next || '').slice(0, 256);
  if (!(await sec.verifyPassword(current, req.user.password_hash))) { audit(req, 'password_change_failed', {}, 'warning'); return status(400, { error: 'הסיסמה הנוכחית שגויה' }); }
  const probs = sec.passwordProblems(next, req.user.username);
  if (probs.length) return status(400, { error: 'סיסמה חלשה: ' + probs.join(', ') });
  const hash = await sec.hashPassword(next);
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').run(hash, req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id); // ניתוק כל ההתחברויות
  const csrf = auth.createSession(res, req.user.id, req, !!req.session.remember);
  audit(req, 'password_changed', {});
  return { ok: true, csrf };
});

function createResetLink(userId, createdBy) {
  const token = sec.randomToken(32);
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(userId); // קישור קודם מבוטל
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires, created_by) VALUES (?, ?, ?, ?)').run(sec.sha256(token), userId, Date.now() + config.resetTokenMinutes * 60000, createdBy);
  return `${config.publicUrl}/#/reset?token=${token}`;
}

// "שכחתי סיסמה": תשובה זהה תמיד (לא חושף אם המשתמש קיים).
// אם הוגדר SMTP ולמשתמש יש דוא"ל – נשלח אליו קישור איפוס. אחרת (או אם השליחה נכשלה) – מנהלי המשתמשים מקבלים התראה.
route('POST', '/api/auth/forgot', (req) => {
  const username = v.str(req.body.username, { max: 60, required: true, name: 'שם משתמש' });
  const rl = sec.rateLimit('forgot:' + sec.clientIp(req), 5, 60 * 60000, { persist: true });
  if (!rl.ok) return status(429, { error: 'יותר מדי בקשות' });
  const user = db.prepare('SELECT id, full_name, email FROM users WHERE username = ? AND active = 1').get(username);
  audit(req, 'password_reset_requested', { username, exists: !!user }, user ? 'info' : 'warning');
  if (user) {
    const toAdmins = () => notifyPerm('admin.users', `בקשת איפוס סיסמה: ${user.full_name} (${username})`, '#/admin/users');
    if (user.email && mailer.isConfigured()) {
      const link = createResetLink(user.id, null);
      // השליחה רצה ברקע כדי שזמן התגובה לא יחשוף אם המשתמש קיים
      mailer.send({ to: user.email, subject: 'איפוס סיסמה – ' + getSetting('org.system_title'),
        text: `שלום ${user.full_name},\n\nהתקבלה בקשה לאיפוס הסיסמה שלך.\nלבחירת סיסמה חדשה: ${link}\n\nהקישור חד-פעמי ותקף ${config.resetTokenMinutes} דקות.\nאם לא ביקשת איפוס, אפשר להתעלם מהודעה זו.` })
        .then(() => audit(req, 'reset_email_sent', { username }))
        .catch((e) => { audit(req, 'reset_email_failed', { username, error: e.message }, 'error'); toAdmins(); });
    } else toAdmins();
  }
  return { ok: true, message: `אם המשתמש קיים, נשלח קישור איפוס לדוא"ל הרשום שלו (או שהבקשה הועברה למנהל המערכת). הקישור תקף ${config.resetTokenMinutes} דקות.` };
});

route('POST', '/api/auth/reset', async (req) => {
  const rl = sec.rateLimit('reset:' + sec.clientIp(req), 10, 60 * 60000, { persist: true });
  if (!rl.ok) return status(429, { error: 'יותר מדי ניסיונות' });
  const token = v.str(req.body.token, { max: 100, required: true, name: 'קישור' });
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sec.sha256(token));
  if (!row || row.used || row.expires < Date.now()) { audit(req, 'password_reset_invalid', {}, 'warning'); return status(400, { error: 'קישור האיפוס פג תוקף או כבר נוצל' }); }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const probs = sec.passwordProblems(req.body.password, user.username);
  if (probs.length) return status(400, { error: 'סיסמה חלשה: ' + probs.join(', ') });
  const hash = await sec.hashPassword(req.body.password);
  tx(() => {
    db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(user.id);
    db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  });
  req.user = user; audit(req, 'password_reset_completed', {});
  return { ok: true };
});

route('PUT', '/api/me/prefs', (req) => {
  requireAuth(req);
  const p = req.body.prefs || {};
  const clean = {};
  const allowed = { theme: 30, mode: 10, shape: 10, style: 12, density: 12, font: 20, fontSize: 4, accent: 7, motion: 10, sidebar: 12, contrast: 10, bg: 12, width: 10, header: 10, chartTexture: 4, chartGrid: 4, chartAnim: 4 };
  for (const [k, max] of Object.entries(allowed)) if (p[k] !== undefined) clean[k] = v.str(String(p[k]), { max, name: k, pattern: /^[#\w-]+$/ });
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(clean), req.user.id);
  return { ok: true, prefs: clean };
});

// ---------------- בקשות תיאום ----------------
function loadRequest(id) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'הבקשה לא נמצאה');
  return r;
}
function canViewRequest(req, r) {
  const u = req.user;
  if (u.perms.has('requests.view_all')) return true;
  if (!u.perms.has('requests.view_own') && !u.perms.has('approvals.decide')) return false;
  if (r.applicant_id === u.id || r.assignee_id === u.id) return true;
  if (u.infra_body_id && db.prepare('SELECT 1 FROM request_approvals WHERE request_id = ? AND infra_body_id = ?').get(r.id, u.infra_body_id)) return true;
  return false;
}
function assertView(req, r) {
  if (!canViewRequest(req, r)) { const e = new HttpError(404, 'הבקשה לא נמצאה'); throw e; } // 404 ולא 403 – לא חושפים קיום
}
function canEditRequest(req, r) {
  if (can(req, 'requests.edit_all')) return true;
  return can(req, 'requests.edit_own') && r.applicant_id === req.user.id && ['draft', 'returned'].includes(r.status);
}
function requestFields(b) {
  return {
    type: v.oneOf(b.type, Object.keys(W.TYPES), { required: true, name: 'סוג בקשה' }),
    title: v.str(b.title, { max: 200, required: true, name: 'נושא' }),
    description: v.str(b.description, { max: 5000, name: 'תיאור' }),
    address: v.str(b.address, { max: 300, name: 'כתובת' }),
    gush: v.str(b.gush, { max: 20, name: 'גוש', pattern: /^[\d\s-]*$/ }),
    helka: v.str(b.helka, { max: 20, name: 'חלקה', pattern: /^[\d\s-]*$/ }),
    project_id: v.id(b.project_id, { name: 'פרויקט' }),
    planned_start: v.date(b.planned_start, { name: 'תאריך התחלה' }),
    planned_end: v.date(b.planned_end, { name: 'תאריך סיום' }),
  };
}
// מספור בקשות לפי ההגדרות בלוח הבקרה: קידומת, שנה, מספר ספרות, ומספר הבא (אפשר לקבוע ידנית)
function numberPrefix() {
  const pre = getSetting('requests.prefix') || '';
  return getSetting('requests.with_year') === '1' ? `${pre ? pre + '-' : ''}${new Date().getFullYear()}-` : (pre ? pre + '-' : '');
}
function nextRequestNumber() {
  const prefix = numberPrefix(); const pad = parseInt(getSetting('requests.pad'), 10) || 4;
  const forced = parseInt(getSetting('requests.next') || '0', 10);
  let max = 0;
  for (const r of db.prepare("SELECT number FROM requests WHERE substr(number, 1, ?) = ?").all(prefix.length, prefix)) {
    const n = parseInt(r.number.slice(prefix.length), 10); if (Number.isFinite(n) && n > max) max = n;
  }
  let n = Math.max(max + 1, forced || 0);
  while (db.prepare('SELECT 1 FROM requests WHERE number = ?').get(prefix + String(n).padStart(pad, '0'))) n++;
  if (forced && n >= forced) setSetting('requests.next', '0');
  return prefix + String(n).padStart(pad, '0');
}
function slaDays(track, trackStatus) {
  return parseInt(getSetting(track === 'fast' && trackStatus === 'approved' ? 'sla.fast_days' : 'sla.regular_days'), 10) || 14;
}
function decorate(r) {
  const overdue = r.due_at && W.OPEN_STATUSES.includes(r.status) && r.due_at < nowIso();
  return { ...r, overdue: !!overdue };
}
const REQ_SELECT = `SELECT r.*, a.full_name AS applicant_name, s.full_name AS assignee_name, p.name AS project_name,
  (SELECT COUNT(*) FROM request_approvals x WHERE x.request_id = r.id) AS approvals_total,
  (SELECT COUNT(*) FROM request_approvals x WHERE x.request_id = r.id AND x.decision = 'approved') AS approvals_done
  FROM requests r JOIN users a ON a.id = r.applicant_id LEFT JOIN users s ON s.id = r.assignee_id LEFT JOIN projects p ON p.id = r.project_id`;

route('GET', '/api/requests', (req) => {
  requirePerm(req, 'requests.view_own', 'requests.view_all', 'approvals.decide');
  const q = req.query; const u = req.user;
  const where = []; const params = [];
  const scope = ['mine', 'assigned', 'all', 'pending_me'].includes(q.scope) ? q.scope : 'mine';
  if (scope === 'mine') { where.push('r.applicant_id = ?'); params.push(u.id); }
  else if (scope === 'assigned') { where.push('r.assignee_id = ?'); params.push(u.id); }
  else if (scope === 'pending_me') {
    where.push(`(r.assignee_id = ? AND r.status IN ('submitted','review','coordination')) OR r.id IN (SELECT request_id FROM request_approvals WHERE infra_body_id = ? AND decision = 'pending')`);
    params.push(u.id, u.infra_body_id || -1);
  } else if (!u.perms.has('requests.view_all')) {
    where.push(`(r.applicant_id = ? OR r.assignee_id = ? OR r.id IN (SELECT request_id FROM request_approvals WHERE infra_body_id = ?))`);
    params.push(u.id, u.id, u.infra_body_id || -1);
  }
  if (q.status && W.STATUSES[q.status]) { where.push('r.status = ?'); params.push(q.status); }
  if (q.type && W.TYPES[q.type]) { where.push('r.type = ?'); params.push(q.type); }
  if (q.track && W.TRACKS[q.track]) { where.push('r.track = ?'); params.push(q.track); }
  if (q.project_id) { where.push('r.project_id = ?'); params.push(v.id(q.project_id)); }
  if (q.q) {
    const term = '%' + v.str(q.q, { max: 100 }).replace(/[%_\\]/g, '\\$&') + '%';
    where.push(`(r.title LIKE ? ESCAPE '\\' OR r.number LIKE ? ESCAPE '\\' OR r.address LIKE ? ESCAPE '\\')`); params.push(term, term, term);
  }
  const rows = db.prepare(`${REQ_SELECT} ${where.length ? 'WHERE ' + where.map(w => `(${w})`).join(' AND ') : ''} ORDER BY r.updated_at DESC LIMIT 500`).all(...params);
  // סינון נוסף לביטחון: רק מה שמותר לראות
  return { items: rows.filter(r => canViewRequest(req, r)).map(decorate), scope };
});

route('POST', '/api/requests', (req) => {
  requirePerm(req, 'requests.create');
  const f = requestFields(req.body);
  if (f.project_id && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(f.project_id)) throw new sec.ValidationError('פרויקט לא קיים');
  if (f.planned_start && f.planned_end && f.planned_end < f.planned_start) throw new sec.ValidationError('תאריך סיום לפני תאריך התחלה');
  const wantFast = req.body.track === 'fast';
  const submit = req.body.submit === true;
  const fastReason = v.str(req.body.fast_reason, { max: 1000, name: 'נימוק למסלול מזורז', required: wantFast });
  const r = tx(() => {
    const number = nextRequestNumber();
    const info = db.prepare(`INSERT INTO requests (number, type, title, description, address, gush, helka, project_id, applicant_id, status, track, track_status,
      planned_start, planned_end, submitted_at, due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(number, f.type, f.title, f.description, f.address, f.gush, f.helka, f.project_id, req.user.id, submit ? 'submitted' : 'draft',
        wantFast ? 'fast' : 'regular', wantFast ? 'pending' : 'none', f.planned_start, f.planned_end,
        submit ? nowIso() : null, submit ? addDays(slaDays('regular', 'none')) : null);
    const id = Number(info.lastInsertRowid);
    history(id, req.user.id, 'נוצרה', submit ? 'הבקשה הוגשה' : 'נשמרה כטיוטה');
    if (wantFast) { history(id, req.user.id, 'בקשה למסלול מזורז', fastReason); notifyPerm('requests.approve_track', `בקשה ${number} ממתינה לאישור מסלול מזורז`, `#/requests/${id}`, req.user.id); }
    if (submit) notifyPerm('requests.assign', `בקשה חדשה הוגשה: ${number} – ${f.title}`, `#/requests/${id}`, req.user.id);
    return { id, number };
  });
  audit(req, 'request_created', r);
  return status(201, r);
});

route('GET', '/api/requests/:id', (req) => {
  requireAuth(req);
  const r = db.prepare(`${REQ_SELECT} WHERE r.id = ?`).get(req.params.id);
  if (!r) throw new HttpError(404, 'הבקשה לא נמצאה');
  assertView(req, r);
  const approvals = db.prepare(`SELECT ra.*, b.name AS body_name, u.full_name AS decided_by_name FROM request_approvals ra
    JOIN infra_bodies b ON b.id = ra.infra_body_id LEFT JOIN users u ON u.id = ra.decided_by WHERE ra.request_id = ? ORDER BY b.name`).all(r.id);
  const hist = db.prepare(`SELECT h.*, u.full_name AS user_name FROM request_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.request_id = ? ORDER BY h.id DESC`).all(r.id);
  const docs = db.prepare(`SELECT d.id, d.original_name, d.size, d.mime, d.category, d.created_at, d.uploaded_by, u.full_name AS uploaded_by_name
    FROM documents d JOIN users u ON u.id = d.uploaded_by WHERE d.request_id = ? ORDER BY d.id DESC`).all(r.id);
  const tasks = db.prepare(`SELECT t.*, u.full_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.request_id = ? ORDER BY t.id DESC`).all(r.id);
  const transitions = Object.entries(W.TRANSITIONS[r.status] || {}).filter(([, perm]) =>
    perm === 'applicant' ? (r.applicant_id === req.user.id || can(req, 'requests.edit_all')) : can(req, perm)).map(([to]) => to);
  return { request: decorate(r), approvals, history: hist, documents: docs, tasks, transitions,
    can: { edit: canEditRequest(req, r), delete: can(req, 'requests.delete'), assign: can(req, 'requests.assign'),
      approveTrack: can(req, 'requests.approve_track'), upload: can(req, 'files.upload'), decide: can(req, 'approvals.decide') } };
});

route('PUT', '/api/requests/:id', (req) => {
  requireAuth(req);
  const r = loadRequest(req.params.id); assertView(req, r);
  if (!canEditRequest(req, r)) throw new HttpError(403, 'אין הרשאה לערוך בקשה זו');
  const f = requestFields({ ...r, ...req.body });
  if (f.project_id && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(f.project_id)) throw new sec.ValidationError('פרויקט לא קיים');
  db.prepare(`UPDATE requests SET type=?, title=?, description=?, address=?, gush=?, helka=?, project_id=?, planned_start=?, planned_end=?, updated_at=? WHERE id=?`)
    .run(f.type, f.title, f.description, f.address, f.gush, f.helka, f.project_id, f.planned_start, f.planned_end, nowIso(), r.id);
  history(r.id, req.user.id, 'עודכנה', null);
  audit(req, 'request_updated', { id: r.id });
  return { ok: true };
});

route('DELETE', '/api/requests/:id', (req) => {
  requirePerm(req, 'requests.delete');
  const r = loadRequest(req.params.id);
  const files = db.prepare('SELECT stored_name FROM documents WHERE request_id = ?').all(r.id);
  db.prepare('DELETE FROM requests WHERE id = ?').run(r.id);
  for (const f of files) fs.rm(up.storedPath(f.stored_name), { force: true }, () => {});
  audit(req, 'request_deleted', { id: r.id, number: r.number }, 'warning');
  return { ok: true };
});

route('POST', '/api/requests/:id/number', (req) => {
  requirePerm(req, 'requests.edit_all');
  const r = loadRequest(req.params.id);
  const number = v.str(req.body.number, { max: 40, required: true, name: 'מספר בקשה', pattern: /^[A-Za-z0-9\u0590-\u05FF][A-Za-z0-9\u0590-\u05FF/_.-]{0,39}$/ });
  if (db.prepare('SELECT 1 FROM requests WHERE number = ? AND id != ?').get(number, r.id)) throw new sec.ValidationError('המספר כבר בשימוש בבקשה אחרת');
  db.prepare('UPDATE requests SET number = ?, updated_at = ? WHERE id = ?').run(number, nowIso(), r.id);
  history(r.id, req.user.id, 'מספר הבקשה שונה', `${r.number} ← ${number}`);
  audit(req, 'request_number_changed', { id: r.id, from: r.number, to: number }, 'notice');
  return { ok: true };
});

route('POST', '/api/requests/:id/status', (req) => {
  requireAuth(req);
  const r = loadRequest(req.params.id); assertView(req, r);
  const to = v.oneOf(req.body.status, Object.keys(W.STATUSES), { required: true, name: 'סטטוס' });
  const comment = v.str(req.body.comment, { max: 2000, name: 'הערה', required: ['returned', 'rejected'].includes(to) });
  const need = (W.TRANSITIONS[r.status] || {})[to];
  if (!need) throw new HttpError(400, `לא ניתן לעבור מ"${W.STATUSES[r.status]}" ל"${W.STATUSES[to]}"`);
  if (need === 'applicant' ? !(r.applicant_id === req.user.id || can(req, 'requests.edit_all')) : !can(req, need)) {
    const e = new HttpError(403, 'אין הרשאה לפעולה זו'); e.permDenied = need; throw e;
  }
  if (to === 'approved') {
    const pending = db.prepare("SELECT COUNT(*) AS c FROM request_approvals WHERE request_id = ? AND decision != 'approved'").get(r.id).c;
    if (pending) throw new HttpError(400, 'לא ניתן לאשר: יש גורמי תשתית שטרם אישרו');
  }
  const sets = { status: to, updated_at: nowIso() };
  if (to === 'submitted') { sets.submitted_at = nowIso(); sets.due_at = addDays(slaDays(r.track, r.track_status)); }
  if (to === 'closed' || to === 'approved' || to === 'rejected') sets.closed_at = nowIso();
  const cols = Object.keys(sets);
  db.prepare(`UPDATE requests SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map(c => sets[c]), r.id);
  history(r.id, req.user.id, `סטטוס: ${W.STATUSES[to]}`, comment);
  if (r.applicant_id !== req.user.id) notify(r.applicant_id, `בקשה ${r.number}: ${W.STATUSES[to]}`, `#/requests/${r.id}`);
  if (r.assignee_id && r.assignee_id !== req.user.id) notify(r.assignee_id, `בקשה ${r.number}: ${W.STATUSES[to]}`, `#/requests/${r.id}`);
  if (to === 'submitted' && !r.assignee_id) notifyPerm('requests.assign', `בקשה הוגשה: ${r.number}`, `#/requests/${r.id}`, req.user.id);
  audit(req, 'request_status', { id: r.id, from: r.status, to });
  return { ok: true };
});

route('POST', '/api/requests/:id/assign', (req) => {
  requirePerm(req, 'requests.assign');
  const r = loadRequest(req.params.id);
  const uid = v.id(req.body.assignee_id, { required: true, name: 'גורם מטפל' });
  const u = db.prepare('SELECT id, full_name FROM users WHERE id = ? AND active = 1').get(uid);
  if (!u) throw new sec.ValidationError('משתמש לא קיים');
  db.prepare('UPDATE requests SET assignee_id = ?, updated_at = ? WHERE id = ?').run(uid, nowIso(), r.id);
  history(r.id, req.user.id, 'הוקצתה לטיפול', u.full_name);
  notify(uid, `הוקצתה אליך בקשה ${r.number} – ${r.title}`, `#/requests/${r.id}`);
  audit(req, 'request_assigned', { id: r.id, to: uid });
  return { ok: true };
});

route('POST', '/api/requests/:id/track', (req) => {
  requirePerm(req, 'requests.approve_track');
  const r = loadRequest(req.params.id);
  const decision = v.oneOf(req.body.decision, ['approved', 'rejected'], { required: true, name: 'החלטה' });
  const comment = v.str(req.body.comment, { max: 1000, name: 'הערה' });
  const track = decision === 'approved' ? 'fast' : 'regular';
  const due = r.submitted_at ? new Date(new Date(r.submitted_at.replace(' ', 'T') + 'Z').getTime() + slaDays(track, decision) * 86400000).toISOString().slice(0, 19).replace('T', ' ') : null;
  db.prepare('UPDATE requests SET track = ?, track_status = ?, due_at = COALESCE(?, due_at), updated_at = ? WHERE id = ?').run(track, decision, due, nowIso(), r.id);
  history(r.id, req.user.id, decision === 'approved' ? 'מסלול מזורז אושר' : 'מסלול מזורז נדחה – מסלול רגיל', comment);
  notify(r.applicant_id, `בקשה ${r.number}: ${decision === 'approved' ? 'אושר מסלול מזורז' : 'המסלול המזורז נדחה'}`, `#/requests/${r.id}`);
  audit(req, 'request_track', { id: r.id, decision });
  return { ok: true };
});

route('POST', '/api/requests/:id/approvals', (req) => {
  requirePerm(req, 'requests.assign');
  const r = loadRequest(req.params.id);
  const ids = Array.isArray(req.body.infra_body_ids) ? req.body.infra_body_ids.slice(0, 50).map(x => v.id(x, { required: true })) : [];
  tx(() => {
    const existing = db.prepare('SELECT infra_body_id, decision FROM request_approvals WHERE request_id = ?').all(r.id);
    for (const e of existing) if (!ids.includes(e.infra_body_id) && e.decision === 'pending') db.prepare('DELETE FROM request_approvals WHERE request_id = ? AND infra_body_id = ?').run(r.id, e.infra_body_id);
    for (const bid of ids) {
      const b = db.prepare('SELECT id, name FROM infra_bodies WHERE id = ? AND active = 1').get(bid);
      if (!b) throw new sec.ValidationError('גורם תשתית לא קיים');
      const ins = db.prepare('INSERT OR IGNORE INTO request_approvals (request_id, infra_body_id) VALUES (?, ?)').run(r.id, bid);
      if (ins.changes) {
        for (const u of db.prepare('SELECT id FROM users WHERE infra_body_id = ? AND active = 1').all(bid)) notify(u.id, `נדרשת חוות דעתך לבקשה ${r.number}`, `#/requests/${r.id}`);
      }
    }
  });
  history(r.id, req.user.id, 'עודכנו גורמי תשתית נדרשים', null);
  audit(req, 'request_infra_set', { id: r.id, ids });
  return { ok: true };
});

route('POST', '/api/approvals/:id/decide', (req) => {
  requirePerm(req, 'approvals.decide');
  const a = db.prepare('SELECT * FROM request_approvals WHERE id = ?').get(req.params.id);
  if (!a) throw new HttpError(404, 'לא נמצא');
  // גורם תשתית מחליט רק עבור הגוף שלו; מאשר סופי (final_approve) רשאי להחליט עבור כולם
  if (req.user.infra_body_id !== a.infra_body_id && !can(req, 'requests.final_approve')) throw new HttpError(403, 'ניתן להחליט רק עבור הגוף שאליו אתה משויך');
  const decision = v.oneOf(req.body.decision, ['approved', 'rejected', 'conditions'], { required: true, name: 'החלטה' });
  const comment = v.str(req.body.comment, { max: 2000, name: 'הערה', required: decision !== 'approved' });
  const r = loadRequest(a.request_id);
  db.prepare('UPDATE request_approvals SET decision = ?, comment = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(decision, comment, req.user.id, nowIso(), a.id);
  db.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').run(nowIso(), r.id);
  const body = db.prepare('SELECT name FROM infra_bodies WHERE id = ?').get(a.infra_body_id);
  const label = { approved: 'אישר', rejected: 'דחה', conditions: 'אישר בתנאים' }[decision];
  history(r.id, req.user.id, `${body.name} ${label}`, comment);
  if (r.assignee_id) notify(r.assignee_id, `${body.name} ${label} את בקשה ${r.number}`, `#/requests/${r.id}`);
  notify(r.applicant_id, `${body.name} ${label} את בקשה ${r.number}`, `#/requests/${r.id}`);
  audit(req, 'approval_decided', { approval: a.id, decision });
  return { ok: true };
});

route('POST', '/api/requests/:id/comment', (req) => {
  requireAuth(req);
  const r = loadRequest(req.params.id); assertView(req, r);
  const text = v.str(req.body.text, { max: 2000, required: true, name: 'הערה' });
  history(r.id, req.user.id, 'הערה', text);
  return { ok: true };
});

// ---------------- מסמכים ----------------
function assertDocTarget(req, requestId, projectId) {
  if (requestId) { const r = loadRequest(requestId); assertView(req, r); return; }
  if (projectId) { requirePerm(req, 'projects.view'); if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new HttpError(404, 'פרויקט לא נמצא'); return; }
  throw new sec.ValidationError('יש לשייך את הקובץ לבקשה או לפרויקט');
}
route('POST', '/api/documents', async (req) => {
  requirePerm(req, 'files.upload');
  const rl = sec.rateLimit('upload:' + req.user.id, 60, 60 * 60000);
  if (!rl.ok) return status(429, { error: 'יותר מדי העלאות בשעה האחרונה' });
  let f;
  try { f = await up.handleUpload(req); }
  catch (e) { if (e.status === 415 || e.status === 413) audit(req, 'upload_rejected', { reason: e.message }, 'warning'); throw e; }
  try {
    const requestId = v.id(f.fields.request_id); const projectId = v.id(f.fields.project_id);
    assertDocTarget(req, requestId, projectId);
    const category = v.str(f.fields.category, { max: 60, name: 'קטגוריה' });
    const info = db.prepare('INSERT INTO documents (request_id, project_id, category, original_name, stored_name, mime, size, sha256, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(requestId, projectId, category, f.original, f.stored, f.mime, f.size, f.sha256, req.user.id);
    if (requestId) history(requestId, req.user.id, 'הועלה מסמך', f.original);
    audit(req, 'file_uploaded', { id: Number(info.lastInsertRowid), name: f.original, size: f.size });
    return status(201, { id: Number(info.lastInsertRowid) });
  } catch (e) { fs.rm(up.storedPath(f.stored), { force: true }, () => {}); throw e; }
});

function loadDoc(req) {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!d) throw new HttpError(404, 'לא נמצא');
  if (d.request_id) assertView(req, loadRequest(d.request_id));
  else requirePerm(req, 'projects.view');
  return d;
}
route('GET', '/api/documents', (req) => {
  requireAuth(req);
  const rows = db.prepare(`SELECT d.id, d.request_id, d.project_id, d.category, d.original_name, d.size, d.mime, d.created_at, d.uploaded_by,
    u.full_name AS uploaded_by_name, r.number AS request_number, p.name AS project_name
    FROM documents d JOIN users u ON u.id = d.uploaded_by LEFT JOIN requests r ON r.id = d.request_id LEFT JOIN projects p ON p.id = d.project_id ORDER BY d.id DESC LIMIT 1000`).all();
  const out = rows.filter(d => {
    if (d.request_id) { const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(d.request_id); return r && canViewRequest(req, r); }
    return can(req, 'projects.view');
  });
  return { items: out };
});
route('GET', '/api/documents/:id/download', (req, res) => {
  requirePerm(req, 'files.download');
  const d = loadDoc(req);
  const file = up.storedPath(d.stored_name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'הקובץ לא נמצא באחסון');
  const ascii = d.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.writeHead(200, {
    'Content-Type': d.mime, 'Content-Length': fs.statSync(file).size,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(file).pipe(res);
  audit(req, 'file_downloaded', { id: d.id });
});
route('DELETE', '/api/documents/:id', (req) => {
  requireAuth(req);
  const d = loadDoc(req);
  if (!(can(req, 'files.delete_all') || (can(req, 'files.delete_own') && d.uploaded_by === req.user.id))) throw new HttpError(403, 'אין הרשאה למחוק קובץ זה');
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  fs.rm(up.storedPath(d.stored_name), { force: true }, () => {});
  if (d.request_id) history(d.request_id, req.user.id, 'נמחק מסמך', d.original_name);
  audit(req, 'file_deleted', { id: d.id, name: d.original_name });
  return { ok: true };
});

// ---------------- פרויקטים, תקציב ----------------
function projectFields(b) {
  return {
    code: v.str(b.code, { max: 40, name: 'קוד פרויקט' }),
    name: v.str(b.name, { max: 200, required: true, name: 'שם פרויקט' }),
    description: v.str(b.description, { max: 5000, name: 'תיאור' }),
    status: v.oneOf(b.status || 'פעיל', ['תכנון', 'פעיל', 'מושהה', 'הושלם', 'בוטל'], { required: true, name: 'סטטוס' }),
    manager_id: v.id(b.manager_id, { name: 'מנהל פרויקט' }),
    start_date: v.date(b.start_date, { name: 'תאריך התחלה' }),
    end_date: v.date(b.end_date, { name: 'תאריך סיום' }),
    budget: v.num(b.budget ?? 0, { min: 0, max: 1e10, name: 'תקציב' }) || 0,
  };
}
const PROJ_SELECT = `SELECT p.*, u.full_name AS manager_name,
  (SELECT COALESCE(SUM(amount),0) FROM budget_entries b WHERE b.project_id = p.id AND kind = 'actual') AS spent,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS tasks_total,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'הושלמה') AS tasks_done,
  (SELECT COUNT(*) FROM requests r WHERE r.project_id = p.id) AS requests_total
  FROM projects p LEFT JOIN users u ON u.id = p.manager_id`;
route('GET', '/api/projects', (req) => { requirePerm(req, 'projects.view'); return { items: db.prepare(`${PROJ_SELECT} ORDER BY p.id DESC`).all() }; });
route('GET', '/api/projects/options', (req) => { requireAuth(req); return { items: db.prepare("SELECT id, name, code FROM projects WHERE status NOT IN ('בוטל') ORDER BY name").all() }; });
route('POST', '/api/projects', (req) => {
  requirePerm(req, 'projects.manage');
  const f = projectFields(req.body);
  if (f.start_date && f.end_date && f.end_date < f.start_date) throw new sec.ValidationError('תאריך סיום לפני תאריך התחלה');
  const info = db.prepare('INSERT INTO projects (code, name, description, status, manager_id, start_date, end_date, budget, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(f.code, f.name, f.description, f.status, f.manager_id, f.start_date, f.end_date, f.budget, req.user.id);
  audit(req, 'project_created', { id: Number(info.lastInsertRowid) });
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('GET', '/api/projects/:id', (req) => {
  requirePerm(req, 'projects.view');
  const p = db.prepare(`${PROJ_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!p) throw new HttpError(404, 'פרויקט לא נמצא');
  const tasks = can(req, 'tasks.view') ? db.prepare('SELECT t.*, u.full_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? ORDER BY t.due_date IS NULL, t.due_date').all(p.id) : [];
  const budget = can(req, 'budget.view') ? db.prepare('SELECT * FROM budget_entries WHERE project_id = ? ORDER BY entry_date DESC, id DESC').all(p.id) : null;
  const requests = db.prepare(`${REQ_SELECT} WHERE r.project_id = ? ORDER BY r.id DESC`).all(p.id).filter(r => canViewRequest(req, r)).map(decorate);
  const docs = db.prepare('SELECT d.id, d.original_name, d.size, d.category, d.created_at, d.uploaded_by, u.full_name AS uploaded_by_name FROM documents d JOIN users u ON u.id = d.uploaded_by WHERE d.project_id = ? ORDER BY d.id DESC').all(p.id);
  return { project: p, tasks, budget, requests, documents: docs };
});
route('PUT', '/api/projects/:id', (req) => {
  requirePerm(req, 'projects.manage');
  const cur = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!cur) throw new HttpError(404, 'פרויקט לא נמצא');
  const f = projectFields({ ...cur, ...req.body });
  if (!can(req, 'budget.manage')) f.budget = cur.budget; // שינוי מסגרת תקציב רק למורשי תקציב
  db.prepare('UPDATE projects SET code=?, name=?, description=?, status=?, manager_id=?, start_date=?, end_date=?, budget=? WHERE id=?')
    .run(f.code, f.name, f.description, f.status, f.manager_id, f.start_date, f.end_date, f.budget, cur.id);
  audit(req, 'project_updated', { id: cur.id });
  return { ok: true };
});
route('DELETE', '/api/projects/:id', (req) => {
  requirePerm(req, 'projects.manage');
  const files = db.prepare('SELECT stored_name FROM documents WHERE project_id = ?').all(req.params.id);
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (!info.changes) throw new HttpError(404, 'פרויקט לא נמצא');
  for (const f of files) fs.rm(up.storedPath(f.stored_name), { force: true }, () => {});
  audit(req, 'project_deleted', { id: req.params.id }, 'warning');
  return { ok: true };
});
route('POST', '/api/projects/:id/budget', (req) => {
  requirePerm(req, 'budget.manage');
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(req.params.id)) throw new HttpError(404, 'פרויקט לא נמצא');
  const kind = v.oneOf(req.body.kind, ['planned', 'actual'], { required: true, name: 'סוג' });
  const description = v.str(req.body.description, { max: 300, required: true, name: 'תיאור' });
  const amount = v.num(req.body.amount, { min: 0.01, max: 1e9, required: true, name: 'סכום' }); // סכום מאומת בשרת בלבד
  const entry_date = v.date(req.body.entry_date, { required: true, name: 'תאריך' });
  const info = db.prepare('INSERT INTO budget_entries (project_id, kind, description, amount, entry_date, created_by) VALUES (?,?,?,?,?,?)').run(req.params.id, kind, description, amount, entry_date, req.user.id);
  audit(req, 'budget_entry_added', { project: req.params.id, amount, kind });
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('DELETE', '/api/budget/:id', (req) => {
  requirePerm(req, 'budget.manage');
  const info = db.prepare('DELETE FROM budget_entries WHERE id = ?').run(req.params.id);
  if (!info.changes) throw new HttpError(404, 'לא נמצא');
  audit(req, 'budget_entry_deleted', { id: req.params.id }, 'warning');
  return { ok: true };
});

// ---------------- משימות ----------------
const TASK_STATUS = ['פתוחה', 'בביצוע', 'ממתינה', 'הושלמה'];
const TASK_PRIORITY = ['נמוכה', 'רגילה', 'גבוהה', 'דחופה'];
function taskFields(b) {
  return {
    title: v.str(b.title, { max: 200, required: true, name: 'כותרת' }),
    description: v.str(b.description, { max: 3000, name: 'תיאור' }),
    project_id: v.id(b.project_id, { name: 'פרויקט' }), request_id: v.id(b.request_id, { name: 'בקשה' }),
    assignee_id: v.id(b.assignee_id, { name: 'אחראי' }),
    status: v.oneOf(b.status || 'פתוחה', TASK_STATUS, { required: true, name: 'סטטוס' }),
    priority: v.oneOf(b.priority || 'רגילה', TASK_PRIORITY, { required: true, name: 'עדיפות' }),
    start_date: v.date(b.start_date, { name: 'התחלה' }), due_date: v.date(b.due_date, { name: 'יעד' }),
  };
}
route('GET', '/api/tasks', (req) => {
  requirePerm(req, 'tasks.view');
  const mine = req.query.mine === '1' || !can(req, 'tasks.manage');
  const rows = db.prepare(`SELECT t.*, u.full_name AS assignee_name, p.name AS project_name, r.number AS request_number FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN requests r ON r.id = t.request_id
    ${mine ? 'WHERE t.assignee_id = ? OR t.created_by = ?' : ''} ORDER BY t.status = 'הושלמה', t.due_date IS NULL, t.due_date LIMIT 1000`).all(...(mine ? [req.user.id, req.user.id] : []));
  return { items: rows };
});
route('POST', '/api/tasks', (req) => {
  requirePerm(req, 'tasks.manage');
  const f = taskFields(req.body);
  const info = db.prepare('INSERT INTO tasks (project_id, request_id, title, description, assignee_id, status, priority, start_date, due_date, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(f.project_id, f.request_id, f.title, f.description, f.assignee_id, f.status, f.priority, f.start_date, f.due_date, req.user.id);
  if (f.assignee_id && f.assignee_id !== req.user.id) notify(f.assignee_id, `משימה חדשה: ${f.title}`, '#/tasks');
  audit(req, 'task_created', { id: Number(info.lastInsertRowid) });
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('PUT', '/api/tasks/:id', (req) => {
  requirePerm(req, 'tasks.view');
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) throw new HttpError(404, 'לא נמצא');
  if (!can(req, 'tasks.manage')) {
    // אחראי משימה ללא הרשאת ניהול רשאי לעדכן רק סטטוס
    if (t.assignee_id !== req.user.id) throw new HttpError(403, 'אין הרשאה');
    const st = v.oneOf(req.body.status, TASK_STATUS, { required: true, name: 'סטטוס' });
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(st, t.id);
    return { ok: true };
  }
  const f = taskFields({ ...t, ...req.body });
  db.prepare('UPDATE tasks SET project_id=?, request_id=?, title=?, description=?, assignee_id=?, status=?, priority=?, start_date=?, due_date=? WHERE id=?')
    .run(f.project_id, f.request_id, f.title, f.description, f.assignee_id, f.status, f.priority, f.start_date, f.due_date, t.id);
  return { ok: true };
});
route('DELETE', '/api/tasks/:id', (req) => {
  requirePerm(req, 'tasks.manage');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  audit(req, 'task_deleted', { id: req.params.id });
  return { ok: true };
});

// ---------------- לוח זמנים ----------------
route('GET', '/api/schedule', (req) => {
  requireAuth(req);
  const items = [];
  if (can(req, 'projects.view')) for (const p of db.prepare("SELECT id, name, start_date, end_date, status FROM projects WHERE start_date IS NOT NULL AND end_date IS NOT NULL").all()) items.push({ kind: 'project', ...p, link: `#/projects/${p.id}` });
  if (can(req, 'tasks.view')) for (const t of db.prepare("SELECT id, title AS name, COALESCE(start_date, due_date) AS start_date, due_date AS end_date, status, priority FROM tasks WHERE due_date IS NOT NULL").all()) items.push({ kind: 'task', ...t, link: '#/tasks' });
  for (const r of db.prepare("SELECT * FROM requests WHERE planned_start IS NOT NULL AND planned_end IS NOT NULL").all()) {
    if (canViewRequest(req, r)) items.push({ kind: 'request', id: r.id, name: `${r.number} ${r.title}`, start_date: r.planned_start, end_date: r.planned_end, status: W.STATUSES[r.status], link: `#/requests/${r.id}` });
  }
  return { items };
});

// ---------------- לוח מחוונים, התראות, חיפוש משתמשים ----------------
route('GET', '/api/dashboard', (req) => {
  requireAuth(req);
  const u = req.user;
  const visible = db.prepare('SELECT * FROM requests').all().filter(r => canViewRequest(req, r)).map(decorate);
  const byStatus = {}; const byType = {};
  for (const r of visible) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; byType[r.type] = (byType[r.type] || 0) + 1; }
  const open = visible.filter(r => W.OPEN_STATUSES.includes(r.status));
  const pendingApprovals = u.infra_body_id ? db.prepare(`SELECT ra.id, r.id AS request_id, r.number, r.title FROM request_approvals ra JOIN requests r ON r.id = ra.request_id
    WHERE ra.infra_body_id = ? AND ra.decision = 'pending' AND r.status IN ('review','coordination') ORDER BY r.due_at`).all(u.infra_body_id) : [];
  const myTasks = can(req, 'tasks.view') ? db.prepare(`SELECT id, title, due_date, priority, status FROM tasks WHERE assignee_id = ? AND status != 'הושלמה' ORDER BY due_date IS NULL, due_date LIMIT 8`).all(u.id) : [];
  const projects = can(req, 'projects.view') ? db.prepare(`${PROJ_SELECT} WHERE p.status IN ('פעיל','תכנון') ORDER BY p.end_date IS NULL, p.end_date LIMIT 6`).all() : [];
  return {
    kpi: { open: open.length, overdue: open.filter(r => r.overdue).length, fast: open.filter(r => r.track === 'fast' && r.track_status === 'approved').length,
      trackPending: visible.filter(r => r.track_status === 'pending').length, approved: byStatus.approved || 0,
      myOpen: open.filter(r => r.applicant_id === u.id).length, assignedToMe: open.filter(r => r.assignee_id === u.id).length },
    byStatus, byType, pendingApprovals, myTasks, projects,
    recent: visible.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 8),
  };
});
// ---------------- דוחות וגרפים ----------------
// כל הנתונים מסוננים לפי מה שהמשתמש רשאי לראות; תקציב ומשימות רק עם ההרשאות שלהם.
route('GET', '/api/reports', (req) => {
  requireAuth(req);
  const months = [3, 6, 12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : 12;
  const type = W.TYPES[req.query.type] ? req.query.type : null;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
  const startIso = start.toISOString().slice(0, 19).replace('T', ' ');
  const all = db.prepare('SELECT * FROM requests WHERE created_at >= ?').all(startIso)
    .filter(r => canViewRequest(req, r) && (!type || r.type === type)).map(decorate);
  const keys = [];
  for (let i = 0; i < months; i++) { const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)); keys.push(d.toISOString().slice(0, 7)); }
  const submitted = Object.fromEntries(keys.map(k => [k, 0])); const approved = Object.fromEntries(keys.map(k => [k, 0]));
  const byStatus = {}; const byType = {};
  let onTime = 0, late = 0, daysSum = 0, daysN = 0;
  for (const r of all) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byType[r.type] = (byType[r.type] || 0) + 1;
    const sm = (r.submitted_at || r.created_at).slice(0, 7); if (sm in submitted) submitted[sm]++;
    if (r.closed_at && (r.status === 'approved' || r.status === 'closed')) { const cm = r.closed_at.slice(0, 7); if (cm in approved) approved[cm]++; }
    if (r.closed_at && r.submitted_at) {
      daysSum += (Date.parse(r.closed_at.replace(' ', 'T') + 'Z') - Date.parse(r.submitted_at.replace(' ', 'T') + 'Z')) / 86400000; daysN++;
      if (r.due_at) { if (r.closed_at <= r.due_at) onTime++; else late++; }
    }
  }
  const openNow = all.filter(r => W.OPEN_STATUSES.includes(r.status));
  const ids = all.map(r => r.id);
  const infra = [];
  if (ids.length) {
    const rows = db.prepare(`SELECT b.name, ra.decision, COUNT(*) AS c FROM request_approvals ra JOIN infra_bodies b ON b.id = ra.infra_body_id
      WHERE ra.request_id IN (SELECT value FROM json_each(?)) GROUP BY b.name, ra.decision`).all(JSON.stringify(ids));
    const map = {};
    for (const x of rows) { map[x.name] = map[x.name] || { name: x.name, pending: 0, approved: 0, conditions: 0, rejected: 0 }; map[x.name][x.decision] = x.c; }
    infra.push(...Object.values(map).sort((a, b) => (b.pending + b.approved + b.conditions + b.rejected) - (a.pending + a.approved + a.conditions + a.rejected)));
  }
  const budget = can(req, 'budget.view') ? db.prepare(`SELECT p.id, p.name, p.budget,
      (SELECT COALESCE(SUM(amount),0) FROM budget_entries b WHERE b.project_id = p.id AND kind = 'actual') AS spent,
      (SELECT COALESCE(SUM(amount),0) FROM budget_entries b WHERE b.project_id = p.id AND kind = 'planned') AS planned
      FROM projects p WHERE p.status != 'בוטל' ORDER BY p.budget DESC LIMIT 12`).all() : null;
  let tasks = null;
  if (can(req, 'tasks.view')) {
    const rows = can(req, 'tasks.manage')
      ? db.prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status').all()
      : db.prepare('SELECT status, COUNT(*) AS c FROM tasks WHERE assignee_id = ? GROUP BY status').all(req.user.id);
    tasks = Object.fromEntries(rows.map(x => [x.status, x.c]));
  }
  return {
    months, type, total: all.length,
    trend: { labels: keys, submitted: keys.map(k => submitted[k]), approved: keys.map(k => approved[k]) },
    byStatus, byType,
    sla: { onTime, late, openOverdue: openNow.filter(r => r.overdue).length, open: openNow.length, avgDays: daysN ? Math.round(daysSum / daysN * 10) / 10 : null },
    infra, budget, tasks,
  };
});

route('GET', '/api/notifications', (req) => {
  requireAuth(req);
  return { items: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id) };
});
route('POST', '/api/notifications/read', (req) => {
  requireAuth(req);
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  return { ok: true };
});
route('GET', '/api/users/lookup', (req) => {
  requirePerm(req, 'requests.assign', 'tasks.manage', 'projects.manage', 'admin.users');
  return { items: db.prepare('SELECT u.id, u.full_name, u.department, u.infra_body_id, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 ORDER BY u.full_name').all() };
});
route('GET', '/api/infra', (req) => { requireAuth(req); return { items: db.prepare('SELECT id, name, contact, active FROM infra_bodies ORDER BY name').all() }; });

// ---------------- ניהול: משתמשים ----------------
function cleanPerms(arr) { return Array.isArray(arr) ? [...new Set(arr.filter(p => typeof p === 'string' && KEYS.has(p)))] : []; }
function activeAdmins(exceptId) {
  return db.prepare('SELECT * FROM users WHERE active = 1').all().filter(u => u.id !== exceptId && auth.effectivePerms(u).has('admin.roles') && auth.effectivePerms(u).has('admin.users')).length;
}
route('GET', '/api/admin/users', (req) => {
  requirePerm(req, 'admin.users');
  return { items: db.prepare('SELECT * FROM users ORDER BY full_name').all().map(publicUser), roles: db.prepare('SELECT id, name FROM roles ORDER BY id').all() };
});
route('POST', '/api/admin/users', async (req) => {
  requirePerm(req, 'admin.users');
  const b = req.body;
  const username = v.str(b.username, { max: 60, required: true, name: 'שם משתמש', pattern: /^[a-zA-Z0-9._-]{3,60}$/ });
  const full_name = v.str(b.full_name, { max: 100, required: true, name: 'שם מלא' });
  const email = v.str(b.email, { max: 200, name: 'דוא"ל', pattern: v.EMAIL });
  const role_id = v.id(b.role_id, { required: true, name: 'תפקיד' });
  if (!db.prepare('SELECT 1 FROM roles WHERE id = ?').get(role_id)) throw new sec.ValidationError('תפקיד לא קיים');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new sec.ValidationError('שם המשתמש תפוס');
  const probs = sec.passwordProblems(b.password, username);
  if (probs.length) throw new sec.ValidationError('סיסמה חלשה: ' + probs.join(', '));
  const hash = await sec.hashPassword(b.password);
  const info = db.prepare(`INSERT INTO users (username, full_name, email, phone, department, password_hash, role_id, infra_body_id, must_change_pw)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(username, full_name, email, v.str(b.phone, { max: 30, name: 'טלפון', pattern: /^[\d+\-\s()]*$/ }),
    v.str(b.department, { max: 100, name: 'מחלקה' }), hash, role_id, v.id(b.infra_body_id, { name: 'גורם תשתית' }));
  audit(req, 'user_created', { id: Number(info.lastInsertRowid), username, role_id }, 'notice');
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('PUT', '/api/admin/users/:id', (req) => {
  requirePerm(req, 'admin.users');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'משתמש לא נמצא');
  const b = req.body;
  const upd = {
    username: v.str(b.username ?? u.username, { max: 60, required: true, name: 'שם משתמש', pattern: /^[a-zA-Z0-9._-]{3,60}$/ }),
    full_name: v.str(b.full_name ?? u.full_name, { max: 100, required: true, name: 'שם מלא' }),
    email: v.str(b.email ?? u.email, { max: 200, name: 'דוא"ל', pattern: v.EMAIL }),
    phone: v.str(b.phone ?? u.phone, { max: 30, name: 'טלפון', pattern: /^[\d+\-\s()]*$/ }),
    department: v.str(b.department ?? u.department, { max: 100, name: 'מחלקה' }),
    role_id: v.id(b.role_id ?? u.role_id, { required: true, name: 'תפקיד' }),
    infra_body_id: b.infra_body_id === undefined ? u.infra_body_id : v.id(b.infra_body_id, { name: 'גורם תשתית' }),
    active: b.active === undefined ? u.active : (b.active ? 1 : 0),
    perm_grant: JSON.stringify(b.perm_grant === undefined ? JSON.parse(u.perm_grant) : cleanPerms(b.perm_grant)),
    perm_deny: JSON.stringify(b.perm_deny === undefined ? JSON.parse(u.perm_deny) : cleanPerms(b.perm_deny)),
  };
  // הרשאות ניהול (תפקידים/הרשאות פרטניות) רק למי שמחזיק admin.roles – מונע הסלמת הרשאות
  const permsChanged = upd.role_id !== u.role_id || upd.perm_grant !== u.perm_grant || upd.perm_deny !== u.perm_deny;
  if (permsChanged) requirePerm(req, 'admin.roles');
  if (!db.prepare('SELECT 1 FROM roles WHERE id = ?').get(upd.role_id)) throw new sec.ValidationError('תפקיד לא קיים');
  if (upd.username.toLowerCase() !== u.username.toLowerCase() && db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(upd.username, u.id)) throw new sec.ValidationError('שם המשתמש תפוס');
  // הגנה: לא ניתן לנטרל את מנהל המערכת האחרון
  const after = { ...u, ...upd };
  const stillAdmin = after.active && auth.effectivePerms(after).has('admin.roles') && auth.effectivePerms(after).has('admin.users');
  if (!stillAdmin && activeAdmins(u.id) === 0) throw new sec.ValidationError('חייב להישאר לפחות מנהל מערכת פעיל אחד');
  const cols = Object.keys(upd);
  db.prepare(`UPDATE users SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map(c => upd[c]), u.id);
  if (!upd.active || permsChanged) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); // ניתוק מיידי
  audit(req, 'user_updated', { id: u.id, permsChanged, active: !!upd.active }, permsChanged ? 'notice' : 'info');
  return { ok: true };
});
route('POST', '/api/admin/users/:id/password', async (req) => {
  requirePerm(req, 'admin.users');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'משתמש לא נמצא');
  // שינוי סיסמה של מנהל אחר מחייב גם הרשאת תפקידים – מונע השתלטות על חשבון בעל הרשאות גבוהות יותר
  const target = auth.effectivePerms(u);
  if ((target.has('admin.roles') || target.has('admin.users')) && u.id !== req.user.id) requirePerm(req, 'admin.roles');
  const probs = sec.passwordProblems(req.body.password, u.username);
  if (probs.length) throw new sec.ValidationError('סיסמה חלשה: ' + probs.join(', '));
  const hash = await sec.hashPassword(req.body.password);
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, req.body.must_change === false ? 0 : 1, u.id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(u.id);
  if (u.id !== req.user.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(req, 'user_password_set_by_admin', { id: u.id, username: u.username }, 'notice');
  return { ok: true };
});
route('POST', '/api/admin/users/:id/reset-link', (req) => {
  requirePerm(req, 'admin.users');
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'משתמש לא נמצא');
  const link = createResetLink(u.id, req.user.id);
  audit(req, 'reset_link_created', { user: u.username }, 'notice');
  return { link, expiresMinutes: config.resetTokenMinutes };
});
route('POST', '/api/admin/users/:id/unlock', (req) => {
  requirePerm(req, 'admin.users');
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(req.params.id);
  audit(req, 'user_unlocked', { id: req.params.id }, 'notice');
  return { ok: true };
});
route('POST', '/api/admin/users/:id/logout', (req) => {
  requirePerm(req, 'admin.users');
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  audit(req, 'user_sessions_revoked', { id: req.params.id }, 'notice');
  return { ok: true };
});

// ---------------- ניהול: תפקידים והרשאות ----------------
route('GET', '/api/admin/permissions', (req) => { requirePerm(req, 'admin.roles', 'admin.users'); return { items: PERMISSIONS }; });
route('GET', '/api/admin/roles', (req) => {
  requirePerm(req, 'admin.roles', 'admin.users');
  return { items: db.prepare('SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users FROM roles r ORDER BY r.id').all().map(r => ({ ...r, perms: JSON.parse(r.perms) })) };
});
route('POST', '/api/admin/roles', (req) => {
  requirePerm(req, 'admin.roles');
  const name = v.str(req.body.name, { max: 60, required: true, name: 'שם תפקיד' });
  if (db.prepare('SELECT 1 FROM roles WHERE name = ?').get(name)) throw new sec.ValidationError('תפקיד בשם זה קיים');
  const info = db.prepare('INSERT INTO roles (name, perms) VALUES (?, ?)').run(name, JSON.stringify(cleanPerms(req.body.perms)));
  audit(req, 'role_created', { id: Number(info.lastInsertRowid), name }, 'notice');
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('PUT', '/api/admin/roles/:id', (req) => {
  requirePerm(req, 'admin.roles');
  const r = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!r) throw new HttpError(404, 'לא נמצא');
  const name = v.str(req.body.name ?? r.name, { max: 60, required: true, name: 'שם תפקיד' });
  let perms = req.body.perms === undefined ? JSON.parse(r.perms) : cleanPerms(req.body.perms);
  if (r.system) perms = [...new Set([...perms, 'admin.roles', 'admin.users'])]; // תפקיד מנהל המערכת תמיד שומר על ניהול
  db.prepare('UPDATE roles SET name = ?, perms = ? WHERE id = ?').run(name, JSON.stringify(perms), r.id);
  db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role_id = ?) AND user_id != ?').run(r.id, req.user.id);
  audit(req, 'role_updated', { id: r.id, name, perms }, 'notice');
  return { ok: true };
});
route('DELETE', '/api/admin/roles/:id', (req) => {
  requirePerm(req, 'admin.roles');
  const r = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!r) throw new HttpError(404, 'לא נמצא');
  if (r.system) throw new sec.ValidationError('לא ניתן למחוק תפקיד מערכת');
  if (db.prepare('SELECT COUNT(*) AS c FROM users WHERE role_id = ?').get(r.id).c) throw new sec.ValidationError('יש משתמשים בתפקיד זה – העבירו אותם קודם');
  db.prepare('DELETE FROM roles WHERE id = ?').run(r.id);
  audit(req, 'role_deleted', { id: r.id, name: r.name }, 'notice');
  return { ok: true };
});

// ---------------- ניהול: הגדרות (סוגי קבצים, גודל, מסלולים) ----------------
route('GET', '/api/admin/settings', (req) => {
  requirePerm(req, 'admin.settings');
  return {
    allowed_ext: up.allowedExt(), max_mb: Math.round(up.maxBytes() / 1048576), hard_max_mb: config.hardMaxUploadMb,
    known_ext: Object.keys(up.MIME), forbidden_ext: [...up.FORBIDDEN_EXT].sort(),
    sla_regular_days: +getSetting('sla.regular_days'), sla_fast_days: +getSetting('sla.fast_days'),
    org_name: getSetting('org.name'), system_title: getSetting('org.system_title'),
    req_prefix: getSetting('requests.prefix'), req_with_year: getSetting('requests.with_year') === '1', req_pad: +getSetting('requests.pad'),
    req_next_preview: nextRequestNumber(), logo: !!getSetting('org.logo'),
  };
});
route('PUT', '/api/admin/settings', (req) => {
  requirePerm(req, 'admin.settings');
  const b = req.body;
  if (b.allowed_ext !== undefined) {
    if (!Array.isArray(b.allowed_ext) || b.allowed_ext.length > 60) throw new sec.ValidationError('רשימת סיומות לא תקינה');
    const list = [...new Set(b.allowed_ext.map(e => String(e).toLowerCase().replace(/^\./, '').trim()))];
    for (const e of list) {
      if (!/^[a-z0-9]{1,8}$/.test(e)) throw new sec.ValidationError(`סיומת לא תקינה: ${e}`);
      if (up.FORBIDDEN_EXT.has(e)) throw new sec.ValidationError(`הסיומת .${e} חסומה מטעמי אבטחה ולא ניתן לאשר אותה`);
    }
    setSetting('files.allowed_ext', JSON.stringify(list));
  }
  if (b.max_mb !== undefined) setSetting('files.max_mb', v.num(b.max_mb, { min: 1, max: config.hardMaxUploadMb, name: 'גודל מרבי (MB)' }));
  if (b.sla_regular_days !== undefined) setSetting('sla.regular_days', v.num(b.sla_regular_days, { min: 1, max: 365, name: 'ימי טיפול במסלול רגיל' }));
  if (b.sla_fast_days !== undefined) setSetting('sla.fast_days', v.num(b.sla_fast_days, { min: 1, max: 60, name: 'ימי טיפול במסלול מזורז' }));
  if (b.org_name !== undefined) setSetting('org.name', v.str(b.org_name, { max: 100, required: true, name: 'שם הארגון' }));
  if (b.system_title !== undefined) setSetting('org.system_title', v.str(b.system_title, { max: 100, required: true, name: 'שם המערכת' }));
  if (b.req_prefix !== undefined) setSetting('requests.prefix', v.str(b.req_prefix, { max: 10, name: 'קידומת', pattern: /^[A-Za-z0-9\u0590-\u05FF]*$/ }) || '');
  if (b.req_with_year !== undefined) setSetting('requests.with_year', b.req_with_year ? '1' : '0');
  if (b.req_pad !== undefined) setSetting('requests.pad', v.num(b.req_pad, { min: 1, max: 8, name: 'מספר ספרות' }));
  if (b.req_next !== undefined && b.req_next !== null && b.req_next !== '') setSetting('requests.next', v.num(b.req_next, { min: 1, max: 99999999, name: 'המספר הבא' }));
  audit(req, 'settings_updated', b, 'notice');
  return { ok: true };
});
route('GET', '/api/admin/infra', (req) => {
  requirePerm(req, 'admin.roles', 'admin.settings');
  return { items: db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM request_approvals ra WHERE ra.infra_body_id = b.id) AS requests,
    (SELECT json_group_array(json_object('id', u.id, 'full_name', u.full_name)) FROM users u WHERE u.infra_body_id = b.id AND u.active = 1) AS members
    FROM infra_bodies b ORDER BY b.active DESC, b.name`).all().map(b => ({ ...b, members: JSON.parse(b.members) })) };
});
route('POST', '/api/admin/infra', (req) => {
  requirePerm(req, 'admin.roles', 'admin.settings');
  const name = v.str(req.body.name, { max: 100, required: true, name: 'שם גורם' });
  if (db.prepare('SELECT 1 FROM infra_bodies WHERE name = ?').get(name)) throw new sec.ValidationError('גורם בשם זה קיים');
  const info = db.prepare('INSERT INTO infra_bodies (name, contact) VALUES (?, ?)').run(name, v.str(req.body.contact, { max: 200, name: 'איש קשר' }));
  audit(req, 'infra_created', { name });
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('PUT', '/api/admin/infra/:id', (req) => {
  requirePerm(req, 'admin.roles', 'admin.settings');
  const b = db.prepare('SELECT * FROM infra_bodies WHERE id = ?').get(req.params.id);
  if (!b) throw new HttpError(404, 'לא נמצא');
  const name = v.str(req.body.name ?? b.name, { max: 100, required: true, name: 'שם' });
  if (db.prepare('SELECT 1 FROM infra_bodies WHERE name = ? AND id != ?').get(name, b.id)) throw new sec.ValidationError('גורם בשם זה קיים');
  tx(() => {
    db.prepare('UPDATE infra_bodies SET name = ?, contact = ?, active = ? WHERE id = ?').run(name, v.str(req.body.contact ?? b.contact, { max: 200, name: 'איש קשר' }),
      req.body.active === undefined ? b.active : (req.body.active ? 1 : 0), b.id);
    // שיוך משתמשים לגורם (משתמש משויך יכול לתת חוות דעת בשם הגורם)
    if (Array.isArray(req.body.member_ids)) {
      const ids = req.body.member_ids.slice(0, 200).map(x => v.id(x, { required: true, name: 'משתמש' }));
      db.prepare('UPDATE users SET infra_body_id = NULL WHERE infra_body_id = ?').run(b.id);
      for (const uid of ids) db.prepare('UPDATE users SET infra_body_id = ? WHERE id = ?').run(b.id, uid);
    }
  });
  audit(req, 'infra_updated', { id: b.id, name });
  return { ok: true };
});
route('DELETE', '/api/admin/infra/:id', (req) => {
  requirePerm(req, 'admin.roles', 'admin.settings');
  const b = db.prepare('SELECT * FROM infra_bodies WHERE id = ?').get(req.params.id);
  if (!b) throw new HttpError(404, 'לא נמצא');
  if (db.prepare('SELECT 1 FROM request_approvals WHERE infra_body_id = ?').get(b.id)) throw new sec.ValidationError('לגורם יש היסטוריית אישורים בבקשות – אפשר להשבית אותו, לא למחוק');
  tx(() => { db.prepare('UPDATE users SET infra_body_id = NULL WHERE infra_body_id = ?').run(b.id); db.prepare('DELETE FROM infra_bodies WHERE id = ?').run(b.id); });
  audit(req, 'infra_deleted', { id: b.id, name: b.name }, 'notice');
  return { ok: true };
});

// ---------------- ניהול: יומן אבטחה, גיבויים ----------------
route('GET', '/api/admin/audit', (req) => {
  requirePerm(req, 'admin.audit');
  const where = []; const params = [];
  if (req.query.severity && ['info', 'notice', 'warning', 'error', 'critical'].includes(req.query.severity)) { where.push('severity = ?'); params.push(req.query.severity); }
  if (req.query.suspicious === '1') where.push("severity IN ('warning','error','critical')");
  if (req.query.q) { const t = '%' + v.str(req.query.q, { max: 100 }).replace(/[%_\\]/g, '\\$&') + '%'; where.push("(action LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR ip LIKE ? ESCAPE '\\')"); params.push(t, t, t); }
  const items = db.prepare(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...params);
  const since = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const count = (a) => db.prepare('SELECT COUNT(*) AS c FROM audit_log WHERE action = ? AND created_at > ?').get(a, since).c;
  const topIps = db.prepare(`SELECT ip, COUNT(*) AS c FROM audit_log WHERE severity IN ('warning','critical') AND created_at > ? GROUP BY ip ORDER BY c DESC LIMIT 5`).all(since);
  return { items, summary: { failedLogins: count('login_failed'), lockouts: count('account_locked'), csrf: count('csrf_token_invalid') + count('csrf_origin_blocked') + count('csrf_header_missing'),
    denied: count('permission_denied'), uploadsRejected: count('upload_rejected'), rateLimited: count('login_rate_limited') + count('rate_limited'), topIps } };
});
route('GET', '/api/admin/backups', (req) => { requirePerm(req, 'admin.backup'); return { status: backup.status(), items: backup.listBackups().slice(0, 100) }; });
route('POST', '/api/admin/backups', async (req) => {
  requirePerm(req, 'admin.backup');
  const r = await backup.runBackup('manual');
  audit(req, 'backup_manual', r, 'notice');
  return r;
});

// ---------------- לוגו הארגון ----------------
// PNG / JPG / WebP בלבד (לא SVG – יכול להכיל קוד), עד 1MB, נבדק לפי התוכן. מוצג גם במסך הכניסה, לכן הקריאה ציבורית.
const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const path = require('node:path');
route('POST', '/api/admin/logo', async (req) => {
  requirePerm(req, 'admin.settings');
  const { file } = await up.parseMultipart(req, 1024 * 1024);
  const ext = (file.filename.toLowerCase().split('.').pop() || '');
  if (!LOGO_TYPES[ext]) throw new HttpError(415, 'הלוגו חייב להיות PNG, JPG או WebP');
  if (file.data.length > 1024 * 1024) throw new HttpError(413, 'הלוגו גדול מ-1MB');
  if (!up.SIGNATURES[ext](file.data)) throw new HttpError(415, 'תוכן הקובץ אינו תמונה תקינה');
  const name = `logo-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.writeFileSync(path.join(config.dataDir, name), file.data, { mode: 0o600 });
  const old = getSetting('org.logo');
  setSetting('org.logo', name);
  if (old && /^logo-\d+\.(png|jpg|webp)$/.test(old)) fs.rm(path.join(config.dataDir, old), { force: true }, () => {});
  audit(req, 'logo_updated', { size: file.data.length }, 'notice');
  return { ok: true, logo: name };
});
route('DELETE', '/api/admin/logo', (req) => {
  requirePerm(req, 'admin.settings');
  const old = getSetting('org.logo');
  setSetting('org.logo', '');
  if (old && /^logo-\d+\.(png|jpg|webp)$/.test(old)) fs.rm(path.join(config.dataDir, old), { force: true }, () => {});
  audit(req, 'logo_removed', {}, 'notice');
  return { ok: true };
});
route('GET', '/api/logo', (req, res) => {
  const name = getSetting('org.logo');
  if (!name || !/^logo-\d+\.(png|jpg|webp)$/.test(name)) throw new HttpError(404, 'אין לוגו');
  const file = path.join(config.dataDir, name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'אין לוגו');
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': LOGO_TYPES[name.split('.').pop()], 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' });
  res.end(buf);
});

module.exports = { match };
