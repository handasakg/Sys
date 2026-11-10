'use strict';
// בדיקות אבטחה אמיתיות מול שרת רץ: מפעיל שני מופעים (פרודקשן ללא TLS מקומי, ופרודקשן עם HTTPS מחויב)
// על תיקיית נתונים זמנית, ומריץ התקפות נגד כל הגנה. התוצאה נשמרת בתיקייה הזמנית של המערכת
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const results = [];
function rec(area, name, pass, detail = '') { results.push({ area, name, pass: !!pass, detail: String(detail).slice(0, 300) }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ' – ' + detail : ''}`); }
const rnd = () => crypto.randomInt(1, 254);
const pw = () => 'Tst' + crypto.randomBytes(9).toString('base64url') + '7a';

function startServer(env, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DISABLE_BACKUPS: '1', ...env } });
    let out = '';
    child.stdout.on('data', d => { out += d; if (out.includes('פועלת')) resolve(child); });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', c => reject(new Error('server exited ' + c + ' ' + out)));
    setTimeout(() => reject(new Error('timeout ' + out)), 8000);
  });
}

class Client {
  constructor(base, ip) { this.base = base; this.cookie = ''; this.csrf = ''; this.ip = ip || `10.${rnd()}.${rnd()}.${rnd()}`; }
  async req(method, url, body, { headers = {}, raw = false, noCsrf = false } = {}) {
    const h = { 'X-Requested-With': 'fetch', 'X-Forwarded-For': this.ip, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (this.csrf && !noCsrf && !headers['X-CSRF-Token']) h['X-CSRF-Token'] = this.csrf;
    let b = body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers: h, body: b, redirect: 'manual' });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const v = c.split(';')[0]; if (/=$/.test(v)) this.cookie = ''; else this.cookie = v; }
    if (raw) return res;
    let data = null; const text = await res.text(); try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers, setCookie: sc };
  }
  async login(u, p) { const r = await this.req('POST', '/api/auth/login', { username: u, password: p }); if (r.data && r.data.csrf) this.csrf = r.data.csrf; return r; }
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-test-'));
  const env = { NODE_ENV: 'production', FORCE_HTTPS: '0', TRUST_PROXY: '1', DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'uploads'), BACKUP_DIR: path.join(dataDir, 'backups'), LOG_DIR: path.join(dataDir, 'logs') };
  const PORT = 4801; const base = `http://127.0.0.1:${PORT}`;
  let srv;
  try {
    // ---------- מופע 1 ----------
    srv = await startServer(env, PORT);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'app.db'));

    rec('הרשאות', 'אין משתמשי ברירת מחדל במסד חדש', db.prepare('SELECT COUNT(*) c FROM users').get().c === 0);
    const anon = new Client(base);
    for (const [u, p] of [['admin', 'admin'], ['admin', 'password'], ['root', 'root'], ['administrator', '123456']]) {
      const r = await anon.login(u, p);
      if (r.status !== 401) { rec('הרשאות', `התחברות ${u}/${p} נחסמת`, false, r.status); }
    }
    rec('הרשאות', 'צירופי ברירת מחדל נפוצים (admin/admin וכו׳) נדחים', true);

    // יצירת מנהל דרך הסקריפט
    const adminPw = pw();
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'create-admin.js'], { cwd: ROOT, env: { ...process.env, ...env, ADMIN_USERNAME: 'chief', ADMIN_FULLNAME: 'מנהל ראשי', ADMIN_PASSWORD: adminPw } });
    const hash = db.prepare("SELECT password_hash FROM users WHERE username='chief'").get().password_hash;
    rec('סיסמאות', 'סיסמה נשמרת כ-hash (scrypt + salt) ולא כטקסט', hash.startsWith('scrypt$32768$') && !hash.includes(adminPw), hash.slice(0, 20) + '…');
    const admin = new Client(base);
    let r = await admin.login('chief', adminPw);
    rec('אימות', 'מנהל מתחבר עם סיסמה נכונה', r.status === 200);
    const sc = r.setCookie.join(' ');
    rec('Cookies', 'עוגיית סשן HttpOnly + SameSite=Strict', /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), sc.replace(/=[^;]+/, '=***'));
    rec('אימות', 'אסימון הסשן נשמר במסד רק כ-hash', db.prepare('SELECT token_hash FROM sessions').all().every(s => /^[a-f0-9]{64}$/.test(s.token_hash)));

    // יצירת משתמשים
    const roles = (await admin.req('GET', '/api/admin/roles')).data.items;
    const roleId = (n) => roles.find(x => x.name === n).id;
    r = await admin.req('POST', '/api/admin/users', { username: 'weakuser', full_name: 'חלש', role_id: roleId('מבקש / יזם'), password: '12345678' });
    rec('סיסמאות', 'סיסמה חלשה נדחית ביצירת משתמש', r.status === 400, r.data.error);
    const users = {};
    const infra = (await admin.req('GET', '/api/infra')).data.items;
    for (const [u, role, extra] of [['applA', 'מבקש / יזם'], ['applB', 'מבקש / יזם'], ['eng', 'מהנדס / מאשר'], ['water', 'גורם תשתית', { infra_body_id: infra[0].id }]]) {
      const p = pw();
      const cr = await admin.req('POST', '/api/admin/users', { username: u, full_name: 'משתמש ' + u, role_id: roleId(role), password: p, no_request: true, ...(extra || { no_infra: true }) });
      const c = new Client(base); const lr = await c.login(u, p);
      // שינוי סיסמה ראשונית
      const np = pw();
      const blocked = await c.req('GET', '/api/requests');
      if (u === 'applA') rec('אימות', 'משתמש חדש חייב להחליף סיסמה לפני עבודה', blocked.status === 403, blocked.data.error);
      const ch = await c.req('POST', '/api/auth/change-password', { current: p, next: np }); c.csrf = ch.data.csrf;
      users[u] = { c, p: np, id: cr.data.id };
    }

    // ---------- נעילת חשבון והגבלת ניסיונות ----------
    const att = new Client(base);
    for (let i = 0; i < 5; i++) await att.login('applB', 'wrong-password-' + i);
    r = await att.login('applB', users.applB.p);
    rec('הגבלת ניסיונות', 'חשבון ננעל אחרי 5 ניסיונות כושלים (גם סיסמה נכונה נדחית)', r.status === 401, r.data.error);
    rec('לוגים', 'אירוע נעילה נרשם כ-critical ביומן', !!db.prepare("SELECT 1 FROM audit_log WHERE action='account_locked' AND severity='critical'").get());
    rec('לוגים', 'נכתב קובץ security.log', fs.existsSync(path.join(dataDir, 'logs', 'security.log')));
    await admin.req('POST', `/api/admin/users/${users.applB.id}/unlock`, {});
    r = await users.applB.c.login('applB', users.applB.p); users.applB.c.csrf = r.data.csrf;
    rec('הגבלת ניסיונות', 'מנהל משחרר נעילה', r.status === 200);
    let got429 = false;
    for (let i = 0; i < 25 && !got429; i++) { const x = await att.login('ghost' + i, 'x'); if (x.status === 429) got429 = true; }
    rec('Rate limiting', 'הגבלת קצב לכניסה לפי IP (429 אחרי 20 ניסיונות)', got429);
    const m1 = await new Client(base).login('nosuchuser', 'whatever');
    const m2 = await new Client(base).login('eng', 'wrong-password');
    rec('אימות', 'אותה הודעת שגיאה למשתמש קיים ולא קיים (לא חושף שמות משתמשים)', m1.status === 401 && m1.data.error === m2.data.error, m1.data.error);

    // ---------- CSRF ----------
    const A = users.applA.c;
    r = await A.req('POST', '/api/requests', { type: 'planning', title: 'x' }, { noCsrf: true });
    rec('CSRF', 'בקשה משנה בלי אסימון CSRF נחסמת (403)', r.status === 403, r.data.error);
    r = await A.req('POST', '/api/requests', { type: 'planning', title: 'x' }, { headers: { 'X-CSRF-Token': 'forged-token-value-123456789012' } });
    rec('CSRF', 'אסימון CSRF מזויף נחסם', r.status === 403);
    r = await A.req('POST', '/api/requests', { type: 'planning', title: 'x' }, { headers: { Origin: 'https://evil.example' } });
    rec('CSRF', 'בקשה ממקור זר (Origin) נחסמת גם עם אסימון', r.status === 403);
    r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'a', password: 'b' }) });
    rec('CSRF', 'טופס התחברות חוצה-אתרים (בלי כותרת מותאמת) נחסם', r.status === 403);
    r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Requested-With': 'fetch' }, body: '{"username":"a","password":"b"}' });
    rec('CSRF', 'גוף שאינו JSON נדחה (415)', r.status === 415);

    // ---------- CORS ----------
    r = await A.req('GET', '/api/auth/me', undefined, { headers: { Origin: 'https://evil.example' } });
    rec('CORS', 'אין Access-Control-Allow-Origin למקור זר', !r.headers.get('access-control-allow-origin'));
    r = await fetch(base + '/api/requests', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    rec('CORS', 'Preflight ממקור זר נדחה', r.status === 403 && !r.headers.get('access-control-allow-origin'));

    // ---------- Security headers ----------
    r = await fetch(base + '/');
    const H = (n) => r.headers.get(n) || '';
    rec('Headers', 'Content-Security-Policy ללא unsafe-inline/unsafe-eval', H('content-security-policy').includes("default-src 'self'") && !/unsafe-(inline|eval)/.test(H('content-security-policy')), H('content-security-policy').slice(0, 80));
    rec('Headers', 'X-Frame-Options: DENY + frame-ancestors none', H('x-frame-options') === 'DENY' && H('content-security-policy').includes("frame-ancestors 'none'"));
    rec('Headers', 'X-Content-Type-Options: nosniff', H('x-content-type-options') === 'nosniff');
    rec('Headers', 'Referrer-Policy, Permissions-Policy, COOP, CORP', !!(H('referrer-policy') && H('permissions-policy') && H('cross-origin-opener-policy') && H('cross-origin-resource-policy')));
    rec('Headers', 'אין X-Powered-By / Server חושפני', !H('x-powered-by') && !H('server'));

    // ---------- דחיסה ומטמון ----------
    r = await fetch(base + '/', { headers: { 'Accept-Encoding': 'br, gzip' } });
    const html = await r.text();
    const asset = (html.match(/\/app\.min\.js\?v=[a-f0-9]{10}/) || [])[0];
    rec('ביצועים', 'index.html מפנה לקובץ JS מוקטן עם גרסה (hash)', !!asset, asset || html.slice(0, 120));
    const ar = await fetch(base + asset, { headers: { 'Accept-Encoding': 'br, gzip' } });
    const abuf = Buffer.from(await ar.arrayBuffer());
    rec('ביצועים', 'קובץ JS נשלח דחוס (brotli) עם מטמון שנה immutable', ar.headers.get('content-encoding') === 'br' && /immutable/.test(ar.headers.get('cache-control')), `${ar.headers.get('content-encoding')}: ${(abuf.length / 1024).toFixed(1)}KB → ${(ar.headers.get('content-length') / 1024).toFixed(1)}KB ברשת, ${ar.headers.get('cache-control')}`);
    const gz = await fetch(base + asset, { headers: { 'Accept-Encoding': 'gzip' } });
    rec('ביצועים', 'דפדפן בלי brotli מקבל gzip', gz.headers.get('content-encoding') === 'gzip');
    const nc = await fetch(base + asset, { headers: { 'If-None-Match': ar.headers.get('etag') } });
    rec('ביצועים', 'ETag: בקשה חוזרת מקבלת 304 בלי גוף', nc.status === 304);
    r = await A.req('GET', '/api/auth/me', undefined, { headers: { 'Accept-Encoding': 'br, gzip' } });
    rec('ביצועים', 'תשובות API עם אסימונים לא נדחסות (הגנה מ-BREACH)', !r.headers.get('content-encoding'));

    // ---------- קבצים חשופים ----------
    const exposed = [];
    for (const p of ['/.env', '/.env.example', '/.git/config', '/.gitignore', '/.secrets-allowlist', '/data/app.db', '/app.db', '/package.json', '/server.js', '/config.js', '/routes.js', '/db.js', '/security.js', '/mailer.js', '/create-admin.js', '/security.test.js', '/browser.test.js', '/build.js', '/README.md', '/SECURITY_REPORT.md', '/..%2fserver.js', '/%2e%2e/server.js', '/..%2f.env', '/data/uploads/', '/data/backups/', '/data/logs/security.log']) {
      const x = await fetch(base + p); const t = await x.text();
      if (x.status !== 404 || /require\(|NODE_ENV|SQLite format/.test(t)) exposed.push(`${p}:${x.status}`);
    }
    rec('קבצים חשופים', 'קבצי שרת, .env, .git, מסד וגיבויים אינם נגישים מהדפדפן', exposed.length === 0, exposed.join(', ') || '26 נתיבים נבדקו – כולם 404');

    // ---------- נעילת ראוטים של אדמין ----------
    const denied = [];
    for (const [m, p, b] of [['GET', '/api/admin/users'], ['POST', '/api/admin/users', { username: 'hax', full_name: 'h', role_id: 1, password: pw() }], ['GET', '/api/admin/roles'], ['PUT', `/api/admin/roles/${roleId('מבקש / יזם')}`, { perms: ['admin.users'] }],
      ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings', { allowed_ext: ['pdf'] }], ['GET', '/api/admin/audit'], ['GET', '/api/admin/backups'], ['POST', '/api/admin/backups', {}],
      ['PUT', `/api/admin/users/${users.applA.id}`, { role_id: 1 }], ['POST', `/api/admin/users/${users.applA.id}/reset-link`, {}], ['DELETE', '/api/requests/1']]) {
      const x = await A.req(m, p, b); if (x.status !== 403) denied.push(`${m} ${p}: ${x.status}`);
    }
    rec('ראוטים של אדמין', 'משתמש רגיל מקבל 403 בכל 12 נקודות הניהול (כולל ניסיון להעלות לעצמו הרשאות)', denied.length === 0, denied.join('; '));
    r = await anon.req('GET', '/api/admin/users');
    rec('ראוטים של אדמין', 'גישה ללא התחברות מחזירה 401', r.status === 401);
    rec('לוגים', 'ניסיונות ללא הרשאה נרשמים ביומן', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='permission_denied'").get().c >= 10);

    // ---------- אימות טפסים בשרת ----------
    const bad = [];
    for (const [desc, body] of [['סוג לא קיים', { type: 'hack', title: 'x' }], ['נושא חסר', { type: 'planning' }], ['נושא ארוך מדי', { type: 'planning', title: 'א'.repeat(201) }],
      ['תאריך לא תקין', { type: 'planning', title: 'x', planned_start: '2026-13-45' }], ['גוש עם אותיות', { type: 'planning', title: 'x', gush: 'abc<script>' }],
      ['מזורז ללא נימוק', { type: 'planning', title: 'x', track: 'fast' }], ['פרויקט לא קיים', { type: 'planning', title: 'x', project_id: 99999 }],
      ['סיום לפני התחלה', { type: 'planning', title: 'x', planned_start: '2026-05-01', planned_end: '2026-04-01' }], ['אובייקט במקום טקסט', { type: 'planning', title: { $ne: 1 } }]]) {
      const x = await A.req('POST', '/api/requests', body); if (x.status !== 400) bad.push(`${desc}:${x.status}`);
    }
    rec('אימות טפסים בשרת', '9 קלטים לא תקינים נדחים בשרת (400) גם בלי הדפדפן', bad.length === 0, bad.join(', '));
    r = await A.req('POST', '/api/requests', '{"type":"planning",', { headers: { 'Content-Type': 'application/json' } });
    rec('אימות טפסים בשרת', 'JSON שבור נדחה בהודעה כללית', r.status === 400 && !/at |stack|Error:/.test(JSON.stringify(r.data)));
    r = await A.req('POST', '/api/requests', 'x'.repeat(1_100_000), { headers: { 'Content-Type': 'application/json' } });
    rec('אימות טפסים בשרת', 'גוף בקשה מעל 1MB נדחה (413)', r.status === 413);

    // ---------- תהליך עבודה, IDOR ----------
    r = await A.req('POST', '/api/requests', { type: 'execution', title: '<img src=x onerror=alert(1)> חפירה', address: '"><script>alert(2)</script>', description: 'בדיקה', track: 'fast', fast_reason: 'עבודה דחופה', submit: true });
    const reqId = r.data.id;
    rec('תהליך', 'מבקש מגיש בקשה במסלול מזורז', r.status === 201, r.data.number);
    r = await users.applB.c.req('GET', `/api/requests/${reqId}`);
    rec('הרשאות (IDOR)', 'מבקש אחר לא יכול לצפות בבקשה שאינה שלו (404)', r.status === 404);
    r = await users.applB.c.req('PUT', `/api/requests/${reqId}`, { title: 'נפרץ' });
    rec('הרשאות (IDOR)', 'מבקש אחר לא יכול לערוך בקשה שאינה שלו', r.status === 404 || r.status === 403, r.status);
    r = await users.applB.c.req('GET', '/api/requests?scope=all');
    rec('הרשאות (IDOR)', 'רשימת "כל הבקשות" מסוננת לפי הרשאה', r.data.items.every(x => x.applicant_id === users.applB.id));
    r = await A.req('POST', `/api/requests/${reqId}/track`, { decision: 'approved' });
    rec('הרשאות', 'מבקש לא יכול לאשר לעצמו מסלול מזורז', r.status === 403);
    r = await A.req('POST', `/api/requests/${reqId}/status`, { status: 'approved' });
    rec('הרשאות', 'מבקש לא יכול לאשר את הבקשה של עצמו', r.status === 400 || r.status === 403, r.data.error);
    const E = users.eng.c;
    r = await E.req('POST', `/api/requests/${reqId}/track`, { decision: 'approved' });
    const afterTrack = db.prepare('SELECT track, track_status FROM requests WHERE id=?').get(reqId);
    rec('תהליך', 'מהנדס מאשר מסלול מזורז', r.status === 200 && afterTrack.track_status === 'approved');
    await E.req('POST', `/api/requests/${reqId}/assign`, { assignee_id: users.eng.id });
    await E.req('POST', `/api/requests/${reqId}/status`, { status: 'review' });
    await E.req('POST', `/api/requests/${reqId}/approvals`, { infra_body_ids: [infra[0].id, infra[1].id] });
    await E.req('POST', `/api/requests/${reqId}/status`, { status: 'coordination' });
    r = await E.req('POST', `/api/requests/${reqId}/status`, { status: 'pending_admin' });
    rec('תהליך', 'העברה לאישור מנהל חסומה כל עוד גורמי תשתית לא אישרו', r.status === 400, r.data.error);
    const det = (await users.water.c.req('GET', `/api/requests/${reqId}`)).data;
    const myAppr = det.approvals.find(a => a.infra_body_id === infra[0].id); const otherAppr = det.approvals.find(a => a.infra_body_id === infra[1].id);
    r = await users.water.c.req('POST', `/api/approvals/${otherAppr.id}/decide`, { decision: 'approved' });
    rec('הרשאות', 'גורם תשתית לא יכול להחליט בשם גורם אחר', r.status === 403);
    r = await users.water.c.req('POST', `/api/approvals/${myAppr.id}/decide`, { decision: 'approved' });
    r = await E.req('POST', `/api/approvals/${otherAppr.id}/decide`, { decision: 'approved' });
    rec('אישור מנהל', 'מהנדס לא יכול לתת חוות דעת בשם גורם תשתית (רק הגורם עצמו או מנהל המערכת)', r.status === 403);
    await admin.req('POST', `/api/approvals/${otherAppr.id}/decide`, { decision: 'conditions', comment: 'עבודה בלילה בלבד' });
    rec('תהליך', 'אישור "בתנאים" אינו נחשב אישור מלא – הבקשה נשארת בתיאום', db.prepare('SELECT status FROM requests WHERE id = ?').get(reqId).status === 'coordination');
    r = await admin.req('POST', `/api/approvals/${otherAppr.id}/decide`, { decision: 'approved' });
    const st1 = db.prepare('SELECT status FROM requests WHERE id = ?').get(reqId).status;
    rec('אישור מנהל', 'כשהגורם האחרון מאשר – הבקשה עוברת אוטומטית ל"ממתינה לאישור מנהל המערכת"', r.data.advanced === true && st1 === 'pending_admin', st1);
    rec('אישור מנהל', 'מנהל המערכת מקבל התראה על הבקשה שממתינה לו', !!db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = 'chief' AND n.text LIKE '%ממתינה לאישורך%'").get());
    r = await E.req('POST', `/api/requests/${reqId}/status`, { status: 'approved' });
    const r2b = await A.req('POST', `/api/requests/${reqId}/status`, { status: 'approved' });
    rec('אישור מנהל', 'מהנדס ומבקש לא יכולים לאשר סופית (רק מנהל המערכת)', r.status === 403 && (r2b.status === 403 || r2b.status === 400), `${r.status}/${r2b.status} ${r.data.error}`);
    const pend = await admin.req('GET', '/api/requests?scope=pending_me');
    rec('אישור מנהל', 'הבקשה מופיעה למנהל ב"ממתין לטיפולי"', pend.data.items.some(x => x.id === reqId));
    r = await admin.req('POST', `/api/requests/${reqId}/status`, { status: 'approved', comment: 'מאושר לביצוע' });
    rec('תהליך', 'מסלול מלא: הגשה ← בדיקה ← תיאום ← אישורי גורמים ← אישור מנהל המערכת', r.status === 200);
    r = await E.req('POST', `/api/requests/${reqId}/status`, { status: 'closed' });
    rec('אישור מנהל', 'רק מנהל המערכת סוגר בקשה', r.status === 403);
    r = await A.req('GET', '/api/notifications');
    rec('תהליך', 'המגיש מקבל התראות על שינויי סטטוס', r.data.items.length >= 3, r.data.items.length + ' התראות');

    // ---------- דוחות: סינון לפי הרשאה ----------
    const repB = (await users.applB.c.req('GET', '/api/reports?months=12')).data;
    const repE = (await E.req('GET', '/api/reports?months=12')).data;
    rec('הרשאות (IDOR)', 'דוחות וגרפים: מבקש רואה רק את הבקשות שלו, בלי תקציב ומשימות', repB.total === 0 && repB.budget === null && repB.tasks === null && repE.total >= 1, `מבקש: ${repB.total}, מהנדס: ${repE.total}`);
    r = await E.req('GET', "/api/reports?months=1;DROP&type=' OR 1=1");
    rec('אימות טפסים בשרת', 'פרמטרים לא תקינים בדוחות מוחלפים בברירת מחדל', r.status === 200 && r.data.months === 12 && r.data.type === null);

    // ---------- זכור אותי ----------
    {
      const rp = pw();
      await admin.req('POST', '/api/admin/users', { username: 'remem', full_name: 'זכור', role_id: roleId('מבקש / יזם'), password: rp, no_request: true, no_infra: true });
      const rid2 = db.prepare("SELECT id FROM users WHERE username='remem'").get().id;
      db.prepare('UPDATE users SET must_change_pw = 0 WHERE id = ?').run(rid2);
      const c1 = new Client(base); const l1 = await c1.req('POST', '/api/auth/login', { username: 'remem', password: rp, remember: true }); c1.csrf = l1.data.csrf;
      const c2 = new Client(base); const l2 = await c2.req('POST', '/api/auth/login', { username: 'remem', password: rp });
      const k1 = l1.setCookie.join(' '), k2 = l2.setCookie.join(' ');
      rec('זכור אותי', 'עם "זכור אותי": עוגייה קבועה ל-30 יום (HttpOnly, SameSite=Strict)', /Max-Age=2592000/.test(k1) && /HttpOnly/.test(k1) && /SameSite=Strict/.test(k1), k1.replace(/=[^;]+/, '=***'));
      rec('זכור אותי', 'בלי "זכור אותי": עוגיית דפדפן שנמחקת כשהדפדפן נסגר', !/Max-Age/.test(k2), k2.replace(/=[^;]+/, '=***'));
      db.prepare('UPDATE sessions SET last_seen = ? WHERE user_id = ?').run(Date.now() - 2 * 3600000, rid2);
      const a1 = await c1.req('GET', '/api/auth/me'); const a2 = await c2.req('GET', '/api/auth/me');
      rec('זכור אותי', 'אחרי שעתיים בלי שימוש: "זכור אותי" עדיין מחובר, סשן רגיל פג', a1.status === 200 && a2.status === 401);
      db.prepare('UPDATE sessions SET last_seen = ? WHERE user_id = ?').run(Date.now() - 8 * 86400000, rid2);
      rec('זכור אותי', 'אחרי 8 ימים בלי שימוש גם "זכור אותי" פג', (await c1.req('GET', '/api/auth/me')).status === 401);
      const c3 = new Client(base); const l3 = await c3.req('POST', '/api/auth/login', { username: 'remem', password: rp, remember: true }); c3.csrf = l3.data.csrf;
      await admin.req('POST', `/api/admin/users/${rid2}/logout`, {});
      rec('זכור אותי', 'מנהל יכול לנתק גם סשן "זכור אותי"', (await c3.req('GET', '/api/auth/me')).status === 401);
    }

    // ---------- שינוי סיסמה ע"י מנהל ----------
    {
      const target = db.prepare("SELECT id FROM users WHERE username='applA'").get().id;
      r = await admin.req('POST', `/api/admin/users/${target}/password`, { password: '123456789' });
      rec('ניהול משתמשים', 'מנהל לא יכול לקבוע סיסמה חלשה', r.status === 400, r.data.error);
      const np2 = pw();
      r = await admin.req('POST', `/api/admin/users/${target}/password`, { password: np2, must_change: false });
      const oldSess = await A.req('GET', '/api/auth/me');
      const fresh = new Client(base); const fl = await fresh.login('applA', np2);
      rec('ניהול משתמשים', 'מנהל משנה סיסמה: הסיסמה החדשה עובדת והסשנים הישנים מנותקים', r.status === 200 && oldSess.status === 401 && fl.status === 200);
      fresh.csrf = fl.data.csrf; users.applA.c = fresh;
      r = await E.req('POST', `/api/admin/users/${target}/password`, { password: pw() });
      rec('ניהול משתמשים', 'משתמש בלי הרשאת ניהול משתמשים לא יכול לשנות סיסמה לאחר', r.status === 403);
      const chiefId = db.prepare("SELECT id FROM users WHERE username='chief'").get().id;
      const um = roles.find(x => x.name === 'רכז תיאום');
      await admin.req('PUT', `/api/admin/users/${users.eng.id}`, { perm_grant: ['admin.users'] });
      r = await admin.req('PUT', `/api/admin/users/${target}`, { username: 'chief' });
      rec('ניהול משתמשים', 'שינוי שם משתמש לשם תפוס נחסם', r.status === 400, r.data.error);
      const engLogin = new Client(base); const el = await engLogin.login('eng', users.eng.p); engLogin.csrf = el.data.csrf;
      r = await engLogin.req('POST', `/api/admin/users/${chiefId}/password`, { password: pw() });
      rec('ניהול משתמשים', 'מי שמנהל משתמשים בלי הרשאת תפקידים לא יכול להחליף סיסמה למנהל המערכת', r.status === 403);
      await admin.req('PUT', `/api/admin/users/${users.eng.id}`, { perm_grant: [] });
      const e2 = new Client(base); const e2l = await e2.login('eng', users.eng.p); e2.csrf = e2l.data.csrf; users.eng.c = e2; void um;
    }
    const E2 = users.eng.c; const A2 = users.applA.c; let n2Id;

    // ---------- מספור בקשות ----------
    {
      r = await admin.req('PUT', '/api/admin/settings', { req_prefix: 'BD', req_with_year: false, req_pad: 3, req_next: 50 });
      const n1 = (await A2.req('POST', '/api/requests', { type: 'planning', title: 'מספור 1', submit: true })).data.number;
      const n2 = (await A2.req('POST', '/api/requests', { type: 'planning', title: 'מספור 2', submit: true })).data; n2Id = n2.id;
      rec('מספור בקשות', 'הגדרת קידומת, ספרות ומספר התחלה: BD-050 ואז BD-051', n1 === 'BD-050' && n2.number === 'BD-051', `${n1}, ${n2.number}`);
      r = await admin.req('PUT', '/api/admin/settings', { req_prefix: '<script>' });
      rec('מספור בקשות', 'קידומת עם תווים לא חוקיים נדחית', r.status === 400);
      r = await E2.req('POST', `/api/requests/${n2.id}/number`, { number: n1 });
      rec('מספור בקשות', 'שינוי ידני למספר שכבר קיים נחסם', r.status === 400, r.data.error);
      r = await E2.req('POST', `/api/requests/${n2.id}/number`, { number: 'BD-2026/77' });
      const okNum = db.prepare('SELECT number FROM requests WHERE id = ?').get(n2.id).number;
      rec('מספור בקשות', 'מורשה עריכה משנה מספר בקשה ידנית, והשינוי נרשם בהיסטוריה', r.status === 200 && okNum === 'BD-2026/77' && !!db.prepare("SELECT 1 FROM request_history WHERE request_id = ? AND action = 'מספר הבקשה שונה'").get(n2.id));
      r = await A2.req('POST', `/api/requests/${n2.id}/number`, { number: 'HACK-1' });
      rec('מספור בקשות', 'מבקש רגיל לא יכול לשנות מספר בקשה', r.status === 403);
      await admin.req('PUT', '/api/admin/settings', { req_prefix: 'TH', req_with_year: true, req_pad: 4 });
    }

    // ---------- גורמי תשתית ----------
    {
      const bid = infra[2].id;
      r = await admin.req('PUT', `/api/admin/infra/${bid}`, { name: 'בזק ותקשורת – מעודכן', contact: '03-0000000', member_ids: [users.applB.id] });
      const lst = (await admin.req('GET', '/api/admin/infra')).data.items.find(b => b.id === bid);
      rec('גורמי תשתית', 'עריכת שם ואיש קשר ושיוך משתמש לגורם', r.status === 200 && lst.name === 'בזק ותקשורת – מעודכן' && lst.members.some(m => m.id === users.applB.id));
      r = await admin.req('DELETE', `/api/admin/infra/${infra[0].id}`);
      rec('גורמי תשתית', 'גורם עם היסטוריית אישורים לא נמחק (רק השבתה)', r.status === 400, r.data.error);
      const nb = await admin.req('POST', '/api/admin/infra', { name: 'גורם זמני' });
      r = await admin.req('DELETE', `/api/admin/infra/${nb.data.id}`);
      rec('גורמי תשתית', 'גורם בלי היסטוריה נמחק', r.status === 200);
      r = await A2.req('PUT', `/api/admin/infra/${bid}`, { name: 'x' });
      rec('גורמי תשתית', 'משתמש רגיל לא יכול לערוך גורמי תשתית', r.status === 403);
      await admin.req('PUT', `/api/admin/infra/${bid}`, { member_ids: [] });
    }

    // ---------- לוגו ----------
    {
      const upLogo = (name, buf, c = admin) => { const fd = new FormData(); fd.append('file', new Blob([buf]), name); return c.req('POST', '/api/admin/logo', fd); };
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
      const bad = [await upLogo('x.svg', Buffer.from('<svg onload=alert(1)>')), await upLogo('x.png', Buffer.from('<html><script>alert(1)</script>')), await upLogo('big.png', Buffer.concat([png, Buffer.alloc(1.2 * 1024 * 1024)]))];
      rec('לוגו', 'SVG, HTML שמתחזה ל-PNG וקובץ מעל 1MB נחסמים', bad[0].status === 415 && bad[1].status === 415 && bad[2].status === 413, bad.map(b => b.status).join('/'));
      r = await upLogo('x.png', png, A2);
      rec('לוגו', 'משתמש רגיל לא יכול להחליף לוגו', r.status === 403);
      r = await upLogo('logo.png', png);
      const lg = await fetch(base + '/api/logo');
      const me0 = await anon.req('GET', '/api/auth/me');
      rec('לוגו', 'לוגו תקין עולה, ומוגש גם לפני התחברות (למסך הכניסה) כ-image/png עם nosniff', r.status === 200 && lg.status === 200 && lg.headers.get('content-type') === 'image/png' && lg.headers.get('x-content-type-options') === 'nosniff' && !!me0.data.logo);
      await admin.req('DELETE', '/api/admin/logo');
      rec('לוגו', 'הסרת לוגו מחזירה את סמל ברירת המחדל', (await fetch(base + '/api/logo')).status === 404);
    }

    // ---------- משתמש חדש: שדות חובה ושיוך לבקשה ----------
    {
      const base0 = { full_name: 'בודק', role_id: roleId('מבקש / יזם'), password: pw() };
      const e1 = await admin.req('POST', '/api/admin/users', { ...base0, username: 'need1', no_request: true });
      const e2 = await admin.req('POST', '/api/admin/users', { ...base0, username: 'need2', no_infra: true });
      const e3 = await admin.req('POST', '/api/admin/users', { ...base0, username: 'need3', role_id: null, no_infra: true, no_request: true });
      rec('משתמש חדש', 'גורם תשתית, שיוך לבקשה ותפקיד הם שדות חובה', e1.status === 400 && e2.status === 400 && e3.status === 400, [e1.data.error, e2.data.error].join(' | '));
      const lp2 = pw();
      const cr = await admin.req('POST', '/api/admin/users', { ...base0, username: 'linked', password: lp2, infra_body_id: infra[3].id, request_ids: [reqId] });
      db.prepare('UPDATE users SET must_change_pw = 0 WHERE id = ?').run(cr.data.id);
      const lc = new Client(base); const ll = await lc.login('linked', lp2); lc.csrf = ll.data.csrf;
      const seen = await lc.req('GET', `/api/requests/${reqId}`);
      const notSeen = await lc.req('GET', `/api/requests/${n2Id}`);
      rec('משתמש חדש', 'משתמש ששויך לבקשה רואה אותה (ורק אותה)', cr.status === 201 && seen.status === 200 && notSeen.status === 404);
      const list = (await admin.req('GET', '/api/admin/users')).data.items.find(u => u.username === 'linked');
      rec('משתמש חדש', 'השיוך לבקשה ולגורם נשמר ומוצג ברשימת המשתמשים', list.requests.some(x => x.id === reqId) && list.infra_body_id === infra[3].id);
    }

    // ---------- מסמכים: כל אחד רואה רק את שלו ----------
    {
      const fd = new FormData(); fd.append('request_id', String(reqId)); fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')]), 'eng-plan.pdf');
      const ed = await E2.req('POST', '/api/documents', fd);
      const fd2 = new FormData(); fd2.append('request_id', String(reqId)); fd2.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')]), 'appl-plan.pdf');
      await A2.req('POST', '/api/documents', fd2);
      const engView = await E2.req('GET', `/api/requests/${reqId}`);
      const applView = await A2.req('GET', `/api/requests/${reqId}`);
      const adminView = await admin.req('GET', `/api/requests/${reqId}`);
      const names = (x) => x.data.documents.map(d => d.original_name);
      rec('מסמכים', 'כל משתמש רואה רק את המסמכים שהעלה; מנהל המערכת רואה את כולם',
        names(engView).every(n => n === 'eng-plan.pdf') && !names(applView).includes('eng-plan.pdf') && names(applView).includes('appl-plan.pdf') && names(adminView).includes('eng-plan.pdf') && names(adminView).includes('appl-plan.pdf'),
        `מהנדס: ${names(engView).length}, מבקש: ${names(applView).length}, מנהל: ${names(adminView).length}`);
      const steal = await A2.req('GET', `/api/documents/${ed.data.id}/download`);
      rec('מסמכים', 'הורדה ישירה של מסמך של משתמש אחר נחסמת (404)', steal.status === 404);
      const allDocs = await E2.req('GET', '/api/documents');
      rec('מסמכים', 'גם במסך "מסמכים" מופיעים רק המסמכים שלי', allDocs.data.items.every(d => d.uploaded_by === users.eng.id));
      await admin.req('PUT', '/api/admin/settings', { docs_visibility: 'request' });
      const shared = await E2.req('GET', `/api/requests/${reqId}`);
      rec('מסמכים', 'מתג בהגדרות: "כל מי שרואה את הבקשה רואה את המסמכים" עובד', names(shared).includes('appl-plan.pdf'));
      await admin.req('PUT', '/api/admin/settings', { docs_visibility: 'own' });
    }

    // ---------- SQL Injection ----------
    const sqli = [];
    for (const q of ["' OR 1=1 --", "%' OR '1'='1", "1; DROP TABLE users; --", "' UNION SELECT password_hash,1,1 FROM users --"]) {
      const x = await users.applB.c.req('GET', '/api/requests?scope=all&q=' + encodeURIComponent(q));
      if (x.status !== 200 || x.data.items.length !== 0) sqli.push(q);
    }
    r = await anon.req('POST', '/api/auth/login', { username: "chief' --", password: 'x' });
    rec('SQL Injection', 'הזרקות בחיפוש ובכניסה אינן משפיעות (queries parameterized)', sqli.length === 0 && r.status !== 200 && db.prepare('SELECT COUNT(*) c FROM users').get().c > 0, sqli.join(' | ') || '5 מטענים נבדקו');
    const src = fs.readFileSync(path.join(ROOT, 'routes.js'), 'utf8');
    const concat = src.split('\n').filter(l => /prepare\(`[^`]*\$\{(?!where|REQ_SELECT|PROJ_SELECT|cols\.map|mine \?)/.test(l));
    rec('SQL Injection', 'סריקת קוד: אין שרשור קלט משתמש לשאילתות', concat.length === 0, concat.length ? concat[0].trim().slice(0, 100) : 'רק שמות עמודות קבועים משורשרים; כל הערכים כ-?');

    // ---------- תקציב: אימות סכומים ----------
    r = await E2.req('POST', '/api/projects', { name: 'פרויקט בדיקה', budget: 100000, start_date: '2026-01-01', end_date: '2026-12-31' });
    const projId = r.data.id;
    const money = [];
    for (const amount of [-500, 0, 'abc', '1e309', 1e12, '100; DROP']) { const x = await E2.req('POST', `/api/projects/${projId}/budget`, { kind: 'actual', description: 'x', amount, entry_date: '2026-03-01' }); if (x.status !== 400) money.push(`${amount}:${x.status}`); }
    r = await E2.req('POST', `/api/projects/${projId}/budget`, { kind: 'actual', description: 'קבלן', amount: '12,500.555', entry_date: '2026-03-01' });
    const stored = db.prepare('SELECT amount FROM budget_entries WHERE project_id=?').get(projId);
    rec('מחירים/סכומים', 'סכומים שליליים, אפס, טקסט ואינסוף נדחים; סכום מעוגל לאגורות בשרת', money.length === 0 && stored.amount === 12500.56, money.join(',') || `נשמר ${stored.amount}`);
    r = await A2.req('POST', `/api/projects/${projId}/budget`, { kind: 'actual', description: 'x', amount: 5, entry_date: '2026-03-01' });
    rec('מחירים/סכומים', 'רק בעלי הרשאת תקציב יכולים להוסיף הוצאות', r.status === 403);

    // ---------- העלאת קבצים ----------
    async function upload(c, name, buf, extra = {}) {
      const fd = new FormData(); fd.append('request_id', String(extra.request_id || reqId)); fd.append('file', new Blob([buf]), name);
      return c.req('POST', '/api/documents', fd);
    }
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const up = {};
    up.ok = await upload(A2, 'תוכנית.pdf', pdf);
    up.exe = await upload(A2, 'setup.exe', Buffer.from('MZ\x90\x00'));
    up.html = await upload(A2, 'page.html', Buffer.from('<html><script>alert(1)</script>'));
    up.svg = await upload(A2, 'x.svg', Buffer.from('<svg onload=alert(1)>'));
    up.spoof = await upload(A2, 'fake.pdf', Buffer.from('<html><script>alert(1)</script></html>'));
    up.double = await upload(A2, 'shell.php.pdf', pdf);
    up.mz = await upload(A2, 'plan.dwg', Buffer.from('MZ\x90\x00 fake'));
    up.big = await upload(A2, 'big.pdf', Buffer.concat([pdf, Buffer.alloc(21 * 1024 * 1024)]));
    up.otherReq = await upload(users.applB.c, 'x.pdf', pdf);
    rec('העלאת קבצים', 'PDF תקין מתקבל', up.ok.status === 201);
    rec('העלאת קבצים', 'exe / html / svg נחסמים (415)', [up.exe, up.html, up.svg].every(x => x.status === 415));
    rec('העלאת קבצים', 'קובץ HTML שמתחזה ל-PDF נחסם לפי התוכן', up.spoof.status === 415, up.spoof.data.error);
    rec('העלאת קבצים', 'סיומת כפולה (shell.php.pdf) נחסמת', up.double.status === 415);
    rec('העלאת קבצים', 'קובץ הרצה בשם dwg נחסם', up.mz.status === 415);
    rec('העלאת קבצים', 'קובץ מעל הגודל המרבי (20MB) נחסם (413)', up.big.status === 413);
    rec('העלאת קבצים', 'אי אפשר לצרף קובץ לבקשה של משתמש אחר', up.otherReq.status === 404);
    const storedNames = fs.readdirSync(path.join(dataDir, 'uploads'));
    rec('העלאת קבצים', 'קבצים נשמרים בשם אקראי מחוץ לתיקייה הציבורית', storedNames.every(n => /^[a-f0-9]{48}$/.test(n)), storedNames.length + ' קבצים');
    const dl = await A2.req('GET', `/api/documents/${up.ok.data.id}/download`, undefined, { raw: true });
    rec('העלאת קבצים', 'הורדה כ-attachment עם nosniff ו-CSP sandbox', /attachment/.test(dl.headers.get('content-disposition')) && dl.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(dl.headers.get('content-security-policy')));
    r = await users.applB.c.req('GET', `/api/documents/${up.ok.data.id}/download`);
    rec('העלאת קבצים', 'משתמש לא מורשה לא יכול להוריד קובץ של אחר', r.status === 404);
    // ניהול סוגי קבצים מלוח הבקרה
    r = await admin.req('PUT', '/api/admin/settings', { allowed_ext: ['pdf', 'svg'] });
    const r3 = await admin.req('PUT', '/api/admin/settings', { allowed_ext: ['pdf', 'html'] });
    rec('העלאת קבצים', 'מנהל לא יכול לאשר סיומות מסוכנות (svg/html) גם מלוח הבקרה', r.status === 400 && r3.status === 400, r.data.error);
    await admin.req('PUT', '/api/admin/settings', { allowed_ext: ['txt', 'png'], max_mb: 1 });
    const t1 = await upload(A2, 'notes.txt', Buffer.from('שלום'));
    const t2 = await upload(A2, 'again.pdf', pdf);
    const t3 = await upload(A2, 'big.txt', Buffer.alloc(1.5 * 1024 * 1024, 65));
    rec('העלאת קבצים', 'שינוי סוגים וגודל מלוח הבקרה נאכף מיד (txt נוסף, pdf הוסר, 1MB)', t1.status === 201 && t2.status === 415 && t3.status === 413, `${t1.status}/${t2.status}/${t3.status}`);
    await admin.req('PUT', '/api/admin/settings', { allowed_ext: ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx', 'dwg', 'dxf', 'zip', 'tif', 'tiff'], max_mb: 20 });

    // ---------- איפוס סיסמה ----------
    r = await admin.req('POST', `/api/admin/users/${users.applB.id}/reset-link`, {});
    const token = new URL(r.data.link.replace('#/reset?', 'reset?')).searchParams.get('token');
    const np = pw();
    r = await anon.req('POST', '/api/auth/reset', { token, password: np });
    const again = await anon.req('POST', '/api/auth/reset', { token, password: pw() });
    rec('איפוס סיסמה', 'קישור איפוס עובד פעם אחת בלבד', r.status === 200 && again.status === 400);
    r = await admin.req('POST', `/api/admin/users/${users.applB.id}/reset-link`, {});
    const token2 = new URL(r.data.link.replace('#/reset?', 'reset?')).searchParams.get('token');
    db.prepare('UPDATE password_resets SET expires = ? WHERE token_hash = ?').run(Date.now() - 1000, crypto.createHash('sha256').update(token2).digest('hex'));
    r = await anon.req('POST', '/api/auth/reset', { token: token2, password: pw() });
    rec('איפוס סיסמה', 'קישור שפג תוקפו (30 דקות) נדחה', r.status === 400, r.data.error);
    rec('איפוס סיסמה', 'האסימון נשמר במסד רק כ-hash', db.prepare('SELECT token_hash FROM password_resets').all().every(x => /^[a-f0-9]{64}$/.test(x.token_hash)));
    r = await users.applB.c.req('GET', '/api/auth/me');
    rec('איפוס סיסמה', 'איפוס סיסמה מנתק את הסשנים הקיימים', r.status === 401);
    r = await anon.req('POST', '/api/auth/forgot', { username: 'nobody-here' });
    const r4 = await anon.req('POST', '/api/auth/forgot', { username: 'applA' });
    rec('איפוס סיסמה', '"שכחתי סיסמה" לא חושף אם משתמש קיים', r.data.message === r4.data.message);

    // ---------- סשן ----------
    const L = new Client(base); const lp = pw();
    await admin.req('POST', '/api/admin/users', { username: 'sess', full_name: 'סשן', role_id: roleId('מבקש / יזם'), password: lp, no_request: true, no_infra: true });
    await L.login('sess', lp); const oldCookie = L.cookie;
    await L.req('POST', '/api/auth/logout', {});
    const replay = new Client(base); replay.cookie = oldCookie;
    r = await replay.req('GET', '/api/auth/me');
    rec('Cookies', 'אחרי יציאה העוגייה הישנה לא תקפה (נמחקת בשרת)', r.status === 401);
    const L2 = new Client(base); await L2.login('sess', lp);
    db.prepare('UPDATE sessions SET last_seen = ? WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(Date.now() - 31 * 60000, 'sess');
    r = await L2.req('GET', '/api/auth/me');
    rec('Cookies', 'סשן פג אחרי 30 דקות חוסר פעילות', r.status === 401);
    const L3 = new Client(base); await L3.login('sess', lp);
    await admin.req('PUT', `/api/admin/users/${db.prepare("SELECT id FROM users WHERE username='sess'").get().id}`, { active: false });
    r = await L3.req('GET', '/api/auth/me');
    rec('הרשאות', 'השבתת משתמש מנתקת אותו מיד', r.status === 401);
    r = await admin.req('PUT', `/api/admin/users/${db.prepare("SELECT id FROM users WHERE username='chief'").get().id}`, { active: false });
    rec('הרשאות', 'אי אפשר להשבית את מנהל המערכת האחרון', r.status === 400, r.data.error);

    // ---------- debug ----------
    r = await A2.req('GET', '/api/requests/999999');
    const errText = JSON.stringify(r.data);
    rec('Debug', 'שגיאות לא חושפות stack trace / נתיבים', !/\/home\/|node:|at \w+ \(|sqlite/i.test(errText), errText);
    rec('Debug', 'מצב פרודקשן: NODE_ENV=production מכבה פרטי שגיאה', fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').includes("config.isProd ? 'שגיאת שרת'"));
    r = await fetch(base + '/nope-page');
    rec('404', 'עמוד 404 מותאם לנתיב לא קיים', r.status === 404 && (await r.text()).includes('העמוד לא נמצא'));

    // ---------- rate limit כללי ----------
    let api429 = false;
    for (let i = 0; i < 320 && !api429; i++) { const x = await fetch(base + '/api/health'); if (x.status === 429) api429 = true; }
    rec('Rate limiting', 'הגבלת קצב כללית ל-API (300 בקשות לדקה ל-IP)', api429);

    // ---------- DB וגיבוי ----------
    const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
    rec('אבטחת DB', 'קובץ המסד בהרשאות 600 ומחוץ לתיקייה הציבורית', mode(path.join(dataDir, 'app.db')) === '600', 'mode ' + mode(path.join(dataDir, 'app.db')));
    rec('אבטחת DB', 'מצב WAL ו-secure_delete מוגדרים; מסד מקומי ללא פורט רשת חשוף', db.prepare('PRAGMA journal_mode').get().journal_mode === 'wal', 'SQLite מוטמע – אין שרת DB להאזנה ברשת');
    srv.kill(); await new Promise(res => srv.on('exit', res));
    // בדיקת גיבוי ישירה מול אותה תיקייה
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', "require('./backup').runBackup('test').then(r=>{console.log(JSON.stringify(r));process.exit(0)})"], { cwd: ROOT, env: { ...process.env, ...env } });
    const backups = fs.readdirSync(path.join(dataDir, 'backups')).filter(f => f.endsWith('.sqlite'));
    rec('גיבוי', 'גיבוי נוצר בהצלחה, בהרשאות 600, כולל קבצים מצורפים', backups.length === 1 && mode(path.join(dataDir, 'backups', backups[0])) === '600' && fs.readdirSync(path.join(dataDir, 'backups', 'uploads')).length > 0);

    // ---------- מופע 3: דוא"ל איפוס דרך SMTP + הגבלות ששורדות הפעלה מחדש ----------
    {
      const net = require('node:net');
      const mails = [];
      const smtp = net.createServer(sock => {
        let data = false; let body = '';
        sock.write('220 test ESMTP\r\n');
        sock.on('data', d => {
          for (const line of d.toString().split('\r\n')) {
            if (data) { if (line === '.') { data = false; mails.push(body); sock.write('250 queued\r\n'); } else body += line + '\n'; continue; }
            if (/^EHLO/i.test(line)) sock.write('250-test\r\n250 8BITMIME\r\n');
            else if (/^(MAIL|RCPT)/i.test(line)) sock.write('250 ok\r\n');
            else if (/^DATA/i.test(line)) { data = true; body = ''; sock.write('354 go\r\n'); }
            else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
          }
        });
      });
      await new Promise(res => smtp.listen(4825, '127.0.0.1', res));
      const env3 = { ...env, SMTP_HOST: '127.0.0.1', SMTP_PORT: '4825', SMTP_ALLOW_INSECURE: '1', MAIL_FROM: 'no-reply@example.gov.il', PUBLIC_URL: base.replace('4801', '4803') };
      srv = await startServer(env3, 4803);
      const b3 = 'http://127.0.0.1:4803';
      db.prepare("UPDATE users SET email = 'appl@example.gov.il' WHERE username = 'applA'").run();
      const anon3 = new Client(b3);
      r = await anon3.req('POST', '/api/auth/forgot', { username: 'applA' });
      await new Promise(res => setTimeout(res, 800));
      const mail = mails[0] || '';
      const decoded = Buffer.from((mail.split('\n\n')[1] || '').replace(/\s+/g, ''), 'base64').toString('utf8');
      const link = (decoded.match(/https?:\/\/\S+#\/reset\?token=[\w-]+/) || [])[0];
      rec('טפסים', '"שכחתי סיסמה" שולח מייל אמיתי דרך SMTP עם קישור איפוס', mails.length === 1 && !!link, link ? 'הקישור התקבל במייל' : mail.slice(0, 120));
      if (link) {
        const t = new URL(link.replace('#/reset?', 'reset?')).searchParams.get('token');
        const nr = await anon3.req('POST', '/api/auth/reset', { token: t, password: pw() });
        rec('טפסים', 'הקישור מהמייל מאפס את הסיסמה', nr.status === 200);
      }
      rec('טפסים', 'כותרות המייל מקודדות (UTF-8) ללא אפשרות הזרקה', /Subject: =\?UTF-8\?B\?/.test(mail));
      r = await anon3.req('POST', '/api/auth/forgot', { username: 'applB' }); // ללא מייל רשום → התראה למנהל
      await new Promise(res => setTimeout(res, 300));
      rec('טפסים', 'משתמש בלי דוא"ל – הבקשה מגיעה כהתראה למנהל', mails.length === 1 && !!db.prepare("SELECT 1 FROM notifications WHERE text LIKE '%applB%'").get());
      // הגבלת כניסה שורדת הפעלה מחדש
      const brute = new Client(b3, '10.9.9.9');
      for (let i = 0; i < 20; i++) await brute.login('ghost-x' + i, 'x');
      srv.kill(); await new Promise(res => srv.on('exit', res));
      srv = await startServer(env3, 4803);
      r = await brute.login('ghost-y', 'x');
      rec('Rate limiting', 'הגבלת ניסיונות כניסה נשמרת במסד ושורדת הפעלה מחדש של השרת', r.status === 429);
      srv.kill(); await new Promise(res => srv.on('exit', res)); smtp.close();
    }

    // ---------- מופע 2: HTTPS מחויב ----------
    const data2 = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-https-'));
    const PORT2 = 4802;
    srv = await startServer({ NODE_ENV: 'production', TRUST_PROXY: '1', DATA_DIR: data2, UPLOAD_DIR: path.join(data2, 'u'), BACKUP_DIR: path.join(data2, 'b'), LOG_DIR: path.join(data2, 'l') }, PORT2);
    r = await fetch(`http://127.0.0.1:${PORT2}/`, { redirect: 'manual' });
    rec('HTTPS', 'HTTP מופנה ל-HTTPS (301)', r.status === 301 && r.headers.get('location').startsWith('https://'));
    r = await fetch(`http://127.0.0.1:${PORT2}/api/auth/login`, { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: '{}' });
    rec('HTTPS', 'POST על HTTP נחסם (לא נשלחות סיסמאות בטקסט גלוי)', r.status === 403);
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'create-admin.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: data2, ADMIN_USERNAME: 'chief2', ADMIN_FULLNAME: 'x', ADMIN_PASSWORD: adminPw } });
    r = await fetch(`http://127.0.0.1:${PORT2}/api/auth/login`, { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'chief2', password: adminPw }) });
    const c2 = (r.headers.getSetCookie() || []).join(' ');
    rec('HTTPS', 'HSTS נשלח מאחורי פרוקסי HTTPS', /max-age=31536000/.test(r.headers.get('strict-transport-security') || ''));
    rec('Cookies', 'בפרודקשן: __Host-sid עם Secure', /^__Host-sid=/.test(c2) && /Secure/.test(c2), c2.replace(/=[^;]+/, '=***'));
    srv.kill();
  } catch (e) {
    console.error(e); rec('הרצה', 'הבדיקות רצו עד הסוף', false, e.message);
    if (srv) srv.kill();
  }
  fs.writeFileSync(path.join(os.tmpdir(), 'coord-security-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
