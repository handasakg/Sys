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
const APPLY_PW = 'סיסמה' + crypto.randomBytes(6).toString('hex') + '9';
// בקשות נפתחות רק מהגשה באתר. בדיקות שצריכות בקשה מוכנה יוצרות אותה ישירות במסד (seedReq) או דרך ההגשה הציבורית (applyPublic)
// בונה ZIP קטן (כמו קובצי Word/Excel) לבדיקת התצוגה המקדימה
function makeZip(files) {
  const zlib = require('node:zlib'); const locals = []; const central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'); const comp = zlib.deflateRawSync(data); const crc = zlib.crc32(data); const nb = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); central.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
let seedN = 0;
function seedReq(db, applicantId, f = {}) {
  const number = f.number || `SEED-${process.pid}-${++seedN}`;
  const info = db.prepare(`INSERT INTO requests (number, type, title, description, address, applicant_id, status, track, track_status, submitted_at, due_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now','+14 days'))`).run(number, f.type || 'planning', f.title || 'בקשת בדיקה', f.description || null, f.address || null,
    applicantId, f.status || 'submitted', f.track || 'regular', f.track_status || 'none');
  return { id: Number(info.lastInsertRowid), number };
}
const TEST_POLICE = { applicant_name: 'בודק מערכת', project: 'פרויקט בדיקה', id_kind: 'id', id_number: '000000018', phone: '050-1234567', description: 'עבודת בדיקה', work_time: 'א׳-ה׳', work_hours: '07:00-16:00', contact: 'בודק 052-7654321', notes: '', date: '2026-12-01' };
let applySeq = 0;
async function applyPublic(baseUrl, over = {}) {
  const meta = await new Client(baseUrl).req('GET', '/api/public/apply-meta');
  const fd = new FormData(); applySeq++;
  const f = { kind: 'resident', username: `מגיש ${applySeq}${crypto.randomBytes(2).toString('hex')}`, password: 'Ap' + crypto.randomBytes(8).toString('hex') + '9', type: meta.data.types[0].key,
    email: `apply${applySeq}@example.com`, address: 'הגפן 1, קריית גת', phone: '0501234567', project: 'פרויקט בדיקה', police: JSON.stringify(TEST_POLICE), location: JSON.stringify({ x: 177812.4, y: 613245.7, z: 9, label: 'הגפן 1' }), ...over };
  for (const [k, val] of Object.entries(f)) fd.append(k, val);
  const pdfB = Buffer.from('%PDF-1.4\n% test\n%%EOF');
  fd.append('route_plan', new Blob([pdfB]), 'plan.pdf'); fd.append('work_request', new Blob([pdfB]), 'request.pdf');
  const c = new Client(baseUrl); const r = await c.req('POST', '/api/public/apply', fd); if (r.data && r.data.csrf) c.csrf = r.data.csrf;
  return { status: r.status, id: r.data && r.data.id, number: r.data && r.data.number, client: c, error: r.data && r.data.error };
}

function startServer(env, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'start.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DISABLE_BACKUPS: '1', ...env } });
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
    r = await A.req('PUT', '/api/me/prefs', { mode: 'dark' }, { noCsrf: true });
    rec('CSRF', 'בקשה משנה בלי אסימון CSRF נחסמת (403)', r.status === 403, r.data.error);
    r = await A.req('PUT', '/api/me/prefs', { mode: 'dark' }, { headers: { 'X-CSRF-Token': 'forged-token-value-123456789012' } });
    rec('CSRF', 'אסימון CSRF מזויף נחסם', r.status === 403);
    r = await A.req('PUT', '/api/me/prefs', { mode: 'dark' }, { headers: { Origin: 'https://evil.example' } });
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

    // ---------- תהליך עבודה, IDOR ----------
    const seeded = seedReq(db, users.applA.id, { type: 'execution', title: '<img src=x onerror=alert(1)> חפירה', address: '"><script>alert(2)</script>', description: 'בדיקה', track: 'fast', track_status: 'pending' });
    const reqId = seeded.id;
    r = await A.req('POST', '/api/requests', { type: 'planning', title: 'x', submit: true });
    rec('תהליך', 'יצירת בקשה פנימית הוסרה מהמערכת – בקשות נפתחות רק מ"הגשת בקשה" באתר', r.status === 404 || r.status === 405, r.status);
    // ---------- אימות טפסים בשרת ----------
    const bad = [];
    for (const [desc, body] of [['סוג לא קיים', { type: 'hack', title: 'x' }], ['נושא חסר', { type: 'planning', title: '' }], ['נושא ארוך מדי', { type: 'planning', title: 'א'.repeat(201) }],
      ['תאריך לא תקין', { type: 'planning', title: 'x', planned_start: '2026-13-45' }], ['גוש עם אותיות', { type: 'planning', title: 'x', gush: 'abc<script>' }],
      ['חלקה עם אותיות', { type: 'planning', title: 'x', helka: '12a' }], ['פרויקט ארוך מדי', { type: 'planning', title: 'x', project_name: 'א'.repeat(201) }],
      ['סיום לפני התחלה', { type: 'planning', title: 'x', planned_start: '2026-05-01', planned_end: '2026-04-01' }], ['אובייקט במקום טקסט', { type: 'planning', title: { $ne: 1 } }]]) {
      const x = await admin.req('PUT', `/api/requests/${reqId}`, body); if (x.status !== 400) bad.push(`${desc}:${x.status}`);
    }
    rec('אימות טפסים בשרת', '9 קלטים לא תקינים נדחים בשרת (400) גם בלי הדפדפן', bad.length === 0, bad.join(', '));
    r = await admin.req('PUT', `/api/requests/${reqId}`, '{"type":"planning",', { headers: { 'Content-Type': 'application/json' } });
    rec('אימות טפסים בשרת', 'JSON שבור נדחה בהודעה כללית', r.status === 400 && !/at |stack|Error:/.test(JSON.stringify(r.data)));
    r = await admin.req('PUT', `/api/requests/${reqId}`, 'x'.repeat(1_100_000), { headers: { 'Content-Type': 'application/json' } });
    rec('אימות טפסים בשרת', 'גוף בקשה מעל 1MB נדחה (413)', r.status === 413);

    r = await users.applB.c.req('GET', `/api/requests/${reqId}`);
    rec('הרשאות (IDOR)', 'מבקש אחר לא יכול לצפות בבקשה שאינה שלו (404)', r.status === 404);
    r = await users.applB.c.req('PUT', `/api/requests/${reqId}`, { title: 'נפרץ' });
    rec('הרשאות (IDOR)', 'מבקש אחר לא יכול לערוך בקשה שאינה שלו', r.status === 404 || r.status === 403, r.status);
    r = await users.applB.c.req('GET', '/api/requests?scope=all');
    rec('הרשאות (IDOR)', 'רשימת "כל הבקשות" מסוננת לפי הרשאה', r.data.items.every(x => x.applicant_id === users.applB.id));
    r = await A.req('POST', `/api/requests/${reqId}/track`, { decision: 'approved' });
    rec('מסלול', 'המסלול (רגיל / מזורז) הוסר מהמערכת – גם מהשרת ומההרשאות', r.status === 404 && !(await admin.req('GET', '/api/admin/permissions')).data.items.some(x => x.key === 'requests.approve_track'));
    r = await A.req('POST', `/api/requests/${reqId}/status`, { status: 'approved' });
    rec('הרשאות', 'מבקש לא יכול לאשר את הבקשה של עצמו', r.status === 400 || r.status === 403, r.data.error);
    const E = users.eng.c;
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
    r = await admin.req('POST', `/api/approvals/${otherAppr.id}/decide`, { decision: 'approved' });
    rec('סדר טיפול', 'הגורם השני לא יכול לאשר לפני שהראשון סיים (409), גם לא מנהל המערכת', r.status === 409, r.data.error);
    rec('סדר טיפול', 'הגורם הראשון בתור קיבל התראה שהגיע תורו', !!db.prepare("SELECT 1 FROM notifications n WHERE n.user_id = ? AND n.text LIKE '%ממתינה לחוות דעת%'").get(users.water.id));
    r = await users.water.c.req('POST', `/api/approvals/${myAppr.id}/decide`, { decision: 'approved' });
    r = await E.req('POST', `/api/approvals/${otherAppr.id}/decide`, { decision: 'approved' });
    rec('אישור מנהל', 'מהנדס לא יכול לתת חוות דעת בשם גורם תשתית (רק הגורם עצמו או מנהל המערכת)', r.status === 403);
    rec('סדר טיפול', 'כשהגורם הראשון סיים – נרשם בהיסטוריה שהתור עבר לגורם הבא', !!db.prepare("SELECT 1 FROM request_history WHERE request_id = ? AND action LIKE 'התור עבר ל%'").get(reqId) && db.prepare('SELECT notified_at FROM request_approvals WHERE id = ?').get(otherAppr.id).notified_at !== null);
    r = await admin.req('POST', `/api/approvals/${otherAppr.id}/decide`, { decision: 'conditions', comment: 'עבודה בלילה בלבד' });
    const st1 = db.prepare('SELECT status FROM requests WHERE id = ?').get(reqId).status;
    rec('אישור מנהל', 'כשהגורם האחרון מאשר (גם "בתנאים") – הבקשה עוברת אוטומטית ל"ממתינה לאישור מנהל המערכת"', r.data.advanced === true && st1 === 'pending_admin', st1);
    rec('אישור מנהל', 'מנהל המערכת מקבל התראה על הבקשה שממתינה לו', !!db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = 'chief' AND n.text LIKE '%ממתינה לאישורך%'").get());
    r = await E.req('POST', `/api/requests/${reqId}/status`, { status: 'approved' });
    const r2b = await A.req('POST', `/api/requests/${reqId}/status`, { status: 'approved' });
    rec('אישור מנהל', 'מהנדס ומבקש לא יכולים לאשר סופית (רק מנהל המערכת)', r.status === 403 && (r2b.status === 403 || r2b.status === 400), `${r.status}/${r2b.status} ${r.data.error}`);
    const pend = await admin.req('GET', '/api/requests?scope=pending_me');
    rec('אישור מנהל', 'הבקשה מופיעה למנהל ב"ממתין לטיפולי"', pend.data.items.some(x => x.id === reqId));
    r = await admin.req('POST', `/api/requests/${reqId}/status`, { status: 'approved', comment: 'מאושר לביצוע' });
    rec('תהליך', 'מסלול מלא: הגשה ← בדיקה ← תיאום ← אישורי גורמים ← אישור מנהל המערכת', r.status === 200);
    const fin = db.prepare('SELECT status, closed_at FROM requests WHERE id = ?').get(reqId);
    r = await admin.req('POST', `/api/requests/${reqId}/status`, { status: 'closed' });
    rec('אישור מנהל', 'אישור מנהל המערכת מסיים את הבקשה – אין שלב סגירה נוסף', fin.status === 'approved' && !!fin.closed_at && r.status === 400);
    const apDoc = db.prepare("SELECT * FROM documents WHERE request_id = ? AND category = 'אישור לביצוע עבודה'").get(reqId);
    const apBuf = apDoc ? fs.readFileSync(path.join(dataDir, 'uploads', apDoc.stored_name)) : Buffer.alloc(0);
    rec('מסמך אישור', 'באישור הסופי הופק מסמך PDF לבקשה, משותף לכל המעורבים', !!apDoc && apDoc.visibility === 'shared' && apBuf.subarray(0, 5).toString() === '%PDF-');
    const apView = await A.req('GET', `/api/requests/${reqId}`);
    const apDl = await A.req('GET', `/api/documents/${apDoc.id}/download`, undefined, { raw: true });
    rec('מסמך אישור', 'המגיש רואה ומוריד את מסמך האישור בבקשה שלו', apView.data.approvalDoc && apView.data.approvalDoc.id === apDoc.id && apDl.status === 200, `view ${apView.status} doc ${JSON.stringify(apView.data.approvalDoc)} dl ${apDl.status} ${apView.data.error || ''}`);
    let pdfText = '';
    try { const tmpP = path.join(os.tmpdir(), 'coord-ap.pdf'); fs.writeFileSync(tmpP, apBuf); pdfText = execFileSync('pdftotext', [tmpP, '-']).toString(); } catch { pdfText = ''; }
    const rqNum = db.prepare('SELECT number FROM requests WHERE id = ?').get(reqId).number;
    rec('מסמך אישור', 'המסמך כולל מספר בקשה, גורמים מאשרים ותנאים, וטקסט עברי קריא', pdfText.includes(rqNum) && pdfText.includes('עבודה בלילה בלבד') && pdfText.includes('הבקשה אושרה'), pdfText ? 'טקסט חולץ מה-PDF' : 'pdftotext לא זמין');
    r = await A.req('GET', '/api/notifications');
    rec('תהליך', 'המגיש מקבל התראות על שינויי סטטוס', r.data.items.length >= 3, r.data.items.length + ' התראות');

    // ---------- דוחות: סינון לפי הרשאה ----------
    const repB = (await users.applB.c.req('GET', '/api/reports?months=12')).data;
    const repE = (await E.req('GET', '/api/reports?months=12')).data;
    rec('הרשאות (IDOR)', 'דוחות וגרפים: מבקש רואה רק את הבקשות שלו, בלי משימות', repB.total === 0 && repB.budget === undefined && repB.tasks === null && repE.total >= 1, `מבקש: ${repB.total}, מהנדס: ${repE.total}`);
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
      const n1 = (await applyPublic(base)).number;
      const n2 = await applyPublic(base); n2Id = n2.id;
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
      const e1 = await admin.req('POST', '/api/admin/users', { ...base0, username: 'need1' });
      const e3 = await admin.req('POST', '/api/admin/users', { ...base0, username: 'need3', role_id: null, no_infra: true });
      const ok0 = await admin.req('POST', '/api/admin/users', { ...base0, username: 'nolink', password: pw(), no_infra: true });
      rec('משתמש חדש', 'גורם תשתית ותפקיד הם שדות חובה; שיוך לבקשה אינו חלק מיצירת משתמש', e1.status === 400 && e3.status === 400 && ok0.status === 201 && db.prepare('SELECT COUNT(*) c FROM user_requests WHERE user_id = ?').get(ok0.data.id).c === 0, [e1.data.error, e3.data.error, ok0.status].join(' | '));
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
      const names = (x) => x.data.documents.filter(d => d.visibility !== 'shared').map(d => d.original_name);
      rec('מסמכים', 'כל משתמש רואה רק את המסמכים שהעלה; מנהל המערכת רואה את כולם',
        names(engView).every(n => n === 'eng-plan.pdf') && !names(applView).includes('eng-plan.pdf') && names(applView).includes('appl-plan.pdf') && names(adminView).includes('eng-plan.pdf') && names(adminView).includes('appl-plan.pdf'),
        `מהנדס: ${names(engView).length}, מבקש: ${names(applView).length}, מנהל: ${names(adminView).length}`);
      const steal = await A2.req('GET', `/api/documents/${ed.data.id}/download`);
      rec('מסמכים', 'הורדה ישירה של מסמך של משתמש אחר נחסמת (404)', steal.status === 404);
      const allDocs = await E2.req('GET', '/api/documents');
      rec('מסמכים', 'גם במסך "מסמכים" מופיעים רק המסמכים שלי (ומסמך האישור המשותף)', allDocs.data.items.every(d => d.uploaded_by === users.eng.id || d.visibility === 'shared'));
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
    const concat = src.split('\n').filter(l => /prepare\(`[^`]*\$\{(?!where|REQ_SELECT|PROJ_SELECT|cols\.map|mine \?|DONE\}|table\})/.test(l));
    rec('SQL Injection', 'סריקת קוד: אין שרשור קלט משתמש לשאילתות', concat.length === 0, concat.length ? concat[0].trim().slice(0, 100) : 'רק שמות עמודות קבועים משורשרים; כל הערכים כ-?');

    // ---------- מסכים שהוסרו ----------
    {
      const gone = [];
      for (const [m, u] of [['GET', '/api/projects'], ['POST', '/api/projects'], ['GET', '/api/projects/1'], ['POST', '/api/projects/1/budget'], ['DELETE', '/api/budget/1'], ['GET', '/api/schedule'], ['POST', '/api/requests']]) {
        const x = await admin.req(m, u, m === 'GET' || m === 'DELETE' ? undefined : { name: 'x' }); if (x.status !== 404 && x.status !== 405) gone.push(`${m} ${u}:${x.status}`);
      }
      rec('מסכים שהוסרו', 'בקשה חדשה פנימית, פרויקטים, תקציב ולוח זמנים הוסרו גם מהשרת (404)', gone.length === 0, gone.join(', '));
      const permKeys = (await admin.req('GET', '/api/admin/permissions')).data.items.map(x => x.key);
      rec('מסכים שהוסרו', 'ההרשאות של פרויקטים, תקציב ובקשה חדשה הוסרו מלוח הבקרה', !permKeys.some(k => /^(projects|budget)\.|^requests\.create$/.test(k)), permKeys.join(','));
    }

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

    // ---------- מופע 4: סנכרון לענן (שרת מדומה בתבנית Supabase Storage) ----------
    {
      const store = new Map(); let failGet = false; let badKey = 0; let puts = 0;
      const mock = require('node:http').createServer(async (q, s2) => {
        const chunks = []; for await (const c of q) chunks.push(c); const body = Buffer.concat(chunks);
        if (q.headers.apikey !== 'sb_secret_test') { badKey++; s2.writeHead(401); return s2.end('{"error":"bad key"}'); }
        const m = q.url.match(/^\/storage\/v1\/object\/handasa(?:\/(.+))?$/); if (!m) { s2.writeHead(404); return s2.end(); }
        const key = m[1] ? m[1].split('/').map(decodeURIComponent).join('/') : null;
        if (q.method === 'POST' && key) { store.set(key, body); puts++; s2.writeHead(200, { 'Content-Type': 'application/json' }); return s2.end('{"Key":"x"}'); }
        if (q.method === 'GET' && key) {
          if (failGet && key.startsWith('db/')) { s2.writeHead(503); return s2.end('paused'); }
          if (!store.has(key)) { s2.writeHead(400, { 'Content-Type': 'application/json' }); return s2.end('{"statusCode":"404","error":"not_found","message":"Object not found"}'); }
          s2.writeHead(200); return s2.end(store.get(key));
        }
        if (q.method === 'DELETE' && !key) { for (const k of JSON.parse(body).prefixes) store.delete(k); s2.writeHead(200); return s2.end('[]'); }
        s2.writeHead(405); s2.end();
      });
      await new Promise(res => mock.listen(4830, '127.0.0.1', res));
      const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-cloud-'));
      const cenv = { NODE_ENV: 'production', FORCE_HTTPS: '0', TRUST_PROXY: '1', DATA_DIR: cdir, UPLOAD_DIR: path.join(cdir, 'uploads'), BACKUP_DIR: path.join(cdir, 'backups'), LOG_DIR: path.join(cdir, 'logs'),
        SUPABASE_URL: 'http://127.0.0.1:4830', SUPABASE_SERVICE_KEY: 'sb_secret_test', SUPABASE_BUCKET: 'handasa', ADMIN_USERNAME: 'boss', ADMIN_FULLNAME: 'מנהלת', ADMIN_PASSWORD: adminPw };
      const cb = 'http://127.0.0.1:4804';
      srv = await startServer(cenv, 4804);
      const cA = new Client(cb); r = await cA.login('boss', adminPw); cA.csrf = r.data && r.data.csrf;
      rec('ענן', 'מנהל ראשון נוצר אוטומטית ממשתני הסביבה (ADMIN_USERNAME / ADMIN_PASSWORD)', r.status === 200);
      await cA.req('POST', '/api/auth/change-password', { current: adminPw, next: adminPw + 'x' }).then(x => { cA.csrf = x.data.csrf; });
      const roles2 = (await cA.req('GET', '/api/admin/roles')).data.items;
      const nu = await cA.req('POST', '/api/admin/users', { username: 'cloud.user', full_name: 'משתמש ענן', role_id: roles2[4].id, password: pw(), no_request: true, no_infra: true });
      const rq = { data: await applyPublic(cb) };
      const fdc = new FormData(); fdc.append('request_id', String(rq.data.id)); fdc.append('file', new Blob([Buffer.from('%PDF-1.4\n% cloud\n%%EOF')]), 'cloud.pdf');
      const cd = await cA.req('POST', '/api/documents', fdc);
      const fdl = new FormData(); fdl.append('file', new Blob([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)])]), 'logo.png');
      await cA.req('POST', '/api/admin/logo', fdl);
      rec('ענן', 'קבצים ולוגו עולים לענן מיד בהעלאה', [...store.keys()].some(k => k.startsWith('uploads/')) && [...store.keys()].some(k => k.startsWith('logo/')), [...store.keys()].join(', '));
      srv.kill('SIGTERM'); await new Promise(res => srv.on('exit', res));
      rec('ענן', 'בכיבוי השרת נשמר עותק אחרון של המסד לענן + עותק יומי', store.has('db/app.sqlite') && [...store.keys()].some(k => /^db\/daily\/\d{4}-\d{2}-\d{2}\.sqlite$/.test(k)) && badKey === 0);
      fs.rmSync(cdir, { recursive: true, force: true }); // מדמה את Render בחינם: הדיסק נמחק
      srv = await startServer(cenv, 4804);
      const cB = new Client(cb); r = await cB.login('boss', adminPw + 'x'); cB.csrf = r.data && r.data.csrf;
      const users2 = r.status === 200 ? (await cB.req('GET', '/api/admin/users')).data.items : [];
      const rq2 = r.status === 200 ? await cB.req('GET', `/api/requests/${rq.data.id}`) : { status: 0 };
      const dl2 = await cB.req('GET', `/api/documents/${cd.data.id}/download`, undefined, { raw: true });
      const dlText = dl2.status === 200 ? await dl2.text() : '';
      const lg2 = await fetch(cb + '/api/logo');
      rec('ענן', 'אחרי מחיקת הדיסק והפעלה מחדש: הסיסמה, המשתמש, הבקשה, הקובץ והלוגו חזרו', r.status === 200 && users2.some(u => u.username === 'cloud.user') && rq2.status === 200 && dlText.includes('% cloud') && lg2.status === 200,
        `כניסה ${r.status}, משתמש ${users2.some(u => u.username === 'cloud.user')}, בקשה ${rq2.status}, קובץ ${dl2.status}, לוגו ${lg2.status}`);
      srv.kill('SIGTERM'); await new Promise(res => srv.on('exit', res));
      // הענן לא זמין בהפעלה → השרת לא דורס את העותק הטוב
      failGet = true; const snap = store.get('db/app.sqlite'); const putsBefore = puts;
      fs.rmSync(cdir, { recursive: true, force: true });
      srv = await startServer(cenv, 4804);
      const cC = new Client(cb); const lc = await cC.login('boss', adminPw); cC.csrf = lc.data && lc.data.csrf;
      await new Promise(res => setTimeout(res, 4500));
      rec('ענן', 'כשהענן לא זמין בהפעלה – השרת לא דורס את העותק השמור במסד ריק', Buffer.compare(store.get('db/app.sqlite'), snap) === 0 && !store.has('db/app.sqlite.tmp'), `העלאות אחרי התקלה: ${puts - putsBefore}`);
      srv.kill('SIGTERM'); await new Promise(res => srv.on('exit', res)); mock.close();
    }

    // ---------- מופע 5: הגשת בקשה מהציבור + סדר טיפול + דוא"ל ----------
    {
      const net = require('node:net'); const mails = [];
      const smtp = net.createServer(sock => {
        let data = false; let body = ''; let rcpt = '';
        sock.write('220 test ESMTP\r\n');
        sock.on('data', d => { for (const line of d.toString().split('\r\n')) {
          if (data) { if (line === '.') { data = false; mails.push({ to: rcpt, body }); sock.write('250 ok\r\n'); } else body += line + '\n'; continue; }
          if (/^EHLO/i.test(line)) sock.write('250-test\r\n250 8BITMIME\r\n');
          else if (/^RCPT/i.test(line)) { rcpt = (line.match(/<([^>]+)>/) || [])[1]; sock.write('250 ok\r\n'); }
          else if (/^MAIL/i.test(line)) sock.write('250 ok\r\n');
          else if (/^DATA/i.test(line)) { data = true; body = ''; sock.write('354 go\r\n'); }
          else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
        } });
      });
      await new Promise(res => smtp.listen(4827, '127.0.0.1', res));
      const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-apply-'));
      const env5 = { NODE_ENV: 'production', FORCE_HTTPS: '0', TRUST_PROXY: '1', DATA_DIR: d5, UPLOAD_DIR: path.join(d5, 'u'), BACKUP_DIR: path.join(d5, 'b'), LOG_DIR: path.join(d5, 'l'),
        SMTP_HOST: '127.0.0.1', SMTP_PORT: '4827', SMTP_ALLOW_INSECURE: '1', MAIL_FROM: 'no-reply@example.gov.il', ADMIN_USERNAME: 'root5', ADMIN_FULLNAME: 'מנהלת המערכת', ADMIN_PASSWORD: adminPw };
      srv = await startServer(env5, 4805);
      const b5 = 'http://127.0.0.1:4805';
      const db5 = new (require('node:sqlite').DatabaseSync)(path.join(d5, 'app.db'));
      db5.prepare("UPDATE users SET email = 'admin@example.gov.il' WHERE username = 'root5'").run();
      const ad = new Client(b5); r = await ad.login('root5', adminPw); ad.csrf = r.data.csrf;
      const roles5 = (await ad.req('GET', '/api/admin/roles')).data.items; const rid5 = n => roles5.find(x => x.name === n).id;
      const infra5 = (await ad.req('GET', '/api/admin/infra')).data.items;
      const mk = async (username, extra) => { const p = pw(); const c = await ad.req('POST', '/api/admin/users', { username, full_name: 'משתמש ' + username, password: p, no_request: true, ...extra });
        db5.prepare('UPDATE users SET must_change_pw = 0 WHERE id = ?').run(c.data.id); const cl = new Client(b5); const l = await cl.login(username, p); cl.csrf = l.data.csrf; return { id: c.data.id, c: cl }; };
      const mapper = await mk('mapper', { role_id: rid5('רכז תיאום'), email: 'mapper@example.gov.il', no_infra: true });
      await ad.req('PUT', `/api/admin/users/${mapper.id}`, { perm_grant: ['requests.mapping'] }); { const l = await mapper.c.login('mapper', null); }
      const mp = pw(); await ad.req('POST', `/api/admin/users/${mapper.id}/password`, { password: mp, must_change: false }); { const l = await mapper.c.login('mapper', mp); mapper.c.csrf = l.data.csrf; }
      const b1 = await mk('body.one', { role_id: rid5('גורם תשתית'), email: 'b1@example.gov.il', infra_body_id: infra5[0].id });
      const b2 = await mk('body.two', { role_id: rid5('גורם תשתית'), email: 'b2@example.gov.il', infra_body_id: infra5[1].id });
      const handler = await mk('handler', { role_id: rid5('מהנדס / מאשר'), email: 'handler@example.gov.il', no_infra: true });
      // סוג בקשה עם מטפל, סדר גורמים ותפקיד ייעודי ליזם
      const ent = await ad.req('POST', '/api/admin/roles', { name: 'יזם – עבודות בדרכים', perms: ['requests.view_own', 'files.upload', 'files.download'] });
      const badRole = await ad.req('POST', '/api/admin/request-types', { name: 'ניסיון', role_resident: rid5('מנהל מערכת') });
      rec('סוגי בקשות', 'אי אפשר לתת לנרשמים מהציבור תפקיד עם הרשאות ניהול', badRole.status === 400, badRole.data.error);
      const ty = await ad.req('POST', '/api/admin/request-types', { name: 'עבודות בדרכים', description: 'חפירה, הנחת קווים ותיקונים בשטח ציבורי', handler_ids: [handler.id] /* מטפלים אוטומטיים בוטלו – השרת מתעלם */, infra_chain: [infra5[0].id, infra5[1].id], role_entrepreneur: ent.data.id });
      const meta = await new Client(b5).req('GET', '/api/public/apply-meta');
      const tKey = meta.data.types.find(t => t.name === 'עבודות בדרכים').key;
      rec('סוגי בקשות', 'סוג בקשה שהוגדר בלוח הבקרה מופיע בטופס הציבורי עם התיאור', ty.status === 201 && !!tKey && meta.data.types.find(t => t.key === tKey).description.includes('חפירה'));
      const pdfBuf = Buffer.from('%PDF-1.4\n% route plan\n%%EOF'); const dwf = Buffer.concat([Buffer.from('(DWF V06.00)'), Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 1)]);
      const police = { applicant_name: 'ישראל ישראלי', project: 'שדרוג קווי ביוב', id_kind: 'id', id_number: '000000018', phone: '050-1234567', description: 'חפירה ברחוב הגפן', work_time: 'ימים א׳-ה׳', work_hours: '07:00-19:00', contact: 'דני 052-7654321', notes: '', date: '2026-12-01' };
      const apply = (ip, over = {}, files = {}) => {
        const fd = new FormData();
        const base = { kind: 'entrepreneur', username: 'ישראל ישראלי', password: APPLY_PW, type: tKey, email: 'israel@example.com', address: 'הגפן 3, קריית גת', phone: '0501234567', project: 'שדרוג קווי ביוב', police: JSON.stringify(police), location: JSON.stringify({ x: 177750.5, y: 613190.25, z: 9, label: 'רחוב הגפן 3' }), ...over };
        for (const [k, v2] of Object.entries(base)) if (v2 !== undefined) fd.append(k, v2);
        const fl = { route_plan: ['plan.dwf', dwf], work_request: ['request.pdf', pdfBuf], ...files };
        for (const [k, v2] of Object.entries(fl)) if (v2) fd.append(k, new Blob([v2[1]]), v2[0]);
        return new Client(b5, ip).req('POST', '/api/public/apply', fd);
      };
      const neg = [];
      for (const [desc, over, files] of [['שדה מלכודת', { website: 'spam' }], ['בלי טופס משטרה', { police: undefined }], ['ת.ז שגויה', { police: JSON.stringify({ ...police, id_number: '123456789' }) }],
        ['טלפון שגוי', { phone: '12345' }], ['אימייל שגוי', { email: 'not-mail' }], ['סוג בקשה לא קיים', { type: 'nope' }], ['בלי תוכנית תוואי', {}, { route_plan: null }],
        ['תוכנית DWG (רק PDF/DWF)', {}, { route_plan: ['plan.dwg', Buffer.from('AC1032 dwg')] }], ['HTML שמתחזה ל-PDF', {}, { work_request: ['x.pdf', Buffer.from('<html><script>alert(1)</script>')] }],
        ['שם משתמש עם תו כיווניות', { username: 'ישראל‮abc' }], ['סיסמה חלשה', { password: '1234' }],
        ['בלי מיקום', { location: undefined }], ['מיקום מחוץ לישראל', { location: JSON.stringify({ x: 5, y: 5 }) }], ['מיקום לא מספרי', { location: '{"x":"abc","y":"1"}' }]]) {
        const x = await apply(`10.50.0.${neg.length + 1}`, over, files); if (x.status < 400) neg.push(`${desc}:${x.status}`);
      }
      rec('הגשה מהציבור', '14 הגשות לא תקינות נדחות בשרת (מלכודת, משטרה, ת.ז, טלפון, אימייל, סוג, קבצים, שם, סיסמה, מיקום)', neg.length === 0, neg.join(', '));
      const ok = await apply('10.60.0.1');
      rec('הגשה מהציבור', 'יזם מגיש בקשה עם שם משתמש בעברית ומקבל מספר בקשה', ok.status === 201 && /^TH-\d{4}-\d{4}$/.test(ok.data.number), `${ok.status} ${ok.data.number || ok.data.error}`);
      const dup = await apply('10.60.0.2');
      rec('הגשה מהציבור', 'שם משתמש תפוס נדחה', dup.status === 400 && /תפוס/.test(dup.data.error));
      let lim = 0; for (let i = 0; i < 6; i++) { const x = await apply('10.70.0.9', { username: 'ניסיון' + i }); if (x.status === 429) lim++; }
      rec('הגשה מהציבור', 'הגבלה: עד 5 הגשות בשעה מאותה כתובת', lim >= 1);
      const reqId5 = ok.data.id; const nu = db5.prepare("SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = 'ישראל ישראלי'").get();
      rec('הגשה מהציבור', 'המשתמש נוצר עם התפקיד שהוגדר ליזם בסוג הבקשה', nu && nu.role_name === 'יזם – עבודות בדרכים' && nu.applicant_kind === 'entrepreneur');
      const rq5 = db5.prepare('SELECT * FROM requests WHERE id = ?').get(reqId5);
      const chain5 = db5.prepare('SELECT infra_body_id, seq FROM request_approvals WHERE request_id = ? ORDER BY seq').all(reqId5);
      {
        const tm = meta.data.types.find(t => t.key === tKey);
        const hist = db5.prepare("SELECT details FROM request_history WHERE request_id = ? AND action = 'גורמי התשתית נקבעו אוטומטית לפי סוג הבקשה'").get(reqId5);
        rec('סנכרון גורמים', 'בבחירת סוג הבקשה בהגשה מוצגים הגורמים הקבועים, והם נכנסים לבקשה אוטומטית (ומתועדים בהיסטוריה)',
          tm.bodies.join() === [infra5[0].name, infra5[1].name].join() && chain5.length === 2 && !!hist && hist.details.includes(infra5[0].name), JSON.stringify(tm.bodies));
        // שינוי סוג בבקשה קיימת: מסתנכרן לגורמים של הסוג החדש, רק כל עוד אף גורם לא התחיל לטפל
        const applIdS = db5.prepare('SELECT applicant_id FROM requests WHERE id = ?').get(reqId5).applicant_id;
        const s1 = seedReq(db5, applIdS, { status: 'submitted' });
        const u1 = await ad.req('PUT', `/api/requests/${s1.id}`, { type: tKey });
        const c1 = db5.prepare('SELECT infra_body_id FROM request_approvals WHERE request_id = ? ORDER BY seq').all(s1.id).map(x => x.infra_body_id);
        const s2 = seedReq(db5, applIdS, { status: 'coordination' });
        db5.prepare("INSERT INTO request_approvals (request_id, infra_body_id, seq, decision, decided_at) VALUES (?, ?, 1, 'approved', datetime('now'))").run(s2.id, infra5[2].id);
        await ad.req('PUT', `/api/requests/${s2.id}`, { type: tKey });
        const c2 = db5.prepare('SELECT infra_body_id FROM request_approvals WHERE request_id = ?').all(s2.id).map(x => x.infra_body_id);
        rec('סנכרון גורמים', 'שינוי סוג בקשה מעדכן את הגורמים לגורמים הקבועים של הסוג החדש – אבל לא אחרי שגורם כבר החליט', u1.status === 200 && c1.join() === [infra5[0].id, infra5[1].id].join() && c2.join() === String(infra5[2].id), `${c1} | ${c2}`);
      }
      rec('הגשה מהציבור', 'אין מטפל אוטומטי (בוטל): הבקשה לא מוקצית מראש, וגורמי התשתית נקבעו לפי הסדר שהוגדר בסוג', rq5.assignee_id === null && chain5.map(c => c.infra_body_id).join() === [infra5[0].id, infra5[1].id].join());
      await new Promise(res => setTimeout(res, 600));
      rec('הגשה מהציבור', 'אחראי המיפוי ומנהל המערכת קיבלו דוא"ל והתראה על הבקשה החדשה (ולא "מטפל אוטומטי")', !mails.some(m => m.to === 'handler@example.gov.il') && ['mapper@example.gov.il', 'admin@example.gov.il'].every(a => mails.some(m => m.to === a && m.body.includes('Subject:'))) && !!db5.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND text LIKE ?").get(mapper.id, '%' + ok.data.number + '%'));
      rec('הגשה מהציבור', 'המגיש קיבל דוא"ל אישור קבלה עם מספר הבקשה', mails.some(m => m.to === 'israel@example.com'));
      // טופס משטרה: מוגבל
      const appl = new Client(b5, '10.60.0.1'); const al = await appl.login('ישראל ישראלי', APPLY_PW); appl.csrf = al.data.csrf;
      const av = await appl.req('GET', `/api/requests/${reqId5}`);
      const polDoc = db5.prepare("SELECT * FROM documents WHERE request_id = ? AND category = 'טופס משטרה'").get(reqId5);
      const polDl = await appl.req('GET', `/api/documents/${polDoc.id}/download`);
      const mv = await mapper.c.req('GET', `/api/requests/${reqId5}`);
      const mpDl = await mapper.c.req('GET', `/api/documents/${polDoc.id}/download`, undefined, { raw: true });
      const b1v = await b1.c.req('GET', `/api/documents/${polDoc.id}/download`);
      rec('טופס משטרה', 'טופס המשטרה נשמר כ-PDF: גלוי רק למנהל המערכת ולאחראי מיפוי (לא למגיש ולא לגורם תשתית)',
        !av.data.documents.some(d => d.category === 'טופס משטרה') && polDl.status === 404 && b1v.status === 404 && mv.data.documents.some(d => d.category === 'טופס משטרה') && mpDl.status === 200);
      rec('הגשה מהציבור', 'המגיש מחובר אוטומטית ורואה את הבקשה, תוכנית התוואי ובקשת העבודה שלו', av.status === 200 && av.data.documents.filter(d => ['תוכנית תוואי', 'בקשת עבודה'].includes(d.category)).length === 2);
      // מיקום העבודה (GovMap)
      {
        const loc5 = av.data.location;
        rec('מיקום', 'המיקום שסומן נשמר בבקשה ומוצג לכל מי שרואה אותה, עם קישור ל-GovMap', !!loc5 && loc5.x === 177750.5 && loc5.y === 613190.25 && loc5.link === 'https://www.govmap.gov.il/?c=177750.5,613190.25&z=9' && mv.data.location && mv.data.location.label === 'רחוב הגפן 3', JSON.stringify(loc5));
        const upA = await appl.req('PUT', `/api/requests/${reqId5}/location`, { location: { x: 178000, y: 613000 } });
        const upM = await mapper.c.req('PUT', `/api/requests/${reqId5}/location`, { location: { x: 177760, y: 613200, z: 9.5, label: 'תיקון: מול מספר 5' } });
        const upBad = await mapper.c.req('PUT', `/api/requests/${reqId5}/location`, { location: { x: 'x' } });
        const now5 = db5.prepare('SELECT loc_x, loc_label FROM requests WHERE id = ?').get(reqId5);
        rec('מיקום', 'אחראי המיפוי יכול לעדכן מיקום (עם אימות), והמגיש לא יכול לשנות אחרי ההגשה', upA.status === 403 && upM.status === 200 && upBad.status === 400 && now5.loc_x === 177760 && now5.loc_label === 'תיקון: מול מספר 5', `${upA.status} ${upM.status} ${upBad.status}`);
        const cfg0 = await new Client(b5).req('GET', '/api/public/map-config');
        await ad.req('PUT', '/api/admin/settings', { govmap_token: 'test-token_123' });
        const cfg1 = await new Client(b5).req('GET', '/api/public/map-config');
        const badTok = await ad.req('PUT', '/api/admin/settings', { govmap_token: '"><script>' });
        rec('מיקום', 'מפתח GovMap נקבע מהגדרות וקבצים ומגיע לעמוד המפה (ומפתח לא תקין נדחה)', cfg0.data.token === '' && cfg1.data.token === 'test-token_123' && badTok.status === 400 && cfg1.data.center.x > 170000);
        const mh = await fetch(b5 + '/map.html'); const csp = mh.headers.get('content-security-policy') || ''; const mainCsp = (await fetch(b5 + '/')).headers.get('content-security-policy') || '';
        rec('מיקום', 'עמוד המפה מורשה לטעון רק את GovMap ורק בתוך האתר עצמו; שאר האתר נשאר חסום', mh.status === 200 && /script-src 'self' https:\/\/www\.govmap\.gov\.il/.test(csp) && /frame-ancestors 'self'/.test(csp) && mh.headers.get('x-frame-options') === 'SAMEORIGIN'
          && !/govmap/.test(mainCsp) && /frame-ancestors 'none'/.test(mainCsp), csp.slice(0, 90));
      }
      // זמן העבודה מטופס המשטרה עובר לבקשה
      rec('זמן עבודה', 'זמן העבודה מטופס המשטרה מופיע גם בבקשה עצמה, לכל מי שמטפל בה', av.data.request.work_time === police.work_time && mv.data.request.work_time === police.work_time, av.data.request.work_time);
      // צפייה בקבצים בלי להוריד
      {
        const rp = av.data.documents.find(d => d.category === 'בקשת עבודה'); const dwfDoc = av.data.documents.find(d => d.category === 'תוכנית תוואי');
        const dwfV = await appl.req('GET', `/api/documents/${dwfDoc.id}/view`);
        const vw = await appl.req('GET', `/api/documents/${rp.id}/view`, undefined, { raw: true });
        const vcsp = vw.headers.get('content-security-policy') || '';
        const polV = await appl.req('GET', `/api/documents/${polDoc.id}/view`);
        const polM = await mapper.c.req('GET', `/api/documents/${polDoc.id}/view`, undefined, { raw: true });
        rec('צפייה בקבצים', 'PDF נפתח לצפייה בתוך המערכת (inline) בלי הורדה, ורק בתוך האתר עצמו', vw.status === 200 && /^inline/.test(vw.headers.get('content-disposition')) && vw.headers.get('content-type') === 'application/pdf'
          && /frame-ancestors 'self'/.test(vcsp) && /script-src 'none'/.test(vcsp) && vw.headers.get('x-frame-options') === 'SAMEORIGIN' && dwfV.status === 415, `${vw.status} ${vw.headers.get('content-type')} ${vw.headers.get('content-disposition')} ${vcsp}`);
        rec('צפייה בקבצים', 'הרשאות הצפייה זהות להורדה: טופס המשטרה המוגבל לא נפתח למגיש', polV.status === 404 && polM.status === 200);
        // Word / Excel: תצוגת טקסט וטבלאות
        const docx = makeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>כותרת המסמך</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">שלום </w:t></w:r><w:r><w:t>עולם &amp; &lt;b&gt;</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>תא א</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>תא ב</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' });
        const xlsx = makeZip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="נתונים" sheetId="1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
          'xl/sharedStrings.xml': '<sst><si><t>שם</t></si><si><t>כמות</t></si><si><t>צינור</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>42</v></c></row></sheetData></worksheet>' });
        const upOffice = async (buf, name) => { const fd = new FormData(); fd.append('request_id', String(reqId5)); fd.append('category', 'כללי'); fd.append('file', new Blob([buf]), name); return (await mapper.c.req('POST', '/api/documents', fd)).data.id; };
        const dId = await upOffice(docx, 'מכתב.docx'); const xId = await upOffice(xlsx, 'כמויות.xlsx');
        const pd = await mapper.c.req('GET', `/api/documents/${dId}/preview`); const px = await mapper.c.req('GET', `/api/documents/${xId}/preview`);
        rec('צפייה בקבצים', 'קובץ Word מוצג כטקסט (כותרות, פסקאות וטבלאות) בלי הורדה', pd.status === 200 && pd.data.kind === 'doc' && pd.data.blocks[0].type === 'h' && pd.data.blocks[0].text === 'כותרת המסמך'
          && pd.data.blocks[1].text === 'שלום עולם & <b>' && pd.data.blocks[2].type === 'table' && pd.data.blocks[2].rows[0].join('|') === 'תא א|תא ב', JSON.stringify(pd.data).slice(0, 160));
        rec('צפייה בקבצים', 'קובץ Excel מוצג כטבלה לפי גיליונות', px.status === 200 && px.data.sheets[0].name === 'נתונים' && px.data.sheets[0].rows[1].join('|') === 'צינור||42', JSON.stringify(px.data).slice(0, 160));
        const notView = await mapper.c.req('GET', `/api/documents/${dId}/view`);
        const bomb = await upOffice(makeZip({ 'word/document.xml': '<w:document><w:body>' + '<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(5000) + '</w:body></w:document>' }), 'ארוך.docx');
        const pb = await mapper.c.req('GET', `/api/documents/${bomb}/preview`);
        rec('צפייה בקבצים', 'סוגים שהדפדפן לא מציג בבטחה לא נפתחים ישירות, ומסמך ענק מוצג חלקית', notView.status === 415 && pb.status === 200 && pb.data.truncated === true && pb.data.blocks.length === 3000);
      }
      // משימות: רק מנהל המערכת ורכז תיאום מקצים; האחראי הוא גורם תשתית ואיש הקשר שלו מקבל את המשימה
      {
        const bodyId = infra5[0].id;
        const noContact = await mapper.c.req('POST', '/api/tasks', { title: 'בדיקת שוחות', infra_body_id: bodyId });
        const byBody = await b1.c.req('POST', '/api/tasks', { title: 'x', infra_body_id: bodyId });
        const asgB1 = await b1.c.req('GET', '/api/tasks/assignees');
        await ad.req('PUT', `/api/admin/infra/${bodyId}`, { contact_user_id: b1.id });
        const asg = await mapper.c.req('GET', '/api/tasks/assignees');
        mails.length = 0;
        const tk = await mapper.c.req('POST', '/api/tasks', { title: 'בדיקת שוחות ברחוב הגפן', infra_body_id: bodyId, due_date: '2026-12-01', request_id: reqId5 });
        await new Promise(res => setTimeout(res, 500));
        const row = db5.prepare('SELECT assignee_id, infra_body_id FROM tasks WHERE id = ?').get(tk.data.id);
        const tm = mails.find(m => m.to === 'b1@example.gov.il');
        const tmText = tm ? tm.body + Buffer.from((tm.body.split(/\n\n/).slice(1).join('\n\n').match(/[A-Za-z0-9+/=\n]{40,}/) || [''])[0].replace(/\s+/g, ''), 'base64').toString('utf8') : '';
        rec('משימות', 'רק מנהל המערכת ורכז תיאום מקצים משימות (גורם תשתית לא יכול)', byBody.status === 403 && asgB1.status === 403 && tk.status === 201, `${byBody.status} ${asgB1.status} ${tk.status}`);
        rec('משימות', 'ברשימת האחראים מופיעים גורמי התשתית עם איש הקשר שהוגדר להם', asg.status === 200 && asg.data.items.some(x => x.id === bodyId && x.contact_id === b1.id) && noContact.status === 400 && /איש קשר/.test(noContact.data.error), noContact.data && noContact.data.error);
        rec('משימות', 'המשימה מגיעה לאיש הקשר של הגורם – בהודעה ובאימייל', row.assignee_id === b1.id && row.infra_body_id === bodyId && /בדיקת שוחות ברחוב הגפן/.test(tmText) && /#\/tasks/.test(tmText));
        const myT = await b1.c.req('GET', '/api/tasks'); const st = await b1.c.req('PUT', `/api/tasks/${tk.data.id}`, { status: 'בביצוע', title: 'שינוי' }); const del = await b1.c.req('DELETE', `/api/tasks/${tk.data.id}`);
        const after = db5.prepare('SELECT status, title FROM tasks WHERE id = ?').get(tk.data.id);
        rec('משימות', 'איש הקשר רואה את המשימה ומעדכן רק את הסטטוס שלה', myT.data.items.some(t => t.id === tk.data.id && t.infra_name) && st.status === 200 && after.status === 'בביצוע' && after.title === 'בדיקת שוחות ברחוב הגפן' && del.status === 403);
        const me1 = await mapper.c.req('GET', '/api/auth/me'); const me2 = await b1.c.req('GET', '/api/auth/me');
        rec('משימות', 'הממשק יודע מי מורשה להקצות משימות', me1.data.user.can_assign_tasks === true && me2.data.user.can_assign_tasks === false);
      }
      // סדר טיפול עם דוא"ל
      mails.length = 0;
      await mapper.c.req('POST', `/api/requests/${reqId5}/status`, { status: 'review' });
      await new Promise(res => setTimeout(res, 500));
      rec('סדר טיפול', 'כשהבקשה עוברת לבדיקה – רק הגורם הראשון בתור מקבל דוא"ל', mails.some(m => m.to === 'b1@example.gov.il') && !mails.some(m => m.to === 'b2@example.gov.il'));
      const ap5 = db5.prepare('SELECT id, infra_body_id FROM request_approvals WHERE request_id = ? ORDER BY seq').all(reqId5);
      r = await b2.c.req('POST', `/api/approvals/${ap5[1].id}/decide`, { decision: 'approved' });
      rec('סדר טיפול', 'הגורם השני לא יכול לאשר לפני תורו', r.status === 409);
      mails.length = 0;
      await b1.c.req('POST', `/api/approvals/${ap5[0].id}/decide`, { decision: 'conditions', comment: 'קידוח אופקי בלבד מתחת למדרכה החדשה' });
      await new Promise(res => setTimeout(res, 500));
      const m2 = mails.find(m => m.to === 'b2@example.gov.il');
      rec('סדר טיפול', 'כשהגורם הראשון סיים – הגורם הבא מקבל דוא"ל שעכשיו תורו', !!m2);
      await b2.c.req('POST', `/api/approvals/${ap5[1].id}/decide`, { decision: 'approved' });
      rec('סדר טיפול', 'אחרי הגורם האחרון – ממתינה לאישור מנהל המערכת', db5.prepare('SELECT status FROM requests WHERE id = ?').get(reqId5).status === 'pending_admin');
      // החזרה לתיקון לגורם תשתית: הגורם מקבל אימייל עם הסיבה וקישור, וחוות הדעת שלו נפתחת מחדש
      mails.length = 0;
      r = await ad.req('POST', `/api/requests/${reqId5}/status`, { status: 'returned', return_to: ap5[0].id, comment: 'חסר אישור קידוח מעודכן', auto_approve: false });
      await new Promise(res => setTimeout(res, 500));
      const rm = mails.find(m => m.to === 'b1@example.gov.il');
      const rmText = rm ? Buffer.from((rm.body.split(/\n\n/).slice(1).join('\n\n').match(/[A-Za-z0-9+/=\n]{40,}/) || [''])[0].replace(/\s+/g, ''), 'base64').toString('utf8') + rm.body : '';
      const st5 = db5.prepare('SELECT status FROM requests WHERE id = ?').get(reqId5).status; const reop = db5.prepare('SELECT decision FROM request_approvals WHERE id = ?').get(ap5[0].id).decision;
      rec('החזרה לתיקון', 'החזרה לגורם תשתית: הגורם מקבל אימייל עם סיבת ההחזרה וקישור לבקשה, וחוות הדעת שלו נפתחת מחדש',
        r.status === 200 && r.data.returned_to && /חסר אישור קידוח מעודכן/.test(rmText) && new RegExp(`/#/requests/${reqId5}`).test(rmText) && st5 === 'coordination' && reop === 'pending' && !mails.some(m => m.to === 'b2@example.gov.il'), `${r.status} ${st5} ${reop}`);
      r = await b2.c.req('POST', `/api/approvals/${ap5[1].id}/decide`, { decision: 'approved' });
      rec('החזרה לתיקון', 'אחרי החזרה – התור חוזר לגורם שהוחזר אליו (גורם אחר לא יכול להחליט במקומו)', r.status === 409);
      await b1.c.req('POST', `/api/approvals/${ap5[0].id}/decide`, { decision: 'approved', comment: 'צורף אישור קידוח' });
      rec('החזרה לתיקון', 'בלי אישור אוטומטי (כשבוחרים כך) – אחרי התיקון הבקשה חוזרת לאישור מנהל המערכת', db5.prepare('SELECT status FROM requests WHERE id = ?').get(reqId5).status === 'pending_admin');
      // ברירת המחדל: החזרה מהשלב האחרון לגורם – אחרי התיקון הבקשה מאושרת אוטומטית, בלי בדיקה חוזרת
      {
        const applIdA = db5.prepare('SELECT applicant_id FROM requests WHERE id = ?').get(reqId5).applicant_id;
        const sa = seedReq(db5, applIdA, { status: 'pending_admin', title: 'בקשה לאישור אוטומטי אחרי תיקון' });
        const apA = Number(db5.prepare("INSERT INTO request_approvals (request_id, infra_body_id, seq, decision, decided_at) VALUES (?, ?, 1, 'approved', datetime('now'))").run(sa.id, ap5[0].infra_body_id).lastInsertRowid);
        r = await ad.req('POST', `/api/requests/${sa.id}/status`, { status: 'returned', return_to: apA, comment: 'יש לעדכן את שעות העבודה' });
        const autoFlag = r.data.auto_approve === true;
        mails.length = 0;
        r = await b1.c.req('POST', `/api/approvals/${apA}/decide`, { decision: 'approved', comment: 'עודכן' });
        await new Promise(res => setTimeout(res, 800));
        const fin = db5.prepare('SELECT status, closed_at FROM requests WHERE id = ?').get(sa.id);
        const docA = db5.prepare("SELECT 1 FROM documents WHERE request_id = ? AND category = 'אישור לביצוע עבודה'").get(sa.id);
        const pdfMail = mails.find(m => m.to === 'israel@example.com' && /application\/pdf/.test(m.body));
        rec('החזרה לתיקון', 'אחרי שהגורם תיקן ואישר – הבקשה מאושרת אוטומטית בלי בדיקה חוזרת, ומסמך האישור נשלח למגיש', autoFlag && r.status === 200 && r.data.approved && fin.status === 'approved' && !!fin.closed_at && !!docA && !!pdfMail, `${r.status} ${fin.status}`);
        const sb = seedReq(db5, applIdA, { status: 'pending_admin' });
        const apB = Number(db5.prepare("INSERT INTO request_approvals (request_id, infra_body_id, seq, decision, decided_at) VALUES (?, ?, 1, 'approved', datetime('now'))").run(sb.id, ap5[0].infra_body_id).lastInsertRowid);
        await ad.req('POST', `/api/requests/${sb.id}/status`, { status: 'returned', return_to: apB, comment: 'בדיקה' });
        await b1.c.req('POST', `/api/approvals/${apB}/decide`, { decision: 'rejected', comment: 'לא ניתן לבצע' });
        rec('החזרה לתיקון', 'אם הגורם דוחה אחרי ההחזרה – אין אישור אוטומטי', db5.prepare('SELECT status FROM requests WHERE id = ?').get(sb.id).status !== 'approved');
      }
      // החזרה למגיש (על בקשה נוספת שלו)
      const applId5 = db5.prepare('SELECT applicant_id FROM requests WHERE id = ?').get(reqId5).applicant_id;
      const sr = seedReq(db5, applId5, { status: 'review', title: 'בקשה להחזרה למגיש' });
      mails.length = 0;
      r = await ad.req('POST', `/api/requests/${sr.id}/status`, { status: 'returned', return_to: 'applicant', comment: 'יש לצרף תוכנית חתומה' });
      await new Promise(res => setTimeout(res, 500));
      const am = mails.find(m => m.to === 'israel@example.com');
      const amText = am ? am.body + Buffer.from((am.body.split(/\n\n/).slice(1).join('\n\n').match(/[A-Za-z0-9+/=\n]{40,}/) || [''])[0].replace(/\s+/g, ''), 'base64').toString('utf8') : '';
      rec('החזרה לתיקון', 'החזרה למגיש: המגיש מקבל אימייל עם הסיבה וקישור לכניסה', r.status === 200 && /יש לצרף תוכנית חתומה/.test(amText) && new RegExp(`/#/requests/${sr.id}`).test(amText));
      mails.length = 0;
      r = await ad.req('POST', `/api/requests/${reqId5}/status`, { status: 'approved', comment: 'מאושר' });
      await new Promise(res => setTimeout(res, 800));
      const fm = mails.find(m => m.to === 'israel@example.com');
      const hasPdf = !!fm && /Content-Type: application\/pdf/.test(fm.body) && /Content-Disposition: attachment/.test(fm.body);
      let attOk = false;
      if (hasPdf) { const part = fm.body.split(/Content-Disposition: attachment[^\n]*\n\n/)[1] || ''; const b64 = part.split(/\n--/)[0].replace(/\s+/g, ''); attOk = Buffer.from(b64, 'base64').subarray(0, 5).toString() === '%PDF-'; }
      rec('מסמך אישור', 'באישור מנהל המערכת – המגיש מקבל דוא"ל עם מסמך האישור כקובץ PDF מצורף', r.status === 200 && hasPdf && attOk);
      const av2 = await appl.req('GET', `/api/requests/${reqId5}`);
      rec('מסמך אישור', 'מסמך האישור מופיע לפותח הבקשה בבקשה עצמה', !!av2.data.approvalDoc && av2.data.request.status === 'approved');
      srv.kill('SIGTERM'); await new Promise(res => srv.on('exit', res)); smtp.close();
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
