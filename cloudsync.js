'use strict';
// סנכרון לענן (Supabase Storage, דלי פרטי) – לאחסון שהדיסק שלו נמחק (למשל Render בחינם).
// • בהפעלה: משחזר את מסד הנתונים מהענן לפני שהשרת נפתח.
// • אחרי כל שינוי: שומר עותק של המסד לענן (כמה שניות אחרי, מאוחד), ועותק יומי נוסף לגיבוי.
// • קבצים מצורפים ולוגו: עולים לענן מיד בהעלאה, ונמשכים מהענן כשצריך אותם.
// פעיל רק כשמוגדרים SUPABASE_URL + SUPABASE_SERVICE_KEY. המפתח נשאר בשרת בלבד.
const fs = require('node:fs');
const path = require('node:path');

// מקבל כל צורה נפוצה: כתובת מלאה, כתובת בלי https, או רק קוד הפרויקט (למשל abcdefghijklmnopqrst)
function normalizeUrl(raw) {
  let v = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return '';
  if (/^[a-z0-9]{15,40}$/i.test(v)) v = `https://${v.toLowerCase()}.supabase.co`;
  else if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  v = v.replace(/\/(rest|storage|auth)\/v1.*$/i, '').replace(/\/+$/, '');
  try { const u = new URL(v); return u.origin; } catch { return ''; }
}
const URL_ = normalizeUrl(process.env.SUPABASE_URL);
if (process.env.SUPABASE_URL && !URL_) console.error('[cloud] SUPABASE_URL לא תקין. דוגמה תקינה: https://abcdefghijklmnopqrst.supabase.co');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'handasa';
const enabled = !!(URL_ && KEY);
if (URL_ && !KEY) console.error('[cloud] חסר SUPABASE_SERVICE_KEY – הסנכרון לענן כבוי');

const state = { enabled, bucket: BUCKET, restore: null, lastSync: null, lastError: null, pending: false, blocked: false };

function headers(extra = {}) {
  const h = { apikey: KEY, ...extra };
  // מפתח service_role ישן הוא JWT ונשלח גם כ-Bearer; מפתח sb_secret_ חדש נשלח ב-apikey בלבד
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}
const objUrl = (key) => `${URL_}/storage/v1/object/${encodeURIComponent(BUCKET)}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function request(method, url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method, ...opts, signal: AbortSignal.timeout(30000) });
      if (res.status >= 500 || res.status === 429) { last = new Error(`Supabase ${res.status}`); await new Promise(r => setTimeout(r, 800 * (i + 1))); continue; }
      return res;
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
  throw last;
}

// הודעות שגיאה ברורות לטעויות הגדרה נפוצות. "קובץ לא קיים" מחזיר null (לא שגיאה)
function explain(status, text, what) {
  if (/bucket.{0,10}not.?found/i.test(text)) return new Error(`הדלי "${BUCKET}" לא קיים ב-Supabase. צרו ב-Storage דלי פרטי בשם ${BUCKET} (או תקנו את SUPABASE_BUCKET).`);
  if (status === 401 || status === 403 || /invalid.{0,20}(jwt|key|signature)|unauthorized/i.test(text)) return new Error('המפתח ב-SUPABASE_SERVICE_KEY שגוי או חסר הרשאה. השתמשו במפתח ה-secret (או service_role), לא ב-anon/publishable.');
  return new Error(`${what} נכשלה (${status}): ${text}`);
}
async function put(key, buf, contentType = 'application/octet-stream') {
  const res = await request('POST', objUrl(key), { headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'no-store' }), body: buf });
  if (!res.ok) throw explain(res.status, (await res.text()).slice(0, 200), 'העלאה לענן');
}
// מחזיר Buffer, null אם הקובץ לא קיים, או זורק שגיאה
async function get(key) {
  const res = await request('GET', objUrl(key), { headers: headers() });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  const text = (await res.text()).slice(0, 200);
  if (!/bucket/i.test(text) && (res.status === 404 || (res.status === 400 && /object.?not.?found|not_found/i.test(text)))) return null;
  throw explain(res.status, text, 'קריאה מהענן');
}
async function del(keys) {
  if (!keys.length) return;
  const res = await request('DELETE', `${URL_}/storage/v1/object/${encodeURIComponent(BUCKET)}`, { headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: keys }) });
  if (!res.ok && res.status !== 404) throw new Error(`מחיקה מהענן נכשלה (${res.status})`);
}

// ---------- שחזור בהפעלה (לפני פתיחת המסד) ----------
async function restoreDb(dbFile) {
  if (!enabled) return { status: 'disabled' };
  try {
    const buf = await get('db/app.sqlite');
    if (!buf) { state.restore = { status: 'empty', at: new Date().toISOString() }; return state.restore; } // הפעלה ראשונה – אין עדיין עותק
    if (buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') throw new Error('העותק בענן אינו מסד SQLite תקין');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true, mode: 0o700 });
    const tmp = dbFile + '.restore';
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
    fs.renameSync(tmp, dbFile);
    state.restore = { status: 'restored', at: new Date().toISOString(), size: buf.length };
    return state.restore;
  } catch (e) {
    // לא מצליחים לקרוא מהענן (למשל פרויקט Supabase מושהה): לא שומרים כלום לענן, כדי לא לדרוס את העותק הטוב במסד ריק
    state.blocked = true; state.lastError = { at: new Date().toISOString(), message: e.message };
    state.restore = { status: 'error', at: new Date().toISOString(), message: e.message };
    console.error('[cloud] שחזור נכשל – הסנכרון לענן מושבת עד הפעלה מחדש:', e.message);
    return state.restore;
  }
}

// ---------- שמירת המסד לענן ----------
let db = null; let timer = null; let firstPendingAt = 0; let running = null; let lastDaily = '';
function attach(database) { db = database; }
async function syncNow(reason = 'change') {
  if (!enabled || state.blocked || !db) return null;
  if (running) { await running; }
  running = (async () => {
    const sqlite = require('node:sqlite');
    const tmp = path.join(require('node:os').tmpdir(), `handasa-sync-${process.pid}.sqlite`);
    try {
      state.pending = false; firstPendingAt = 0;
      await sqlite.backup(db, tmp);
      const buf = fs.readFileSync(tmp);
      await put('db/app.sqlite', buf, 'application/vnd.sqlite3');
      const day = new Date().toISOString().slice(0, 10);
      if (day !== lastDaily) { await put(`db/daily/${day}.sqlite`, buf, 'application/vnd.sqlite3'); lastDaily = day; }
      state.lastSync = { at: new Date().toISOString(), size: buf.length, reason }; state.lastError = null;
    } catch (e) {
      state.pending = true; state.lastError = { at: new Date().toISOString(), message: e.message };
      console.error('[cloud] שמירה לענן נכשלה:', e.message);
      schedule(15000);
    } finally { fs.rmSync(tmp, { force: true }); running = null; }
  })();
  return running;
}
// מאחד שינויים רצופים: שומר 3 שניות אחרי השינוי האחרון, ולכל היותר 20 שניות אחרי הראשון
function schedule(delay = 3000) {
  if (!enabled || state.blocked) return;
  state.pending = true;
  const now = Date.now(); if (!firstPendingAt) firstPendingAt = now;
  const wait = Math.max(0, Math.min(delay, firstPendingAt + 20000 - now));
  clearTimeout(timer); timer = setTimeout(() => syncNow(), wait);
}
async function flush() { clearTimeout(timer); if (state.pending || running) await syncNow('shutdown'); }

// ---------- קבצים ----------
async function putFile(key, buf, type) { if (enabled && !state.blocked) await put(key, buf, type); }
// אם הקובץ חסר בדיסק המקומי – מביא אותו מהענן ושומר עותק מקומי
async function ensureLocal(key, localPath) {
  if (fs.existsSync(localPath)) return true;
  if (!enabled) return false;
  const buf = await get(key);
  if (!buf) return false;
  fs.mkdirSync(path.dirname(localPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(localPath, buf, { mode: 0o600 });
  return true;
}
function deleteFiles(keys) { if (enabled && !state.blocked) del(keys).catch(e => console.error('[cloud]', e.message)); }

module.exports = { normalizeUrl, enabled, state, restoreDb, attach, schedule, syncNow, flush, putFile, ensureLocal, deleteFiles };
