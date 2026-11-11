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
const cloud = require('./cloudsync');
const docsPdf = require('./documents');

// שמות משתמש: עברית, אנגלית, ספרות, נקודה, מקף, קו תחתון ורווח בודד (לא בהתחלה/בסוף)
const USERNAME_RE = /^(?=.{3,60}$)[A-Za-z0-9\u05D0-\u05EA](?:[A-Za-z0-9\u05D0-\u05EA._-]| (?! ))*[A-Za-z0-9\u05D0-\u05EA]$/;
const normUser = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
// סוגי בקשות מהמסד
const typesAll = () => db.prepare('SELECT * FROM request_types ORDER BY sort, id').all();
const typesMap = () => Object.fromEntries(typesAll().map(t => [t.key, t.name]));
// דוא"ל (אם הוגדר SMTP). לא חוסם את התשובה; כשל נרשם ביומן
function mailUsers(users, subject, text, attachments) {
  if (!mailer.isConfigured()) return;
  for (const u of users) if (u && u.email) mailer.send({ to: u.email, subject, text, attachments }).catch(e => audit(null, 'mail_failed', { to: u.id, subject, error: e.message }, 'error'));
}
const sysTitle = () => getSetting('org.system_title') || 'מערכת תיאום הנדסי';
const linkTo = (id) => `${config.publicUrl}/#/requests/${id}`;
function mappingUsers() {
  return db.prepare('SELECT u.*, r.system AS sys FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1').all().filter(u => u.sys || auth.effectivePerms(u).has('requests.mapping'));
}

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
    perm_grant: JSON.parse(u.perm_grant || '[]'), perm_deny: JSON.parse(u.perm_deny || '[]'), applicant_kind: u.applicant_kind || null };
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
function notifySysAdmins(text, link, exceptId) {
  for (const u of db.prepare('SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 AND r.system = 1').all()) if (u.id !== exceptId) notify(u.id, text, link);
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
  const username = normUser(v.str(req.body.username, { max: 60, required: true, name: 'שם משתמש' }));
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

const loginTexts = () => ({ heading: getSetting('login.heading') || '', text: getSetting('login.text') || '' });
route('GET', '/api/auth/me', (req) => {
  if (!req.user) return status(401, { error: 'לא מחובר', title: getSetting('org.system_title'), org: getSetting('org.name'), logo: getSetting('org.logo') || null, login: loginTexts() });
  const u = req.user;
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(u.id).c;
  const roleName = db.prepare('SELECT name FROM roles WHERE id = ?').get(u.role_id)?.name || '';
  const infraName = u.infra_body_id ? db.prepare('SELECT name FROM infra_bodies WHERE id = ?').get(u.infra_body_id)?.name || null : null;
  return { user: { ...publicUser(u), role_name: roleName, infra_name: infraName, is_sysadmin: isSysAdmin(req), can_assign_tasks: canAssignTasks(req) }, perms: permsList(req), csrf: req.session.csrf, prefs: JSON.parse(u.prefs || '{}'),
    title: getSetting('org.system_title'), org: getSetting('org.name'), logo: getSetting('org.logo') || null, login: loginTexts(), unread,
    meta: { types: typesMap(), typesActive: typesAll().filter(t => t.active).map(t => t.key), statuses: W.STATUSES,
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
// מנהל המערכת = משתמש בתפקיד המערכת (לא הרשאה שאפשר להעניק בנפרד)
function isSysAdmin(req) {
  if (!req.user) return false;
  if (req.user._sys === undefined) req.user._sys = !!db.prepare('SELECT system FROM roles WHERE id = ?').get(req.user.role_id)?.system;
  return req.user._sys;
}
function allowed(req, r, need) {
  if (need === 'applicant') return r.applicant_id === req.user.id || can(req, 'requests.edit_all');
  if (need === 'sysadmin') return isSysAdmin(req);
  return can(req, need);
}
function canViewRequest(req, r) {
  const u = req.user;
  if (u.perms.has('requests.view_all') || u.perms.has('requests.mapping') || isSysAdmin(req)) return true;
  if (!u.perms.has('requests.view_own') && !u.perms.has('approvals.decide')) return false;
  if (r.applicant_id === u.id || r.assignee_id === u.id) return true;
  if (db.prepare('SELECT 1 FROM user_requests WHERE user_id = ? AND request_id = ?').get(u.id, r.id)) return true;
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
    type: v.oneOf(b.type, typesAll().filter(t => t.active || t.key === b.__currentType).map(t => t.key), { required: true, name: 'סוג בקשה' }),
    title: v.str(b.title, { max: 200, required: true, name: 'נושא' }),
    description: v.str(b.description, { max: 5000, name: 'תיאור' }),
    address: v.str(b.address, { max: 300, name: 'כתובת' }),
    gush: v.str(b.gush, { max: 20, name: 'גוש', pattern: /^[\d\s-]*$/ }),
    helka: v.str(b.helka, { max: 20, name: 'חלקה', pattern: /^[\d\s-]*$/ }),
    project_name: v.str(b.project_name, { max: 200, name: 'פרויקט' }),
    work_time: v.str(b.work_time, { max: 200, name: 'זמן עבודה' }),
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
  return parseInt(getSetting('sla.regular_days'), 10) || 14;
}
function decorate(r) {
  const overdue = r.due_at && W.OPEN_STATUSES.includes(r.status) && r.due_at < nowIso();
  return { ...r, overdue: !!overdue };
}
const REQ_SELECT = `SELECT r.*, a.full_name AS applicant_name, s.full_name AS assignee_name, r.project_name,
  (SELECT COUNT(*) FROM request_approvals x WHERE x.request_id = r.id) AS approvals_total,
  (SELECT COUNT(*) FROM request_approvals x WHERE x.request_id = r.id AND x.decision = 'approved') AS approvals_done
  FROM requests r JOIN users a ON a.id = r.applicant_id LEFT JOIN users s ON s.id = r.assignee_id`;

route('GET', '/api/requests', (req) => {
  requirePerm(req, 'requests.view_own', 'requests.view_all', 'approvals.decide');
  const q = req.query; const u = req.user;
  const where = []; const params = [];
  const scope = ['mine', 'assigned', 'all', 'pending_me'].includes(q.scope) ? q.scope : 'mine';
  if (scope === 'mine') { where.push('r.applicant_id = ?'); params.push(u.id); }
  else if (scope === 'assigned') { where.push('r.assignee_id = ?'); params.push(u.id); }
  else if (scope === 'pending_me') {
    where.push(`(r.assignee_id = ? AND r.status IN ('submitted','review','coordination')) OR r.id IN (SELECT request_id FROM request_approvals WHERE infra_body_id = ? AND decision = 'pending') OR (? = 1 AND r.status = 'pending_admin')`);
    params.push(u.id, u.infra_body_id || -1, isSysAdmin(req) ? 1 : 0);
  } else if (!u.perms.has('requests.view_all')) {
    where.push(`(r.applicant_id = ? OR r.assignee_id = ? OR r.id IN (SELECT request_id FROM request_approvals WHERE infra_body_id = ?) OR r.id IN (SELECT request_id FROM user_requests WHERE user_id = ?))`);
    params.push(u.id, u.id, u.infra_body_id || -1, u.id);
  }
  if (q.status && W.STATUSES[q.status]) { where.push('r.status = ?'); params.push(q.status); }
  if (q.type && typesMap()[q.type]) { where.push('r.type = ?'); params.push(q.type); }
  if (q.q) {
    const term = '%' + v.str(q.q, { max: 100 }).replace(/[%_\\]/g, '\\$&') + '%';
    where.push(`(r.title LIKE ? ESCAPE '\\' OR r.number LIKE ? ESCAPE '\\' OR r.address LIKE ? ESCAPE '\\')`); params.push(term, term, term);
  }
  const rows = db.prepare(`${REQ_SELECT} ${where.length ? 'WHERE ' + where.map(w => `(${w})`).join(' AND ') : ''} ORDER BY r.updated_at DESC LIMIT 500`).all(...params);
  // סינון נוסף לביטחון: רק מה שמותר לראות
  return { items: rows.filter(r => canViewRequest(req, r)).map(decorate), scope };
});

route('GET', '/api/requests/:id', (req) => {
  requireAuth(req);
  const r = db.prepare(`${REQ_SELECT} WHERE r.id = ?`).get(req.params.id);
  if (!r) throw new HttpError(404, 'הבקשה לא נמצאה');
  assertView(req, r);
  const approvals = db.prepare(`SELECT ra.*, b.name AS body_name, u.full_name AS decided_by_name FROM request_approvals ra
    JOIN infra_bodies b ON b.id = ra.infra_body_id LEFT JOIN users u ON u.id = ra.decided_by WHERE ra.request_id = ? ORDER BY ra.seq, ra.id`).all(r.id);
  const turn = currentTurn(r.id);
  const hist = db.prepare(`SELECT h.*, u.full_name AS user_name FROM request_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.request_id = ? ORDER BY h.id DESC`).all(r.id);
  const docs = db.prepare(`SELECT d.id, d.request_id, d.original_name, d.size, d.mime, d.category, d.visibility, d.created_at, d.uploaded_by, u.full_name AS uploaded_by_name
    FROM documents d JOIN users u ON u.id = d.uploaded_by WHERE d.request_id = ? ORDER BY d.id DESC`).all(r.id).filter(d => canSeeDoc(req, d));
  const approvalDoc = docs.find(d => d.category === 'אישור לביצוע עבודה') || null;
  const members = db.prepare('SELECT u.id, u.full_name FROM user_requests ur JOIN users u ON u.id = ur.user_id WHERE ur.request_id = ? ORDER BY u.full_name').all(r.id);
  const tasks = db.prepare(`SELECT t.*, u.full_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.request_id = ? ORDER BY t.id DESC`).all(r.id);
  const transitions = Object.entries(W.TRANSITIONS[r.status] || {}).filter(([, need]) => allowed(req, r, need)).map(([to]) => to);
  const ap = db.prepare('SELECT email, phone, address FROM users WHERE id = ?').get(r.applicant_id) || {};
  const applicant = { email: ap.email || null, phone: ap.phone || null, address: ap.address || null, kind: r.applicant_kind || null };
  const location = r.loc_x ? { x: r.loc_x, y: r.loc_y, z: r.loc_z || 9, label: r.loc_label || null, link: govmapLink(r.loc_x, r.loc_y, r.loc_z || 9), map: !!govmapToken() } : null;
  return { request: { ...decorate(r), type_name: typesMap()[r.type] || r.type }, applicant, location, approvals, turn_id: turn ? turn.id : null, approvalDoc, history: hist, documents: docs, tasks, transitions, members,
    docsOwnOnly: docsOwnOnly() && !isSysAdmin(req) && !can(req, 'requests.mapping'),
    can: { edit: canEditRequest(req, r), delete: can(req, 'requests.delete'), assign: can(req, 'requests.assign'),
      upload: can(req, 'files.upload'), decide: can(req, 'approvals.decide'), sysadmin: isSysAdmin(req),
      mapInfra: can(req, 'requests.assign') || can(req, 'requests.mapping'),
      editLocation: canEditRequest(req, r) || can(req, 'requests.mapping') || can(req, 'requests.assign') } };
});

// גורמי התשתית הקבועים של סוג בקשה (פעילים בלבד, לפי הסדר שהוגדר)
function typeChain(typeKey) {
  const t = db.prepare('SELECT infra_chain FROM request_types WHERE key = ?').get(typeKey);
  return JSON.parse((t && t.infra_chain) || '[]').filter(id => db.prepare('SELECT 1 FROM infra_bodies WHERE id = ? AND active = 1').get(id));
}
// מסנכרן את גורמי הבקשה לגורמים הקבועים של הסוג – רק כל עוד אף גורם לא התחיל לטפל (אין החלטות ואין גורם שקיבל תור)
function syncTypeChain(requestId, typeKey) {
  const chain = typeChain(typeKey); if (!chain.length) return false;
  const started = db.prepare("SELECT 1 FROM request_approvals WHERE request_id = ? AND (decision != 'pending' OR notified_at IS NOT NULL)").get(requestId);
  if (started) return false;
  db.prepare('DELETE FROM request_approvals WHERE request_id = ?').run(requestId);
  chain.forEach((bid, i) => db.prepare('INSERT INTO request_approvals (request_id, infra_body_id, seq) VALUES (?, ?, ?)').run(requestId, bid, i + 1));
  return true;
}
route('PUT', '/api/requests/:id', (req) => {
  requireAuth(req);
  const r = loadRequest(req.params.id); assertView(req, r);
  if (!canEditRequest(req, r)) throw new HttpError(403, 'אין הרשאה לערוך בקשה זו');
  const f = requestFields({ ...r, ...req.body, __currentType: r.type });
  if (f.planned_start && f.planned_end && f.planned_end < f.planned_start) throw new sec.ValidationError('תאריך סיום לפני תאריך התחלה');
  db.prepare(`UPDATE requests SET type=?, title=?, description=?, address=?, gush=?, helka=?, project_name=?, work_time=?, planned_start=?, planned_end=?, updated_at=? WHERE id=?`)
    .run(f.type, f.title, f.description, f.address, f.gush, f.helka, f.project_name, f.work_time, f.planned_start, f.planned_end, nowIso(), r.id);
  history(r.id, req.user.id, 'עודכנה', null);
  // שינוי סוג הבקשה: הגורמים מסתנכרנים לגורמים הקבועים של הסוג החדש
  if (f.type !== r.type && syncTypeChain(r.id, f.type)) history(r.id, req.user.id, 'גורמי התשתית עודכנו לפי סוג הבקשה', typeChain(f.type).map(id => (db.prepare('SELECT name FROM infra_bodies WHERE id = ?').get(id) || {}).name).join(' ← '));
  audit(req, 'request_updated', { id: r.id });
  return { ok: true };
});

route('DELETE', '/api/requests/:id', (req) => {
  requirePerm(req, 'requests.delete');
  const r = loadRequest(req.params.id);
  const files = db.prepare('SELECT stored_name FROM documents WHERE request_id = ?').all(r.id);
  db.prepare('DELETE FROM requests WHERE id = ?').run(r.id);
  for (const f of files) fs.rm(up.storedPath(f.stored_name), { force: true }, () => {});
  cloud.deleteFiles(files.map(f => 'uploads/' + f.stored_name));
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

// ---------- סדר טיפול של גורמי התשתית ----------
// "אושר" ו"אושר בתנאים" מסיימים את תור הגורם; "נדחה" / "ממתין" – התור נשאר אצלו
const DONE = "('approved','conditions')";
function currentTurn(requestId) {
  return db.prepare(`SELECT ra.*, b.name AS body_name FROM request_approvals ra JOIN infra_bodies b ON b.id = ra.infra_body_id
    WHERE ra.request_id = ? AND ra.decision NOT IN ${DONE} ORDER BY ra.seq, ra.id LIMIT 1`).get(requestId);
}
// מודיע (התראה + דוא"ל) לגורם שהגיע תורו – פעם אחת לכל גורם
function notifyTurn(requestId, prevBody) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  if (!r || !['review', 'coordination'].includes(r.status)) return;
  const a = currentTurn(r.id); if (!a || a.notified_at) return;
  db.prepare('UPDATE request_approvals SET notified_at = ? WHERE id = ?').run(nowIso(), a.id);
  const users = db.prepare('SELECT id, full_name, email FROM users WHERE infra_body_id = ? AND active = 1').all(a.infra_body_id);
  const text = prevBody ? `${prevBody} סיים את הטיפול בבקשה ${r.number}. עכשיו תורכם (${a.body_name}) לתת חוות דעת.` : `בקשה ${r.number} ממתינה לחוות דעת ${a.body_name}.`;
  for (const u of users) notify(u.id, text, `#/requests/${r.id}`);
  mailUsers(users, `בקשה ${r.number} ממתינה לחוות דעתכם – ${sysTitle()}`, `שלום,\n\n${text}\nנושא: ${r.title}\n\nלצפייה ולמתן חוות דעת: ${linkTo(r.id)}\n\n${sysTitle()}`);
  history(r.id, null, `התור עבר ל${a.body_name}`, null);
}

// ---------- תזכורות לגורמים: גורם שתורו הגיע ולא טיפל X ימים מקבל אימייל תזכורת ----------
const DAY_MS = 86400000;
function reminderSettings() {
  return { enabled: getSetting('reminder.enabled') !== '0', days: Math.max(1, parseInt(getSetting('reminder.days'), 10) || 14), repeat: Math.max(0, parseInt(getSetting('reminder.repeat_days'), 10) || 0) };
}
function runReminders(now = Date.now()) {
  const cfg = reminderSettings(); if (!cfg.enabled) return { sent: 0, bodies: [] };
  const sent = [];
  for (const r of db.prepare("SELECT * FROM requests WHERE status IN ('review', 'coordination')").all()) {
    const a = currentTurn(r.id); if (!a || a.decision !== 'pending') continue;
    // מאז מתי הגורם מחזיק בבקשה: התזכורת האחרונה, או מתי שהגיע תורו (ואם אין – מתי שהבקשה הוגשה)
    const since = Date.parse((a.reminded_at || a.notified_at || r.submitted_at || r.created_at).replace(' ', 'T') + (/[Z+]/.test(a.reminded_at || a.notified_at || r.submitted_at || r.created_at) ? '' : 'Z'));
    const wait = (a.reminded_at ? cfg.repeat : cfg.days) * DAY_MS;
    if (a.reminded_at && !cfg.repeat) continue;
    if (!Number.isFinite(since) || now - since < wait) continue;
    const days = Math.floor((now - Date.parse(((a.notified_at || r.submitted_at || r.created_at).replace(' ', 'T')) + (/[Z+]/.test(a.notified_at || r.submitted_at || r.created_at) ? '' : 'Z'))) / DAY_MS);
    const users = db.prepare(`SELECT DISTINCT u.id, u.full_name, u.email FROM users u LEFT JOIN infra_bodies b ON b.contact_user_id = u.id
      WHERE u.active = 1 AND (u.infra_body_id = ? OR b.id = ?)`).all(a.infra_body_id, a.infra_body_id);
    const text = `תזכורת: בקשה ${r.number} ממתינה לחוות דעת ${a.body_name} כבר ${days} ימים. יש לטפל בבקשה.`;
    for (const u of users) notify(u.id, text, `#/requests/${r.id}`);
    mailUsers(users, `תזכורת: יש לטפל בבקשה ${r.number} – ${sysTitle()}`,
      `שלום,\n\n${text}\n\nמספר בקשה: ${r.number}\nנושא: ${r.title}\n\nכניסה לבקשה: ${linkTo(r.id)}\n\n${sysTitle()}`);
    db.prepare('UPDATE request_approvals SET reminded_at = ?, reminders = reminders + 1 WHERE id = ?').run(new Date(now).toISOString(), a.id);
    history(r.id, null, `נשלחה תזכורת ל${a.body_name}`, `${days} ימים בלי טיפול`);
    sent.push({ request: r.number, body: a.body_name, users: users.length });
  }
  if (sent.length) console.log(`[reminders] נשלחו ${sent.length} תזכורות`);
  return { sent: sent.length, items: sent };
}
route('POST', '/api/admin/reminders/run', (req) => {
  requirePerm(req, 'admin.settings');
  const out = runReminders();
  audit(req, 'reminders_run', { sent: out.sent });
  return out;
});

// ---------- אישור סופי: הפקת מסמך האישור, צירוף לבקשה ושליחה למגיש ----------
function logoBuffer() {
  const name = getSetting('org.logo'); const path_ = require('node:path');
  if (name && /^logo-\d+\.(png|jpg)$/.test(name)) { const f = path_.join(config.dataDir, name); if (fs.existsSync(f)) return fs.readFileSync(f); }
  try { return fs.readFileSync(path_.join(__dirname, 'logo.png')); } catch { return null; }
}
function policeData(requestId) { const p = db.prepare('SELECT data FROM request_police WHERE request_id = ?').get(requestId); return p ? JSON.parse(p.data) : null; }
async function issueApproval(req, requestId, adminComment) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  const applicant = db.prepare('SELECT * FROM users WHERE id = ?').get(r.applicant_id);
  const approvals = db.prepare(`SELECT ra.*, b.name AS body_name, u.full_name AS decided_by_name FROM request_approvals ra JOIN infra_bodies b ON b.id = ra.infra_body_id
    LEFT JOIN users u ON u.id = ra.decided_by WHERE ra.request_id = ? ORDER BY ra.seq, ra.id`).all(r.id);
  const { buffer, code } = docsPdf.approvalPdf({ org: getSetting('org.name'), systemTitle: sysTitle(), logo: logoBuffer(), typeName: typesMap()[r.type] || r.type,
    request: r, police: policeData(r.id), applicant, approvals, admin: { name: req.user.full_name, comment: adminComment }, guidelines: getSetting('approval.guidelines'), secret: r.number });
  const st = up.storeBuffer(buffer);
  const fname = `אישור לביצוע עבודה – ${r.number}.pdf`;
  try { await cloud.putFile('uploads/' + st.stored, buffer, 'application/pdf'); } catch (e) { audit(req, 'cloud_upload_failed', { error: e.message }, 'error'); }
  const info = db.prepare(`INSERT INTO documents (request_id, category, original_name, stored_name, mime, size, sha256, uploaded_by, visibility) VALUES (?, 'אישור לביצוע עבודה', ?, ?, 'application/pdf', ?, ?, ?, 'shared')`)
    .run(r.id, fname, st.stored, st.size, st.sha256, req.user.id);
  history(r.id, req.user.id, 'הופק מסמך אישור לביצוע עבודה', `קוד מסמך ${code}`);
  notify(r.applicant_id, `בקשה ${r.number} אושרה. מסמך האישור לביצוע עבודה מחכה לך בבקשה.`, `#/requests/${r.id}`);
  mailUsers([applicant], `בקשה ${r.number} אושרה – אישור לביצוע עבודה`, `שלום ${applicant.full_name},\n\nבקשה ${r.number} אושרה.\nמצורף מסמך האישור לביצוע עבודה. המסמך זמין גם בבקשה במערכת: ${linkTo(r.id)}\n\nיש לפעול לפי התנאים וההנחיות שבמסמך.\n\n${getSetting('org.name')}`,
    [{ filename: fname, content: buffer, contentType: 'application/pdf' }]);
  audit(req, 'approval_issued', { id: r.id, doc: Number(info.lastInsertRowid), code }, 'notice');
  return Number(info.lastInsertRowid);
}

route('POST', '/api/requests/:id/status', async (req) => {
  requireAuth(req);
  const r = loadRequest(req.params.id); assertView(req, r);
  const to = v.oneOf(req.body.status, Object.keys(W.STATUSES), { required: true, name: 'סטטוס' });
  const comment = v.str(req.body.comment, { max: 2000, name: 'הערה', required: ['returned', 'rejected'].includes(to) });
  const need = (W.TRANSITIONS[r.status] || {})[to];
  if (!need) throw new HttpError(400, `לא ניתן לעבור מ"${W.STATUSES[r.status]}" ל"${W.STATUSES[to]}"`);
  if (!allowed(req, r, need)) {
    const e = new HttpError(403, need === 'sysadmin' ? 'רק מנהל המערכת מאשר וסוגר בקשות' : 'אין הרשאה לפעולה זו'); e.permDenied = need; throw e;
  }
  if (to === 'approved' || to === 'pending_admin') {
    const pending = db.prepare(`SELECT COUNT(*) AS c FROM request_approvals WHERE request_id = ? AND decision NOT IN ${DONE}`).get(r.id).c;
    if (pending) throw new HttpError(400, 'לא ניתן לאשר: יש גורמי תשתית שטרם אישרו');
  }
  // החזרה לתיקון לגורם תשתית מסוים: חוות הדעת שלו נפתחת מחדש, הבקשה חוזרת לתיאום, והגורם מקבל התראה ואימייל עם הסיבה
  if (to === 'returned' && req.body.return_to && req.body.return_to !== 'applicant') {
    const aid = v.id(req.body.return_to, { required: true, name: 'למי מחזירים' });
    const a = db.prepare(`SELECT ra.*, b.name AS body_name FROM request_approvals ra JOIN infra_bodies b ON b.id = ra.infra_body_id WHERE ra.id = ? AND ra.request_id = ?`).get(aid, r.id);
    if (!a) throw new sec.ValidationError('הגורם שנבחר אינו משויך לבקשה');
    // החזרה מהשלב האחרון (אישור מנהל המערכת): אחרי שהגורם מתקן ומאשר – הבקשה מאושרת אוטומטית, בלי בדיקה חוזרת של התיקון
    const autoApprove = r.status === 'pending_admin' && isSysAdmin(req) && req.body.auto_approve !== false;
    tx(() => {
      db.prepare("UPDATE request_approvals SET decision = 'pending', decided_by = NULL, decided_at = NULL, notified_at = ? WHERE id = ?").run(nowIso(), a.id);
      db.prepare("UPDATE requests SET status = 'coordination', fix_auto_approval = ?, fix_auto_by = ?, updated_at = ? WHERE id = ?").run(autoApprove ? a.id : null, autoApprove ? req.user.id : null, nowIso(), r.id);
      history(r.id, req.user.id, `הוחזרה לתיקון אל ${a.body_name}`, comment + (autoApprove ? '\nאחרי התיקון הבקשה תאושר אוטומטית, בלי בדיקה חוזרת.' : ''));
    });
    const users = db.prepare('SELECT id, full_name, email FROM users WHERE infra_body_id = ? AND active = 1').all(a.infra_body_id);
    for (const u of users) notify(u.id, `בקשה ${r.number} הוחזרה אליכם לבדיקה: ${comment}`, `#/requests/${r.id}`);
    mailUsers(users, `בקשה ${r.number} הוחזרה אליכם לבדיקה – ${sysTitle()}`,
      `שלום,\n\nבקשה ${r.number} (${r.title}) הוחזרה אליכם (${a.body_name}) לבדיקה חוזרת על ידי ${req.user.full_name}.\n\nסיבת ההחזרה:\n${comment}\n\nלכניסה לבקשה ולמתן חוות דעת מעודכנת:\n${linkTo(r.id)}\n\n${sysTitle()}`);
    audit(req, 'request_returned_to_body', { id: r.id, approval: a.id });
    return { ok: true, returned_to: a.body_name, auto_approve: autoApprove };
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
  if (to === 'returned') {
    const ap = db.prepare('SELECT id, full_name, email FROM users WHERE id = ?').get(r.applicant_id);
    if (ap && ap.id !== req.user.id) mailUsers([ap], `בקשה ${r.number} הוחזרה אליך לתיקון – ${sysTitle()}`,
      `שלום ${ap.full_name},\n\nבקשה ${r.number} (${r.title}) הוחזרה אליך לתיקון על ידי ${req.user.full_name}.\n\nסיבת ההחזרה:\n${comment}\n\nלכניסה לבקשה:\n${linkTo(r.id)}\n\n${sysTitle()}`);
  }
  if (to === 'pending_admin') notifySysAdmins(`בקשה ${r.number} ממתינה לאישורך הסופי`, `#/requests/${r.id}`, req.user.id);
  audit(req, 'request_status', { id: r.id, from: r.status, to });
  if (to === 'review' || to === 'coordination') notifyTurn(r.id);
  // אישור מנהל המערכת מסיים את הבקשה: מסמך אישור, צירוף לבקשה ושליחה למגיש
  if (to === 'approved') { const docId = await issueApproval(req, r.id, comment); return { ok: true, approval_doc: docId }; }
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

route('POST', '/api/requests/:id/approvals', (req) => {
  requirePerm(req, 'requests.assign', 'requests.mapping');
  const r = loadRequest(req.params.id);
  // הסדר ברשימה = סדר הטיפול. כל גורם מקבל הודעה כשהגורם שלפניו סיים
  const ids = Array.isArray(req.body.infra_body_ids) ? [...new Set(req.body.infra_body_ids.slice(0, 50).map(x => v.id(x, { required: true })))] : [];
  tx(() => {
    const existing = db.prepare('SELECT infra_body_id, decision FROM request_approvals WHERE request_id = ?').all(r.id);
    for (const e of existing) if (!ids.includes(e.infra_body_id) && e.decision === 'pending') db.prepare('DELETE FROM request_approvals WHERE request_id = ? AND infra_body_id = ?').run(r.id, e.infra_body_id);
    ids.forEach((bid, i) => {
      const b = db.prepare('SELECT id, name FROM infra_bodies WHERE id = ? AND active = 1').get(bid);
      if (!b && !existing.some(e => e.infra_body_id === bid)) throw new sec.ValidationError('גורם תשתית לא קיים');
      db.prepare('INSERT OR IGNORE INTO request_approvals (request_id, infra_body_id) VALUES (?, ?)').run(r.id, bid);
      db.prepare('UPDATE request_approvals SET seq = ? WHERE request_id = ? AND infra_body_id = ?').run(i + 1, r.id, bid);
    });
  });
  history(r.id, req.user.id, 'נקבעו גורמי התשתית וסדר הטיפול', ids.map(id => db.prepare('SELECT name FROM infra_bodies WHERE id = ?').get(id)?.name).filter(Boolean).join(' ← '));
  audit(req, 'request_infra_set', { id: r.id, ids });
  notifyTurn(r.id);
  return { ok: true };
});

route('POST', '/api/approvals/:id/decide', async (req) => {
  requirePerm(req, 'approvals.decide');
  const a = db.prepare('SELECT * FROM request_approvals WHERE id = ?').get(req.params.id);
  if (!a) throw new HttpError(404, 'לא נמצא');
  // גורם תשתית מחליט רק עבור הגוף שלו; מנהל המערכת רשאי להחליט עבור כולם
  if (req.user.infra_body_id !== a.infra_body_id && !isSysAdmin(req)) throw new HttpError(403, 'ניתן להחליט רק עבור הגוף שאליו אתה משויך');
  const decision = v.oneOf(req.body.decision, ['approved', 'rejected', 'conditions'], { required: true, name: 'החלטה' });
  const comment = v.str(req.body.comment, { max: 2000, name: 'הערה', required: decision !== 'approved' });
  const r = loadRequest(a.request_id);
  if (!['review', 'coordination'].includes(r.status)) throw new HttpError(400, 'אפשר לתת חוות דעת רק כשהבקשה בבדיקה או בתיאום גורמים');
  const turn = currentTurn(r.id);
  if (!turn || turn.id !== a.id) throw new HttpError(409, turn ? `עדיין לא הגיע תורכם. כרגע ממתינים ל${turn.body_name}.` : 'כל הגורמים כבר אישרו');
  db.prepare('UPDATE request_approvals SET decision = ?, comment = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(decision, comment, req.user.id, nowIso(), a.id);
  db.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').run(nowIso(), r.id);
  const body = db.prepare('SELECT name FROM infra_bodies WHERE id = ?').get(a.infra_body_id);
  const label = { approved: 'אישר', rejected: 'דחה', conditions: 'אישר בתנאים' }[decision];
  history(r.id, req.user.id, `${body.name} ${label}`, comment);
  if (r.assignee_id) notify(r.assignee_id, `${body.name} ${label} את בקשה ${r.number}`, `#/requests/${r.id}`);
  notify(r.applicant_id, `${body.name} ${label} את בקשה ${r.number}`, `#/requests/${r.id}`);
  audit(req, 'approval_decided', { approval: a.id, decision });
  // כל גורמי התשתית אישרו → הבקשה עוברת אוטומטית לאישור מנהל המערכת
  let advanced = false;
  if (['review', 'coordination'].includes(r.status)) {
    const left = db.prepare(`SELECT COUNT(*) AS c FROM request_approvals WHERE request_id = ? AND decision NOT IN ${DONE}`).get(r.id).c;
    const fixer = r.fix_auto_approval === a.id && decision !== 'rejected' && r.fix_auto_by ? db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(r.fix_auto_by) : null;
    if (!left && fixer) {
      // התיקון בוצע: מאשרים אוטומטית בשם מנהל המערכת שהחזיר, ומפיקים את מסמך האישור
      db.prepare("UPDATE requests SET status = 'approved', closed_at = ?, fix_auto_approval = NULL, fix_auto_by = NULL, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), r.id);
      history(r.id, null, `${body.name} תיקן ואישר – הבקשה אושרה אוטומטית, בלי בדיקה חוזרת`, null);
      notify(fixer.id, `בקשה ${r.number}: ${body.name} תיקן – הבקשה אושרה אוטומטית והמסמך נשלח למגיש`, `#/requests/${r.id}`);
      audit(req, 'request_auto_approved_after_fix', { id: r.id, approval: a.id }, 'notice');
      const doc = await issueApproval(new Proxy(req, { get: (t, k) => (k === 'user' ? fixer : Reflect.get(t, k, t)) }), r.id, `אושר לאחר תיקון של ${body.name}`);
      return { ok: true, advanced: true, approved: true, approval_doc: doc };
    }
    if (!left) {
      db.prepare("UPDATE requests SET status = 'pending_admin', fix_auto_approval = NULL, fix_auto_by = NULL, updated_at = ? WHERE id = ?").run(nowIso(), r.id);
      history(r.id, null, 'כל גורמי התשתית אישרו – הבקשה הועברה אוטומטית לאישור מנהל המערכת', null);
      notifySysAdmins(`בקשה ${r.number}: כל גורמי התשתית אישרו – ממתינה לאישורך הסופי`, `#/requests/${r.id}`);
      notify(r.applicant_id, `בקשה ${r.number}: כל גורמי התשתית אישרו – ממתינה לאישור מנהל המערכת`, `#/requests/${r.id}`);
      audit(req, 'request_auto_pending_admin', { id: r.id });
      advanced = true;
    } else if (decision !== 'rejected') notifyTurn(r.id, body.name);
  }
  if (decision === 'rejected') {
    const who = [...new Map([...mappingUsers(), ...(r.assignee_id ? [db.prepare('SELECT * FROM users WHERE id = ?').get(r.assignee_id)] : [])].map(u => [u.id, u])).values()];
    for (const u of who) notify(u.id, `${body.name} דחה את בקשה ${r.number}: ${comment}`, `#/requests/${r.id}`);
    mailUsers(who, `בקשה ${r.number}: ${body.name} דחה את הבקשה`, `${body.name} דחה את בקשה ${r.number}.\nנימוק: ${comment}\n\n${linkTo(r.id)}`);
  }
  return { ok: true, advanced };
});

route('POST', '/api/requests/:id/comment', (req) => {
  requireAuth(req);
  const r = loadRequest(req.params.id); assertView(req, r);
  const text = v.str(req.body.text, { max: 2000, required: true, name: 'הערה' });
  history(r.id, req.user.id, 'הערה', text);
  return { ok: true };
});

// ---------------- מסמכים ----------------
function assertDocTarget(req, requestId) {
  if (requestId) { const r = loadRequest(requestId); assertView(req, r); return; }
  throw new sec.ValidationError('יש לשייך את הקובץ לבקשה');
}
route('POST', '/api/documents', async (req) => {
  requirePerm(req, 'files.upload');
  const rl = sec.rateLimit('upload:' + req.user.id, 60, 60 * 60000);
  if (!rl.ok) return status(429, { error: 'יותר מדי העלאות בשעה האחרונה' });
  let f;
  try { f = await up.handleUpload(req); }
  catch (e) { if (e.status === 415 || e.status === 413) audit(req, 'upload_rejected', { reason: e.message }, 'warning'); throw e; }
  try {
    try { await cloud.putFile('uploads/' + f.stored, fs.readFileSync(up.storedPath(f.stored)), f.mime); }
    catch (e) { audit(req, 'cloud_upload_failed', { error: e.message }, 'error'); throw new HttpError(503, 'שמירת הקובץ בענן נכשלה. נסו שוב בעוד רגע.'); }
    const requestId = v.id(f.fields.request_id);
    assertDocTarget(req, requestId);
    const category = v.str(f.fields.category, { max: 60, name: 'קטגוריה' });
    const info = db.prepare('INSERT INTO documents (request_id, category, original_name, stored_name, mime, size, sha256, uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(requestId, category, f.original, f.stored, f.mime, f.size, f.sha256, req.user.id);
    if (requestId) history(requestId, req.user.id, 'הועלה מסמך', f.original);
    audit(req, 'file_uploaded', { id: Number(info.lastInsertRowid), name: f.original, size: f.size });
    return status(201, { id: Number(info.lastInsertRowid) });
  } catch (e) { fs.rm(up.storedPath(f.stored), { force: true }, () => {}); if (e.status !== 503) cloud.deleteFiles(['uploads/' + f.stored]); throw e; }
});

// מדיניות צפייה במסמכים (נקבעת בהגדרות): 'own' = כל משתמש רואה רק מה שהעלה; מנהל המערכת רואה הכל.
// 'request' = כל מי שרשאי לראות את הבקשה / הפרויקט רואה את המסמכים שלו.
const docsOwnOnly = () => getSetting('docs.visibility') !== 'request';
function canSeeDoc(req, d) {
  if (isSysAdmin(req) || can(req, 'requests.mapping')) return true; // מנהל המערכת ואחראי מיפוי רואים הכל
  if (d.visibility === 'restricted') return false;                  // טופס משטרה – רק הם
  if (d.visibility === 'shared' && d.request_id) { const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(d.request_id); return !!r && canViewRequest(req, r); } // מסמך האישור
  if (docsOwnOnly()) return d.uploaded_by === req.user.id;
  if (d.request_id) { const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(d.request_id); return !!r && canViewRequest(req, r); }
  return false;
}
function loadDoc(req) {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!d || !canSeeDoc(req, d)) throw new HttpError(404, 'לא נמצא'); // 404 – לא חושפים שהקובץ קיים
  return d;
}
route('GET', '/api/documents', (req) => {
  requireAuth(req);
  const rows = db.prepare(`SELECT d.id, d.request_id, d.category, d.visibility, d.original_name, d.size, d.mime, d.created_at, d.uploaded_by,
    u.full_name AS uploaded_by_name, r.number AS request_number, r.title AS request_title, r.status AS request_status
    FROM documents d JOIN users u ON u.id = d.uploaded_by JOIN requests r ON r.id = d.request_id ORDER BY d.id DESC LIMIT 1000`).all();
  return { items: rows.filter(d => canSeeDoc(req, d)), ownOnly: docsOwnOnly() && !isSysAdmin(req) && !can(req, 'requests.mapping') };
});
route('GET', '/api/documents/:id/download', async (req, res) => {
  requirePerm(req, 'files.download');
  const d = loadDoc(req);
  const file = up.storedPath(d.stored_name);
  if (!(await cloud.ensureLocal('uploads/' + d.stored_name, file))) throw new HttpError(404, 'הקובץ לא נמצא באחסון');
  const ascii = d.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.writeHead(200, {
    'Content-Type': d.mime, 'Content-Length': fs.statSync(file).size,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(file).pipe(res);
  audit(req, 'file_downloaded', { id: d.id });
});
// צפייה בקובץ בלי להוריד: רק סוגים שהדפדפן מציג בבטחה (PDF, תמונות, טקסט). SVG/HTML לא מוצגים לעולם
// לפי הסיומת – שנבדקה מול תוכן הקובץ בהעלאה
const VIEW_TYPES = { pdf: ['pdf', 'application/pdf'], png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], txt: ['text', 'text/plain'], csv: ['text', 'text/csv'] };
route('GET', '/api/documents/:id/view', async (req, res) => {
  requirePerm(req, 'files.download');
  const d = loadDoc(req);
  const [kind, mime] = VIEW_TYPES[(d.original_name.split('.').pop() || '').toLowerCase()] || [];
  if (!kind) throw new HttpError(415, 'אין תצוגה מקדימה לסוג הקובץ הזה – אפשר להוריד אותו');
  const file = up.storedPath(d.stored_name);
  if (!(await cloud.ensureLocal('uploads/' + d.stored_name, file))) throw new HttpError(404, 'הקובץ לא נמצא באחסון');
  const ascii = d.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.writeHead(200, {
    'Content-Type': kind === 'text' ? mime + '; charset=utf-8' : mime, 'Content-Length': fs.statSync(file).size,
    'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`,
    // מוצג רק בתוך המערכת; תמונות וטקסט גם בארגז חול. PDF בלי ארגז חול, כי אחרת הדפדפן לא מציג אותו
    'Content-Security-Policy': kind === 'pdf' ? "frame-ancestors 'self'; script-src 'none'; object-src 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
    'X-Frame-Options': 'SAMEORIGIN', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
  audit(req, 'file_viewed', { id: d.id });
});
// Word / Excel: תצוגת טקסט וטבלאות (מבנה נתונים, הדפדפן מציג אותו כטקסט בלבד)
route('GET', '/api/documents/:id/preview', async (req) => {
  requirePerm(req, 'files.download');
  const d = loadDoc(req);
  const ext = (d.original_name.split('.').pop() || '').toLowerCase();
  if (!PREVIEW_EXT.includes(ext)) throw new HttpError(415, 'אין תצוגה מקדימה לסוג הקובץ הזה – אפשר להוריד אותו');
  const file = up.storedPath(d.stored_name);
  if (!(await cloud.ensureLocal('uploads/' + d.stored_name, file))) throw new HttpError(404, 'הקובץ לא נמצא באחסון');
  let out;
  try { out = filePreview(ext, fs.readFileSync(file)); } catch (e) { throw new HttpError(422, 'לא ניתן להציג את הקובץ: ' + e.message); }
  audit(req, 'file_viewed', { id: d.id });
  return out;
});
route('DELETE', '/api/documents/:id', (req) => {
  requireAuth(req);
  const d = loadDoc(req);
  if (!(can(req, 'files.delete_all') || (can(req, 'files.delete_own') && d.uploaded_by === req.user.id))) throw new HttpError(403, 'אין הרשאה למחוק קובץ זה');
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  fs.rm(up.storedPath(d.stored_name), { force: true }, () => {});
  cloud.deleteFiles(['uploads/' + d.stored_name]);
  if (d.request_id) history(d.request_id, req.user.id, 'נמחק מסמך', d.original_name);
  audit(req, 'file_deleted', { id: d.id, name: d.original_name });
  return { ok: true };
});

// ---------------- משימות ----------------
const TASK_STATUS = ['פתוחה', 'בביצוע', 'ממתינה', 'הושלמה'];
const TASK_PRIORITY = ['נמוכה', 'רגילה', 'גבוהה', 'דחופה'];
// רק מנהל המערכת ורכז תיאום מקצים משימות. המשימה מוקצית לגורם תשתית, ומגיעה לאיש הקשר שהוגדר לו
const COORDINATOR_ROLE = 'רכז תיאום';
function canAssignTasks(req) {
  if (!req.user) return false;
  if (isSysAdmin(req)) return true;
  const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(req.user.role_id);
  return !!role && role.name === COORDINATOR_ROLE;
}
function requireTaskAssigner(req) { requireAuth(req); if (!canAssignTasks(req)) throw new HttpError(403, 'רק מנהל המערכת או רכז תיאום יכולים להקצות משימות'); }
function taskFields(b) {
  const f = {
    title: v.str(b.title, { max: 200, required: true, name: 'כותרת' }),
    description: v.str(b.description, { max: 3000, name: 'תיאור' }),
    request_id: v.id(b.request_id, { name: 'בקשה' }),
    infra_body_id: v.id(b.infra_body_id, { required: true, name: 'אחראי (גורם תשתית)' }),
    status: v.oneOf(b.status || 'פתוחה', TASK_STATUS, { required: true, name: 'סטטוס' }),
    priority: v.oneOf(b.priority || 'רגילה', TASK_PRIORITY, { required: true, name: 'עדיפות' }),
    start_date: v.date(b.start_date, { name: 'התחלה' }), due_date: v.date(b.due_date, { name: 'יעד' }),
  };
  const body = db.prepare('SELECT b.id, b.name, b.contact_user_id, u.full_name, u.email FROM infra_bodies b LEFT JOIN users u ON u.id = b.contact_user_id AND u.active = 1 WHERE b.id = ?').get(f.infra_body_id);
  if (!body) throw new sec.ValidationError('גורם התשתית לא קיים');
  if (!body.full_name) throw new sec.ValidationError(`לגורם "${body.name}" לא הוגדר איש קשר. מגדירים אותו בתפקידים והרשאות ← גורמי תשתית.`);
  if (f.request_id && !db.prepare('SELECT 1 FROM requests WHERE id = ?').get(f.request_id)) throw new sec.ValidationError('בקשה לא קיימת');
  if (f.start_date && f.due_date && f.due_date < f.start_date) throw new sec.ValidationError('תאריך היעד לפני תאריך ההתחלה');
  f.assignee_id = body.contact_user_id; f.body = body;
  return f;
}
function tellAssignee(req, f, title) {
  if (f.assignee_id === req.user.id) return;
  notify(f.assignee_id, `${title}: ${f.title} (${f.body.name})`, '#/tasks');
  if (f.body.email) mailUsers([{ email: f.body.email, full_name: f.body.full_name }], `${title}: ${f.title}`,
    `שלום ${f.body.full_name},\n\nהוקצתה משימה לגורם "${f.body.name}", שאת/ה איש הקשר שלו:\n${f.title}${f.due_date ? `\nתאריך יעד: ${f.due_date}` : ''}${f.description ? `\n\n${f.description}` : ''}\n\nכניסה למשימות: ${config.publicUrl}/#/tasks\n\n${sysTitle()}`);
}
route('GET', '/api/tasks', (req) => {
  requirePerm(req, 'tasks.view');
  const all = canAssignTasks(req) && req.query.mine !== '1';
  const rows = db.prepare(`SELECT t.*, u.full_name AS assignee_name, b.name AS infra_name, r.number AS request_number FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN infra_bodies b ON b.id = t.infra_body_id LEFT JOIN requests r ON r.id = t.request_id
    ${all ? '' : 'WHERE t.assignee_id = ? OR t.created_by = ?'} ORDER BY t.status = 'הושלמה', t.due_date IS NULL, t.due_date LIMIT 1000`).all(...(all ? [] : [req.user.id, req.user.id]));
  return { items: rows, canAssign: canAssignTasks(req) };
});
// רשימת האחראים: גורמי תשתית פעילים ואיש הקשר של כל אחד
route('GET', '/api/tasks/assignees', (req) => {
  requireTaskAssigner(req);
  return { items: db.prepare(`SELECT b.id, b.name, u.id AS contact_id, u.full_name AS contact_name FROM infra_bodies b
    LEFT JOIN users u ON u.id = b.contact_user_id AND u.active = 1 WHERE b.active = 1 ORDER BY b.name`).all() };
});
route('POST', '/api/tasks', (req) => {
  requireTaskAssigner(req);
  const f = taskFields(req.body);
  const info = db.prepare('INSERT INTO tasks (request_id, infra_body_id, title, description, assignee_id, status, priority, start_date, due_date, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(f.request_id, f.infra_body_id, f.title, f.description, f.assignee_id, f.status, f.priority, f.start_date, f.due_date, req.user.id);
  tellAssignee(req, f, 'משימה חדשה');
  audit(req, 'task_created', { id: Number(info.lastInsertRowid), infra: f.infra_body_id });
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('PUT', '/api/tasks/:id', (req) => {
  requirePerm(req, 'tasks.view');
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) throw new HttpError(404, 'לא נמצא');
  if (!canAssignTasks(req)) {
    // איש הקשר שקיבל את המשימה רשאי לעדכן רק את הסטטוס שלה
    if (t.assignee_id !== req.user.id) throw new HttpError(403, 'אין הרשאה');
    const st = v.oneOf(req.body.status, TASK_STATUS, { required: true, name: 'סטטוס' });
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(st, t.id);
    return { ok: true };
  }
  const f = taskFields({ ...t, ...req.body });
  db.prepare('UPDATE tasks SET project_id=NULL, request_id=?, infra_body_id=?, title=?, description=?, assignee_id=?, status=?, priority=?, start_date=?, due_date=? WHERE id=?')
    .run(f.request_id, f.infra_body_id, f.title, f.description, f.assignee_id, f.status, f.priority, f.start_date, f.due_date, t.id);
  if (f.assignee_id !== t.assignee_id) tellAssignee(req, f, 'הועברה אליך משימה');
  return { ok: true };
});
route('DELETE', '/api/tasks/:id', (req) => {
  requireTaskAssigner(req);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  audit(req, 'task_deleted', { id: req.params.id });
  return { ok: true };
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
  return {
    kpi: { open: open.length, overdue: open.filter(r => r.overdue).length, approved: byStatus.approved || 0,
      myOpen: open.filter(r => r.applicant_id === u.id).length, assignedToMe: open.filter(r => r.assignee_id === u.id).length },
    byStatus, byType, pendingApprovals, myTasks,
    recent: visible.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 8),
  };
});
// ---------------- דוחות וגרפים ----------------
// כל הנתונים מסוננים לפי מה שהמשתמש רשאי לראות; משימות רק עם ההרשאה שלהן.
route('GET', '/api/reports', (req) => {
  requireAuth(req);
  const months = [3, 6, 12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : 12;
  const type = typesMap()[req.query.type] ? req.query.type : null;
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
  let tasks = null;
  if (can(req, 'tasks.view')) {
    const rows = canAssignTasks(req)
      ? db.prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status').all()
      : db.prepare('SELECT status, COUNT(*) AS c FROM tasks WHERE assignee_id = ? GROUP BY status').all(req.user.id);
    tasks = Object.fromEntries(rows.map(x => [x.status, x.c]));
  }
  return {
    months, type, total: all.length,
    trend: { labels: keys, submitted: keys.map(k => submitted[k]), approved: keys.map(k => approved[k]) },
    byStatus, byType,
    sla: { onTime, late, openOverdue: openNow.filter(r => r.overdue).length, open: openNow.length, avgDays: daysN ? Math.round(daysSum / daysN * 10) / 10 : null },
    infra, tasks,
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
  requirePerm(req, 'requests.assign', 'admin.users', 'admin.settings');
  return { items: db.prepare('SELECT u.id, u.full_name, u.department, u.infra_body_id, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 ORDER BY u.full_name').all() };
});
route('GET', '/api/infra', (req) => { requireAuth(req); return { items: db.prepare('SELECT id, name, contact, active FROM infra_bodies ORDER BY name').all() }; });
function contactUser(raw) {
  const id = v.id(raw, { name: 'איש קשר' });
  if (id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) throw new sec.ValidationError('איש הקשר אינו משתמש פעיל');
  return id || null;
}

// ---------------- ניהול: משתמשים ----------------
function cleanPerms(arr) { return Array.isArray(arr) ? [...new Set(arr.filter(p => typeof p === 'string' && KEYS.has(p)))] : []; }
function activeAdmins(exceptId) {
  return db.prepare('SELECT * FROM users WHERE active = 1').all().filter(u => u.id !== exceptId && auth.effectivePerms(u).has('admin.roles') && auth.effectivePerms(u).has('admin.users')).length;
}
route('GET', '/api/admin/users', (req) => {
  requirePerm(req, 'admin.users');
  const links = {};
  for (const x of db.prepare('SELECT ur.user_id, r.id, r.number FROM user_requests ur JOIN requests r ON r.id = ur.request_id').all()) (links[x.user_id] = links[x.user_id] || []).push({ id: x.id, number: x.number });
  return { items: db.prepare('SELECT * FROM users ORDER BY full_name').all().map(u => ({ ...publicUser(u), requests: links[u.id] || [] })),
    roles: db.prepare('SELECT id, name FROM roles ORDER BY id').all(),
    requests: db.prepare("SELECT id, number, title FROM requests WHERE status != 'closed' ORDER BY id DESC LIMIT 2000").all() };
});
// שיוך משתמש לבקשות (לא חובה): רשימת בקשות, או no_request=true להסרת כל השיוכים
function requestLinks(b, required) {
  if (b.no_request === true) return [];
  const ids = Array.isArray(b.request_ids) ? [...new Set(b.request_ids.slice(0, 200).map(x => v.id(x, { required: true, name: 'בקשה' })))] : null;
  if (!ids || !ids.length) { if (required) throw new sec.ValidationError('שיוך לבקשה: שדה חובה (בחרו בקשה או "ללא שיוך לבקשה")'); return null; }
  for (const id of ids) if (!db.prepare('SELECT 1 FROM requests WHERE id = ?').get(id)) throw new sec.ValidationError('בקשה לא קיימת');
  return ids;
}
function infraChoice(b, required) {
  if (b.no_infra === true) return { set: true, id: null };
  const id = v.id(b.infra_body_id, { name: 'גורם תשתית' });
  if (!id) { if (required) throw new sec.ValidationError('גורם תשתית: שדה חובה (בחרו גורם או "לא משויך לגורם")'); return { set: false }; }
  if (!db.prepare('SELECT 1 FROM infra_bodies WHERE id = ?').get(id)) throw new sec.ValidationError('גורם תשתית לא קיים');
  return { set: true, id };
}
function saveLinks(userId, ids) {
  if (ids === null) return;
  db.prepare('DELETE FROM user_requests WHERE user_id = ?').run(userId);
  for (const rid of ids) db.prepare('INSERT OR IGNORE INTO user_requests (user_id, request_id) VALUES (?, ?)').run(userId, rid);
}
route('POST', '/api/admin/users', async (req) => {
  requirePerm(req, 'admin.users');
  const b = req.body;
  const username = v.str(normUser(b.username), { max: 60, required: true, name: 'שם משתמש', pattern: USERNAME_RE });
  const full_name = v.str(b.full_name, { max: 100, required: true, name: 'שם מלא' });
  const email = v.str(b.email, { max: 200, name: 'דוא"ל', pattern: v.EMAIL });
  const role_id = v.id(b.role_id, { required: true, name: 'תפקיד' });
  if (!db.prepare('SELECT 1 FROM roles WHERE id = ?').get(role_id)) throw new sec.ValidationError('תפקיד לא קיים');
  const infraSel = infraChoice(b, true);
  const reqIds = requestLinks(b, false); // שיוך לבקשה אינו חלק מיצירת משתמש
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new sec.ValidationError('שם המשתמש תפוס');
  const probs = sec.passwordProblems(b.password, username);
  if (probs.length) throw new sec.ValidationError('סיסמה חלשה: ' + probs.join(', '));
  const hash = await sec.hashPassword(b.password);
  const info = db.prepare(`INSERT INTO users (username, full_name, email, phone, department, password_hash, role_id, infra_body_id, must_change_pw)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(username, full_name, email, v.str(b.phone, { max: 30, name: 'טלפון', pattern: /^[\d+\-\s()]*$/ }),
    v.str(b.department, { max: 100, name: 'מחלקה' }), hash, role_id, infraSel.id);
  saveLinks(Number(info.lastInsertRowid), reqIds);
  audit(req, 'user_created', { id: Number(info.lastInsertRowid), username, role_id, infra: infraSel.id, requests: reqIds }, 'notice');
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('PUT', '/api/admin/users/:id', (req) => {
  requirePerm(req, 'admin.users');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'משתמש לא נמצא');
  const b = req.body;
  const upd = {
    username: v.str(normUser(b.username ?? u.username), { max: 60, required: true, name: 'שם משתמש', pattern: USERNAME_RE }),
    full_name: v.str(b.full_name ?? u.full_name, { max: 100, required: true, name: 'שם מלא' }),
    email: v.str(b.email ?? u.email, { max: 200, name: 'דוא"ל', pattern: v.EMAIL }),
    phone: v.str(b.phone ?? u.phone, { max: 30, name: 'טלפון', pattern: /^[\d+\-\s()]*$/ }),
    department: v.str(b.department ?? u.department, { max: 100, name: 'מחלקה' }),
    role_id: v.id(b.role_id ?? u.role_id, { required: true, name: 'תפקיד' }),
    infra_body_id: (() => { const c = infraChoice(b, false); return c.set ? c.id : u.infra_body_id; })(),
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
  saveLinks(u.id, requestLinks(b, false));
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

// ---------------- ניהול: הגדרות (סוגי קבצים, גודל, זמני טיפול) ----------------
route('GET', '/api/admin/settings', (req) => {
  requirePerm(req, 'admin.settings');
  return {
    allowed_ext: up.allowedExt(), max_mb: Math.round(up.maxBytes() / 1048576), hard_max_mb: config.hardMaxUploadMb,
    known_ext: Object.keys(up.MIME), forbidden_ext: [...up.FORBIDDEN_EXT].sort(),
    sla_regular_days: +getSetting('sla.regular_days'),
    org_name: getSetting('org.name'), system_title: getSetting('org.system_title'),
    req_prefix: getSetting('requests.prefix'), req_with_year: getSetting('requests.with_year') === '1', req_pad: +getSetting('requests.pad'),
    reminder_enabled: reminderSettings().enabled, reminder_days: reminderSettings().days, reminder_repeat_days: reminderSettings().repeat, govmap_token: getSetting('govmap.token') || '', govmap_env: !!config.govmapToken, guidelines: getSetting('approval.guidelines') || '', login_heading: getSetting('login.heading') || '', login_text: getSetting('login.text') || '', public_apply: getSetting('public.apply') !== '0',
    req_next_preview: nextRequestNumber(), logo: !!getSetting('org.logo'), docs_visibility: docsOwnOnly() ? 'own' : 'request',
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
  if (b.sla_regular_days !== undefined) setSetting('sla.regular_days', v.num(b.sla_regular_days, { min: 1, max: 365, name: 'ימי טיפול' }));
  if (b.org_name !== undefined) setSetting('org.name', v.str(b.org_name, { max: 100, required: true, name: 'שם הארגון' }));
  if (b.system_title !== undefined) setSetting('org.system_title', v.str(b.system_title, { max: 100, required: true, name: 'שם המערכת' }));
  if (b.login_heading !== undefined) setSetting('login.heading', v.str(b.login_heading, { max: 120, name: 'כותרת מסך הכניסה' }) || '');
  if (b.login_text !== undefined) setSetting('login.text', v.str(b.login_text, { max: 600, name: 'תיאור במסך הכניסה' }) || '');
  if (b.reminder_enabled !== undefined) setSetting('reminder.enabled', b.reminder_enabled ? '1' : '0');
  if (b.reminder_days !== undefined) setSetting('reminder.days', String(Math.round(v.num(b.reminder_days, { min: 1, max: 365, required: true, name: 'ימים עד תזכורת' }))));
  if (b.reminder_repeat_days !== undefined) setSetting('reminder.repeat_days', String(Math.round(v.num(b.reminder_repeat_days, { min: 0, max: 365, required: true, name: 'תזכורת חוזרת כל' }))));
  if (b.govmap_token !== undefined) setSetting('govmap.token', v.str(b.govmap_token, { max: 400, name: 'מפתח GovMap', pattern: /^[A-Za-z0-9._\-=+/]*$/ }) || '');
  if (b.guidelines !== undefined) setSetting('approval.guidelines', v.str(b.guidelines, { max: 8000, name: 'הנחיות' }) || '');
  if (b.public_apply !== undefined) setSetting('public.apply', b.public_apply ? '1' : '0');
  if (b.docs_visibility !== undefined) setSetting('docs.visibility', v.oneOf(b.docs_visibility, ['own', 'request'], { required: true, name: 'חשיפת מסמכים' }));
  if (b.req_prefix !== undefined) setSetting('requests.prefix', v.str(b.req_prefix, { max: 10, name: 'קידומת', pattern: /^[A-Za-z0-9\u0590-\u05FF]*$/ }) || '');
  if (b.req_with_year !== undefined) setSetting('requests.with_year', b.req_with_year ? '1' : '0');
  if (b.req_pad !== undefined) setSetting('requests.pad', v.num(b.req_pad, { min: 1, max: 8, name: 'מספר ספרות' }));
  if (b.req_next !== undefined && b.req_next !== null && b.req_next !== '') setSetting('requests.next', v.num(b.req_next, { min: 1, max: 99999999, name: 'המספר הבא' }));
  audit(req, 'settings_updated', b, 'notice');
  return { ok: true };
});
route('GET', '/api/admin/infra', (req) => {
  requirePerm(req, 'admin.roles', 'admin.settings');
  return { items: db.prepare(`SELECT b.*, cu.full_name AS contact_user_name, (SELECT COUNT(*) FROM request_approvals ra WHERE ra.infra_body_id = b.id) AS requests,
    (SELECT json_group_array(json_object('id', u.id, 'full_name', u.full_name)) FROM users u WHERE u.infra_body_id = b.id AND u.active = 1) AS members
    FROM infra_bodies b LEFT JOIN users cu ON cu.id = b.contact_user_id ORDER BY b.active DESC, b.name`).all().map(b => ({ ...b, members: JSON.parse(b.members) })) };
});
route('POST', '/api/admin/infra', (req) => {
  requirePerm(req, 'admin.roles', 'admin.settings');
  const name = v.str(req.body.name, { max: 100, required: true, name: 'שם גורם' });
  if (db.prepare('SELECT 1 FROM infra_bodies WHERE name = ?').get(name)) throw new sec.ValidationError('גורם בשם זה קיים');
  const info = db.prepare('INSERT INTO infra_bodies (name, contact, contact_user_id) VALUES (?, ?, ?)').run(name, v.str(req.body.contact, { max: 200, name: 'איש קשר' }), contactUser(req.body.contact_user_id));
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
    db.prepare('UPDATE infra_bodies SET name = ?, contact = ?, contact_user_id = ?, active = ? WHERE id = ?').run(name, v.str(req.body.contact ?? b.contact, { max: 200, name: 'איש קשר' }),
      req.body.contact_user_id === undefined ? b.contact_user_id : contactUser(req.body.contact_user_id), req.body.active === undefined ? b.active : (req.body.active ? 1 : 0), b.id);
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
route('GET', '/api/admin/backups', (req) => { requirePerm(req, 'admin.backup'); return { status: backup.status(), cloud: cloud.state, items: backup.listBackups().slice(0, 100) }; });
route('POST', '/api/admin/backups', async (req) => {
  requirePerm(req, 'admin.backup');
  const r = await backup.runBackup('manual');
  if (cloud.enabled) await cloud.syncNow('manual');
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
  try { await cloud.putFile('logo/' + name, file.data, LOGO_TYPES[ext]); } catch (e) { throw new HttpError(503, 'שמירת הלוגו בענן נכשלה. נסו שוב בעוד רגע.'); }
  fs.writeFileSync(path.join(config.dataDir, name), file.data, { mode: 0o600 });
  const old = getSetting('org.logo');
  setSetting('org.logo', name);
  if (old && /^logo-\d+\.(png|jpg|webp)$/.test(old)) { fs.rm(path.join(config.dataDir, old), { force: true }, () => {}); cloud.deleteFiles(['logo/' + old]); }
  audit(req, 'logo_updated', { size: file.data.length }, 'notice');
  return { ok: true, logo: name };
});
route('DELETE', '/api/admin/logo', (req) => {
  requirePerm(req, 'admin.settings');
  const old = getSetting('org.logo');
  setSetting('org.logo', '');
  if (old && /^logo-\d+\.(png|jpg|webp)$/.test(old)) { fs.rm(path.join(config.dataDir, old), { force: true }, () => {}); cloud.deleteFiles(['logo/' + old]); }
  audit(req, 'logo_removed', {}, 'notice');
  return { ok: true };
});
route('GET', '/api/logo', async (req, res) => {
  const name = getSetting('org.logo');
  if (!name || !/^logo-\d+\.(png|jpg|webp)$/.test(name)) throw new HttpError(404, 'אין לוגו');
  const file = path.join(config.dataDir, name);
  if (!(await cloud.ensureLocal('logo/' + name, file))) throw new HttpError(404, 'אין לוגו');
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': LOGO_TYPES[name.split('.').pop()], 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' });
  res.end(buf);
});

// ---------------- הגשת בקשה מהציבור (תושב/ת או יזם) ----------------
const KINDS = { resident: 'תושב/ת', entrepreneur: 'יזם' };
// ---- מיקום (GovMap, קואורדינטות רשת ישראל החדשה ITM) ----
const KG_CENTER = { x: 177750, y: 613200, level: 6 }; // מרכז קריית גת
const govmapToken = () => config.govmapToken || getSetting('govmap.token') || '';
function locationField(raw, { required = true } = {}) {
  let o = raw;
  if (typeof raw === 'string') { if (!raw.trim()) o = null; else { try { o = JSON.parse(raw); } catch { throw new sec.ValidationError('מיקום: נתונים לא תקינים'); } } }
  if (!o) { if (required) throw new sec.ValidationError('מיקום: יש לסמן את מיקום העבודה במפה'); return null; }
  if (typeof o !== 'object' || Array.isArray(o)) throw new sec.ValidationError('מיקום: נתונים לא תקינים');
  const x = Number(o.x), y = Number(o.y), z = o.z === undefined || o.z === null || o.z === '' ? 9 : Number(o.z);
  // גבולות רשת ישראל: מחוץ להם זה לא מיקום בישראל
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 100000 || x > 300000 || y < 350000 || y > 820000) throw new sec.ValidationError('מיקום: הנקודה שסומנה אינה בתחומי ישראל');
  if (!Number.isFinite(z) || z < 0 || z > 10) throw new sec.ValidationError('מיקום: רמת תקריב לא תקינה');
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 10) / 10, label: v.str(o.label, { max: 300, name: 'תיאור המיקום' }) };
}
const govmapLink = (x, y, z = 9) => `https://www.govmap.gov.il/?c=${x},${y}&z=${z}`;
route('GET', '/api/public/map-config', () => ({ token: govmapToken(), center: KG_CENTER }));
route('PUT', '/api/requests/:id/location', (req) => {
  requireAuth(req);
  const r = loadRequest(req.params.id); assertView(req, r);
  if (!canEditRequest(req, r) && !can(req, 'requests.mapping') && !can(req, 'requests.assign')) throw new HttpError(403, 'אין הרשאה לעדכן את המיקום');
  const loc = locationField(req.body.location);
  db.prepare('UPDATE requests SET loc_x = ?, loc_y = ?, loc_z = ?, loc_label = ?, updated_at = ? WHERE id = ?').run(loc.x, loc.y, loc.z, loc.label, nowIso(), r.id);
  history(r.id, req.user.id, 'עודכן מיקום העבודה', `${loc.x}, ${loc.y}${loc.label ? ' – ' + loc.label : ''}`);
  audit(req, 'request_location', { id: r.id });
  return { ok: true };
});

const { preview: filePreview, PREVIEW_EXT } = require('./preview');
const ROUTE_EXT = ['pdf', 'dwf'];
const WORKREQ_EXT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
function validIsraeliId(id) {
  if (!/^\d{5,9}$/.test(id)) return false;
  const s9 = id.padStart(9, '0'); let sum = 0;
  for (let i = 0; i < 9; i++) { let n = +s9[i] * ((i % 2) + 1); if (n > 9) n -= 9; sum += n; }
  return sum % 10 === 0;
}
const normPhone = (p) => String(p ?? '').replace(/[\s\-()]/g, '').replace(/^\+972/, '0');
function phoneField(v0, name) {
  const p = normPhone(v0);
  if (!/^0\d{8,9}$/.test(p)) throw new sec.ValidationError(`${name}: מספר טלפון ישראלי לא תקין`);
  return p;
}
function policeFields(raw) {
  let p; try { p = JSON.parse(raw || ''); } catch { throw new sec.ValidationError('טופס משטרה: יש למלא את הטופס'); }
  if (!p || typeof p !== 'object') throw new sec.ValidationError('טופס משטרה: יש למלא את הטופס');
  const idKind = v.oneOf(p.id_kind, ['id', 'company'], { required: true, name: 'טופס משטרה – סוג מזהה' });
  const idNum = v.str(String(p.id_number ?? '').replace(/\D/g, ''), { required: true, max: 9, name: idKind === 'id' ? 'טופס משטרה – תעודת זהות' : 'טופס משטרה – ח.פ' });
  if (idKind === 'id' && !validIsraeliId(idNum)) throw new sec.ValidationError('טופס משטרה – תעודת זהות לא תקינה (ספרת ביקורת שגויה)');
  if (idKind === 'company' && !/^\d{9}$/.test(idNum)) throw new sec.ValidationError('טופס משטרה – ח.פ חייב להיות 9 ספרות');
  const out = {
    applicant_name: v.str(p.applicant_name, { required: true, max: 100, name: 'טופס משטרה – שם מבקש/ת' }),
    project: v.str(p.project, { required: true, max: 200, name: 'טופס משטרה – פרויקט' }),
    id_kind: idKind, id_number: idNum.padStart(idKind === 'id' ? 9 : 9, '0'),
    phone: phoneField(p.phone, 'טופס משטרה – פלאפון'),
    description: v.str(p.description, { required: true, max: 2000, name: 'טופס משטרה – תיאור' }),
    work_time: v.str(p.work_time, { required: true, max: 200, name: 'טופס משטרה – זמן עבודה' }),
    work_hours: v.str(p.work_hours, { required: true, max: 100, name: 'טופס משטרה – שעות עבודה' }),
    // איש קשר: שם מלא ופלאפון (שדות נפרדים). contact נשמר גם כשורה אחת, לתצוגה ולתאימות לאחור
    contact_name: v.str(p.contact_name, { required: true, max: 100, name: 'טופס משטרה – איש קשר, שם מלא' }),
    contact_phone: phoneField(p.contact_phone, 'טופס משטרה – איש קשר, פלאפון'),
    notes: v.str(p.notes, { max: 2000, name: 'טופס משטרה – הערות' }),
    date: v.date(p.date, { required: true, name: 'טופס משטרה – תאריך' }),
  };
  out.contact = `${out.contact_name} ${out.contact_phone}`;
  return out;
}
// תפקיד למשתמש שנרשם: לפי סוג הבקשה וסוג המגיש, או תפקיד ברירת המחדל "תושב/ת" / "יזם"
function publicRole(type, kind) {
  const id = kind === 'entrepreneur' ? type.role_entrepreneur : type.role_resident;
  const row = id ? db.prepare('SELECT * FROM roles WHERE id = ?').get(id) : db.prepare('SELECT * FROM roles WHERE name = ?').get(KINDS[kind]);
  if (!row || !safePublicRole(row)) throw new HttpError(500, 'לא הוגדר תפקיד לנרשמים מהציבור');
  return row.id;
}
// תפקיד שמותר לתת לנרשם מהציבור: לא תפקיד מערכת ובלי שום הרשאת ניהול / מיפוי / צפייה בכל הבקשות
const PUBLIC_FORBIDDEN = ['admin.', 'requests.view_all', 'requests.edit_all', 'requests.delete', 'requests.mapping', 'requests.final_approve', 'requests.assign', 'files.delete_all', 'budget.manage'];
function safePublicRole(role) { return !role.system && !JSON.parse(role.perms).some(p => PUBLIC_FORBIDDEN.some(f => p === f || (f.endsWith('.') && p.startsWith(f)))); }

route('GET', '/api/public/apply-meta', () => {
  const on = getSetting('public.apply') !== '0';
  return { enabled: on, types: on ? typesAll().filter(t => t.active && t.public).map(t => ({ key: t.key, name: t.name, description: t.description || '', bodies: typeChain(t.key).map(id => db.prepare('SELECT name FROM infra_bodies WHERE id = ?').get(id).name) })) : [],
    maxMb: Math.round(up.maxBytes() / 1048576), routeExt: ROUTE_EXT, workExt: WORKREQ_EXT, map: !!govmapToken(), center: KG_CENTER };
});

route('POST', '/api/public/apply', async (req, res) => {
  if (getSetting('public.apply') === '0') return status(403, { error: 'הגשת בקשות מהאתר סגורה כרגע' });
  if (req.user) return status(400, { error: 'כבר מחוברים למערכת. להגשת בקשה נוספת התנתקו ולחצו "הגשת בקשה" במסך הכניסה.' });
  const ip = sec.clientIp(req);
  const rl = sec.rateLimit('apply:' + ip, 5, 60 * 60000, { persist: true });
  if (!rl.ok) { audit(req, 'apply_rate_limited', {}, 'warning'); res.setHeader('Retry-After', rl.retryAfter); return status(429, { error: 'הוגשו יותר מדי בקשות מהמחשב הזה. נסו שוב בעוד שעה.' }); }
  const { fields: f, files } = await up.parseMultipart(req, up.maxBytes() * 2 + 256 * 1024, { multi: true });
  if (f.website) { audit(req, 'apply_honeypot', {}, 'warning'); return status(400, { error: 'הבקשה לא תקינה' }); } // שדה מלכודת לבוטים
  // ---- אימות שדות (בשרת – מחייב) ----
  const kind = v.oneOf(f.kind, Object.keys(KINDS), { required: true, name: 'סוג מגיש' });
  const username = v.str(normUser(f.username), { required: true, max: 60, name: 'שם משתמש', pattern: USERNAME_RE });
  const probs = sec.passwordProblems(f.password, username);
  if (probs.length) throw new sec.ValidationError('סיסמה חלשה: ' + probs.join(', '));
  const type = typesAll().find(t => t.key === f.type && t.active && t.public);
  if (!type) throw new sec.ValidationError('סוג בקשה: יש לבחור מהרשימה');
  const email = v.str(f.email, { required: true, max: 200, name: 'אימייל', pattern: v.EMAIL });
  const address = v.str(f.address, { required: true, max: 300, name: 'כתובת מגורים' });
  const phone = phoneField(f.phone, 'פלאפון');
  const project = v.str(f.project, { required: true, max: 200, name: 'פרויקט' });
  const loc = locationField(f.location);
  const police = policeFields(f.police);
  const routeFile = files.find(x => x.name === 'route_plan'); const workFile = files.find(x => x.name === 'work_request');
  if (!routeFile) throw new sec.ValidationError('תוכנית תוואי: יש לצרף קובץ PDF או DWF');
  if (!workFile) throw new sec.ValidationError('בקשת עבודה: יש לצרף קובץ');
  let routeChk, workChk;
  try { routeChk = up.checkFile(routeFile.filename, routeFile.data, ROUTE_EXT, 'תוכנית תוואי'); workChk = up.checkFile(workFile.filename, workFile.data, WORKREQ_EXT, 'בקשת עבודה'); }
  catch (e) { audit(req, 'upload_rejected', { reason: e.message }, 'warning'); throw e; }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new sec.ValidationError('שם המשתמש תפוס. בחרו שם אחר, או היכנסו עם המשתמש הקיים.');
  const roleId = publicRole(type, kind);
  const hash = await sec.hashPassword(f.password);
  // ---- קבצים לדיסק ----
  const stored = [];
  const keep = (buf) => { const st = up.storeBuffer(buf); stored.push(st.stored); return st; };
  let created;
  try {
    const stRoute = keep(routeFile.data); const stWork = keep(workFile.data);
    // אין מטפלים אוטומטיים: הבקשה מגיעה לאחראי מיפוי הבקשות ולמנהל המערכת, והם בוחרים מי מטפל
    const handlers = [];
    const chain = typeChain(type.key); // גורמי התשתית הקבועים של הסוג נכנסים לבקשה אוטומטית
    created = tx(() => {
      const u = db.prepare(`INSERT INTO users (username, full_name, email, phone, address, password_hash, role_id, applicant_kind, must_change_pw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(username, police.applicant_name, email, phone, address, hash, roleId, kind);
      const userId = Number(u.lastInsertRowid);
      const number = nextRequestNumber();
      const title = `${type.name} – ${project}`.slice(0, 200);
      const rq = db.prepare(`INSERT INTO requests (number, type, title, description, project_name, address, loc_x, loc_y, loc_z, loc_label, work_time, applicant_id, assignee_id, status, track, track_status, applicant_kind, planned_start, submitted_at, due_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'regular', 'none', ?, ?, ?, ?)`)
        .run(number, type.key, title, police.description, project, loc.label, loc.x, loc.y, loc.z, loc.label, police.work_time, userId, handlers[0] || null, kind, police.date, nowIso(), addDays(slaDays('regular', 'none')));
      const requestId = Number(rq.lastInsertRowid);
      for (const h of handlers) db.prepare('INSERT OR IGNORE INTO user_requests (user_id, request_id) VALUES (?, ?)').run(h, requestId);
      chain.forEach((bid, i) => db.prepare('INSERT OR IGNORE INTO request_approvals (request_id, infra_body_id, seq) VALUES (?, ?, ?)').run(requestId, bid, i + 1));
      if (chain.length) history(requestId, null, 'גורמי התשתית נקבעו אוטומטית לפי סוג הבקשה', chain.map(id => db.prepare('SELECT name FROM infra_bodies WHERE id = ?').get(id).name).join(' ← '));
      db.prepare('INSERT INTO request_police (request_id, data) VALUES (?, ?)').run(requestId, JSON.stringify(police));
      const doc = db.prepare('INSERT INTO documents (request_id, category, original_name, stored_name, mime, size, sha256, uploaded_by, visibility) VALUES (?,?,?,?,?,?,?,?,?)');
      doc.run(requestId, 'תוכנית תוואי', routeChk.original, stRoute.stored, routeChk.mime, stRoute.size, stRoute.sha256, userId, 'default');
      doc.run(requestId, 'בקשת עבודה', workChk.original, stWork.stored, workChk.mime, stWork.size, stWork.sha256, userId, 'default');
      // טופס משטרה → PDF מוגבל (מנהל המערכת ואחראי מיפוי בלבד)
      const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
      const pdf = docsPdf.policePdf({ org: getSetting('org.name'), systemTitle: sysTitle(), logo: logoBuffer(), request: r, police }).buffer;
      const stPol = keep(pdf);
      doc.run(requestId, 'טופס משטרה', `טופס משטרה – ${number}.pdf`, stPol.stored, 'application/pdf', stPol.size, stPol.sha256, userId, 'restricted');
      history(requestId, userId, 'הבקשה הוגשה מהאתר', `${KINDS[kind]} · ${type.name}`);
      return { userId, requestId, number, handlers, pdf, stPol: stPol.stored, stRoute: stRoute.stored, stWork: stWork.stored };
    });
  } catch (e) { for (const n of stored) fs.rm(up.storedPath(n), { force: true }, () => {}); throw e; }
  // ענן (אם הוגדר)
  for (const [n, buf, t] of [[created.stRoute, routeFile.data, routeChk.mime], [created.stWork, workFile.data, workChk.mime], [created.stPol, created.pdf, 'application/pdf']]) {
    try { await cloud.putFile('uploads/' + n, buf, t); } catch (e) { audit(req, 'cloud_upload_failed', { error: e.message }, 'error'); }
  }
  // התראה + דוא"ל לאחראי מיפוי ולמנהלי המערכת, ולמטפלים שהוגדרו לסוג הבקשה
  const link = `#/requests/${created.requestId}`;
  const mappers = mappingUsers();
  const handlerUsers = created.handlers.map(id => db.prepare('SELECT * FROM users WHERE id = ?').get(id)).filter(Boolean);
  const all = [...new Map([...mappers, ...handlerUsers].map(u => [u.id, u])).values()];
  const text = `בקשה חדשה ${created.number} הוגשה מהאתר (${KINDS[kind]}): ${type.name} – ${project}. יש להזין את גורמי התשתית הרלוונטיים.`;
  for (const u of all) notify(u.id, text, link);
  mailUsers(all, `בקשה חדשה ${created.number} – ${type.name}`, `שלום,\n\n${text}\nמגיש/ה: ${police.applicant_name}, ${phone}, ${email}\n\nלמיפוי הבקשה: ${linkTo(created.requestId)}\n\n${sysTitle()}`);
  mailUsers([{ email }], `בקשה ${created.number} התקבלה – ${sysTitle()}`, `שלום ${police.applicant_name},\n\nבקשתך התקבלה ומספרה ${created.number}. הבקשה עוברת להמשך טיפול.\nאפשר לעקוב אחריה במערכת עם שם המשתמש ${username}: ${config.publicUrl}\n\n${getSetting('org.name')}`);
  req.user = { id: created.userId, username };
  audit(req, 'public_apply', { request: created.requestId, number: created.number, kind, type: type.key }, 'notice');
  // כניסה אוטומטית כדי לעקוב אחרי הבקשה
  const csrf = auth.createSession(res, created.userId, req, false);
  return status(201, { ok: true, number: created.number, id: created.requestId, csrf });
});

// ---------------- ניהול סוגי בקשות ----------------
function typeFields(b, cur = {}) {
  const ids = (arr, table, name) => {
    if (arr === undefined) return undefined;
    if (!Array.isArray(arr) || arr.length > 50) throw new sec.ValidationError(`${name}: רשימה לא תקינה`);
    const out = [...new Set(arr.map(x => v.id(x, { required: true, name })))];
    for (const id of out) if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw new sec.ValidationError(`${name}: לא קיים`);
    return out;
  };
  const role = (x, name) => {
    if (x === undefined) return undefined; const id = v.id(x, { name }); if (!id) return null;
    const r = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
    if (!r) throw new sec.ValidationError(`${name}: תפקיד לא קיים`);
    if (!safePublicRole(r)) throw new sec.ValidationError(`${name}: אי אפשר לתת לנרשמים מהציבור תפקיד עם הרשאות ניהול או צפייה בכל הבקשות`);
    return id;
  };
  return {
    name: v.str(b.name ?? cur.name, { required: true, max: 100, name: 'שם סוג הבקשה' }),
    description: v.str(b.description ?? cur.description, { max: 500, name: 'תיאור' }),
    active: b.active === undefined ? (cur.active ?? 1) : (b.active ? 1 : 0),
    public: b.public === undefined ? (cur.public ?? 1) : (b.public ? 1 : 0),
    infra_chain: ids(b.infra_chain, 'infra_bodies', 'גורמי תשתית'),
    role_resident: role(b.role_resident, 'תפקיד לתושב/ת'),
    role_entrepreneur: role(b.role_entrepreneur, 'תפקיד ליזם'),
  };
}
route('GET', '/api/admin/request-types', (req) => {
  requirePerm(req, 'admin.settings');
  return { items: typesAll().map(t => ({ ...t, handler_ids: undefined, infra_chain: JSON.parse(t.infra_chain),
    requests: db.prepare('SELECT COUNT(*) AS c FROM requests WHERE type = ?').get(t.key).c })),
    roles: db.prepare('SELECT * FROM roles ORDER BY id').all().filter(safePublicRole).map(r => ({ id: r.id, name: r.name })) };
});
route('POST', '/api/admin/request-types', (req) => {
  requirePerm(req, 'admin.settings');
  const f = typeFields(req.body);
  if (db.prepare('SELECT 1 FROM request_types WHERE name = ?').get(f.name)) throw new sec.ValidationError('סוג בקשה בשם זה קיים');
  const sort = (db.prepare('SELECT MAX(sort) AS m FROM request_types').get().m || 0) + 1;
  const info = db.prepare(`INSERT INTO request_types (key, name, description, active, public, handler_ids, infra_chain, role_resident, role_entrepreneur, sort) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('t' + Date.now().toString(36), f.name, f.description, f.active, f.public, '[]', JSON.stringify(f.infra_chain || []), f.role_resident ?? null, f.role_entrepreneur ?? null, sort);
  audit(req, 'request_type_created', { id: Number(info.lastInsertRowid), name: f.name }, 'notice');
  return status(201, { id: Number(info.lastInsertRowid) });
});
route('PUT', '/api/admin/request-types/:id', (req) => {
  requirePerm(req, 'admin.settings');
  const cur = db.prepare('SELECT * FROM request_types WHERE id = ?').get(req.params.id);
  if (!cur) throw new HttpError(404, 'לא נמצא');
  const f = typeFields(req.body, cur);
  if (db.prepare('SELECT 1 FROM request_types WHERE name = ? AND id != ?').get(f.name, cur.id)) throw new sec.ValidationError('סוג בקשה בשם זה קיים');
  db.prepare(`UPDATE request_types SET name=?, description=?, active=?, public=?, handler_ids=?, infra_chain=?, role_resident=?, role_entrepreneur=? WHERE id=?`)
    .run(f.name, f.description, f.active, f.public, '[]', f.infra_chain ? JSON.stringify(f.infra_chain) : cur.infra_chain,
      f.role_resident === undefined ? cur.role_resident : f.role_resident, f.role_entrepreneur === undefined ? cur.role_entrepreneur : f.role_entrepreneur, cur.id);
  audit(req, 'request_type_updated', { id: cur.id }, 'notice');
  return { ok: true };
});
route('DELETE', '/api/admin/request-types/:id', (req) => {
  requirePerm(req, 'admin.settings');
  const cur = db.prepare('SELECT * FROM request_types WHERE id = ?').get(req.params.id);
  if (!cur) throw new HttpError(404, 'לא נמצא');
  if (db.prepare('SELECT 1 FROM requests WHERE type = ?').get(cur.key)) throw new sec.ValidationError('יש בקשות מהסוג הזה – אפשר להשבית אותו, לא למחוק');
  db.prepare('DELETE FROM request_types WHERE id = ?').run(cur.id);
  audit(req, 'request_type_deleted', { id: cur.id, name: cur.name }, 'notice');
  return { ok: true };
});

module.exports = { match, runReminders };
