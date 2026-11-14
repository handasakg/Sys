'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const config = require('./config');
const { db } = require('./db');
const sec = require('./security');
const auth = require('./auth');
const { readBody } = require('./uploads');
const backup = require('./backup');
const routes = require('./routes');

const PUBLIC = config.ROOT;
// כל הקבצים יושבים באותה תיקייה, ולכן מוגשים לדפדפן רק הקבצים שברשימה הזו.
// קוד השרת, .env, מסד הנתונים, הגיבויים והבדיקות לעולם לא נגישים מהרשת.
const PUBLIC_FILES = new Set(['index.html', 'app.js', 'app.css', 'app.min.js', 'app.min.css', 'favicon.svg', 'og-image.png', 'logo.png', 'sw.js',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png',
  'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'privacy.html', 'accessibility.html', '404.html', 'map.html', 'map.js', 'map.css',
  // pdf.js (Mozilla, רישיון Apache-2.0) – הצגת PDF בתוך המערכת בכל דפדפן, גם בנייד
  'pdfjs.mjs', 'pdfjs-worker.mjs', 'pdfjs-LICENSE.txt']);
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

function send(res, status, body) {
  if (res.headersSent) return;
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function isHttps(req) {
  if (req.socket.encrypted) return true;
  return config.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function selfOrigin(req) {
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
}
function originAllowed(req, origin) {
  if (!origin) return true;
  return origin === selfOrigin(req) || origin === new URL(config.publicUrl).origin || config.allowedOrigins.includes(origin);
}

// ---------- קבצים סטטיים: דחיסה, גרסאות ומטמון ----------
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.txt', '.xml', '.webmanifest', '.json']);
const staticCache = new Map();
function loadStatic(file) {
  const st = fs.statSync(file);
  const hit = staticCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  const ext = path.extname(file).toLowerCase();
  let buf = fs.readFileSync(file);
  if (ext === '.html') buf = Buffer.from(rewriteAssets(buf.toString('utf8')));
  const entry = { mtimeMs: st.mtimeMs, size: st.size, buf, ext, etag: '"' + require('node:crypto').createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"' };
  if (COMPRESSIBLE.has(ext) && buf.length > 512) {
    entry.br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    entry.gz = zlib.gzipSync(buf, { level: 9 });
  }
  staticCache.set(file, entry);
  return entry;
}
// app.js / app.css → הגרסה המוקטנת (אם עדכנית) + ?v=hash לצורך מטמון ארוך
function assetUrl(name) {
  const min = name.replace(/\.(js|css)$/, '.min.$1');
  const src = path.join(PUBLIC, name); const minFile = path.join(PUBLIC, min);
  let use = name;
  try { if (fs.statSync(minFile).mtimeMs >= fs.statSync(src).mtimeMs) use = min; } catch { /* אין גרסה מוקטנת */ }
  const hash = require('node:crypto').createHash('sha1').update(fs.readFileSync(path.join(PUBLIC, use))).digest('hex').slice(0, 10);
  return { url: `/${use}?v=${hash}`, file: use, hash };
}
function rewriteAssets(html) {
  return html.replace(/(["'])\/(app\.(?:js|css))\1/g, (m, q, name) => q + assetUrl(name).url + q);
}

function serveStatic(req, res, urlPath, query) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return false; }
  if (rel === '/') rel = '/index.html';
  const name = rel.slice(1);
  if (!PUBLIC_FILES.has(name)) return false; // רק קבצים ציבוריים מהרשימה; אין תתי-נתיבים, אין traversal
  const file = path.join(PUBLIC, name);
  let st; try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const e = loadStatic(file);
  sec.securityHeaders(res, { isHtml: true, map: name === 'map.html' });
  res.setHeader('Content-Type', STATIC_TYPES[e.ext] || 'application/octet-stream');
  res.setHeader('ETag', e.etag);
  res.setHeader('Vary', 'Accept-Encoding');
  const versioned = query.has('v') && /^(app(\.min)?\.(js|css))$/.test(path.basename(file));
  res.setHeader('Cache-Control', e.ext === '.html' || name === 'sw.js' || name === 'manifest.webmanifest' ? 'no-cache' : versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  if (name === 'sw.js') res.setHeader('Service-Worker-Allowed', '/');
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304); res.end(); return true; }
  const ae = String(req.headers['accept-encoding'] || '');
  let body = e.buf;
  if (e.br && /\bbr\b/.test(ae)) { body = e.br; res.setHeader('Content-Encoding', 'br'); }
  else if (e.gz && /\bgzip\b/.test(ae)) { body = e.gz; res.setHeader('Content-Encoding', 'gzip'); }
  res.setHeader('Content-Length', body.length);
  res.writeHead(200);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function notFound(req, res) {
  sec.securityHeaders(res, { isHtml: true });
  const page = path.join(PUBLIC, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.existsSync(page) ? fs.readFileSync(page) : 'Not found');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;

  // 1. חיוב HTTPS
  if (config.forceHttps && !isHttps(req)) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      return res.end();
    }
    return send(res, 403, { error: 'נדרש HTTPS' });
  }
  sec.securityHeaders(res);

  const isApi = p.startsWith('/api/');
  if (!isApi) {
    if (!sec.rateLimit('static:' + sec.clientIp(req), 1200, 60000).ok) return send(res, 429, { error: 'יותר מדי בקשות' });
    if (serveStatic(req, res, p, url.searchParams)) return;
    return notFound(req, res);
  }

  // 2. CORS: רק מקורות שהוגדרו במפורש. אין '*' לעולם.
  const origin = req.headers.origin;
  const originOk = originAllowed(req, origin);
  if (origin && originOk && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    if (origin && originOk && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204); return res.end();
    }
    return send(res, 403, { error: 'מקור לא מורשה' });
  }

  // 3. הגבלת קצב כללית ל-API
  const ip = sec.clientIp(req);
  const rl = sec.rateLimit('api:' + ip, 300, 60000);
  if (!rl.ok) {
    if (rl.retryAfter && !res.getHeader('Retry-After')) res.setHeader('Retry-After', rl.retryAfter);
    if (Math.random() < 0.05) sec.audit(req, 'rate_limited', { path: p }, 'warning');
    return send(res, 429, { error: 'יותר מדי בקשות, נסו שוב בעוד דקה' });
  }

  // 4. סשן
  const s = auth.loadSession(req);
  req.user = s ? s.user : null;
  req.session = s ? s.session : null;

  // 5. CSRF + בדיקת מקור לכל בקשה משנה
  const mutating = !['GET', 'HEAD'].includes(req.method);
  if (mutating) {
    if (!originOk) {
      sec.audit(req, 'csrf_origin_blocked', { origin, path: p }, 'warning');
      return send(res, 403, { error: 'מקור לא מורשה' });
    }
    if (req.session) {
      const t = String(req.headers['x-csrf-token'] || '');
      const a = Buffer.from(t); const b = Buffer.from(req.session.csrf);
      if (a.length !== b.length || !require('node:crypto').timingSafeEqual(a, b)) {
        sec.audit(req, 'csrf_token_invalid', { path: p }, 'warning');
        return send(res, 403, { error: 'אסימון אבטחה (CSRF) לא תקין. רעננו את הדף.' });
      }
    } else if (req.headers['x-requested-with'] !== 'fetch') {
      sec.audit(req, 'csrf_header_missing', { path: p }, 'warning');
      return send(res, 403, { error: 'בקשה לא תקינה' });
    }
  }

  // 6. גוף JSON
  req.body = {};
  const ctype = String(req.headers['content-type'] || '');
  if (mutating && !ctype.startsWith('multipart/form-data')) {
    const raw = await readBody(req, config.maxBodyBytes);
    if (raw.length) {
      if (!ctype.startsWith('application/json')) return send(res, 415, { error: 'Content-Type חייב להיות JSON' });
      try { req.body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'JSON לא תקין' }); }
      if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) return send(res, 400, { error: 'גוף בקשה לא תקין' });
    }
  }

  // 7. ניתוב
  const match = routes.match(req.method, p);
  if (!match) return send(res, 404, { error: 'לא נמצא' });
  req.params = match.params;
  req.query = Object.fromEntries(url.searchParams);
  const result = await match.handler(req, res);
  if (result !== undefined && !res.headersSent) send(res, result && result.__status ? result.__status : 200, result && result.__status ? result.body : result);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const status = err.status || 500;
    if (status === 403 && err.permDenied) sec.audit(req, 'permission_denied', { path: req.url, perm: err.permDenied }, 'warning');
    if (status >= 500) {
      console.error(`[error] ${req.method} ${req.url}:`, config.isProd ? err.message : err);
      sec.audit(req, 'server_error', { path: req.url, message: String(err.message).slice(0, 200) }, 'error');
    }
    // בפרודקשן לא נחשפים פרטי שגיאה / stack trace
    const msg = err.expose ? err.message : (config.isProd ? 'שגיאת שרת' : `שגיאת שרת: ${err.message}`);
    send(res, status, { error: msg });
  });
});
server.headersTimeout = 20000;
server.requestTimeout = 120000;
server.keepAliveTimeout = 5000;

// מנהל ראשון ממשתני סביבה (ADMIN_USERNAME / ADMIN_FULLNAME / ADMIN_PASSWORD) – רק כשאין עדיין אף משתמש
async function bootstrapAdmin() {
  const { ADMIN_USERNAME: un, ADMIN_FULLNAME: fn, ADMIN_PASSWORD: pw } = process.env;
  if (!un || !pw || db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return false;
  if (!/^[a-zA-Z0-9._-]{3,60}$/.test(un)) { console.error('ADMIN_USERNAME לא תקין'); return false; }
  const probs = sec.passwordProblems(pw, un);
  if (probs.length) { console.error('ADMIN_PASSWORD חלשה: ' + probs.join(', ')); return false; }
  const role = db.prepare('SELECT id FROM roles WHERE system = 1').get();
  db.prepare('INSERT INTO users (username, full_name, password_hash, role_id) VALUES (?, ?, ?, ?)').run(un, fn || un, await sec.hashPassword(pw), role.id);
  console.log(`נוצר מנהל מערכת: ${un}`);
  return true;
}

function start() {
  const cloud = require('./cloudsync');
  cloud.attach(db);
  // כל בקשה שמשנה נתונים ומצליחה → שמירת המסד לענן (מאוחדת)
  server.on('request', (req, res) => {
    if (cloud.enabled && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api/')) res.on('finish', () => { if (res.statusCode < 400) cloud.schedule(); });
  });
  return bootstrapAdmin().then((created) => {
    if (created) cloud.schedule(500);
    const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    server.listen(config.port, config.host, () => {
      console.log(`מערכת תיאום הנדסי פועלת: http://${config.host}:${config.port}  (${config.isProd ? 'production' : 'development'})`);
      if (cloud.enabled) console.log(`סנכרון ענן: ${cloud.state.restore ? cloud.state.restore.status : 'פעיל'}`);
      if (userCount === 0) console.log('אין עדיין משתמשים. צרו מנהל מערכת:  node create-admin.js  (או הגדירו ADMIN_USERNAME / ADMIN_PASSWORD)');
    });
    if (process.env.DISABLE_BACKUPS !== '1') backup.startScheduler();
    // תזכורות לגורמים שלא טיפלו בבקשה: בדיקה דקה אחרי ההפעלה ואז כל שעה (הזמנים נקבעים בהגדרות)
    if (process.env.DISABLE_REMINDERS !== '1') {
      const remind = () => { try { require('./routes').runReminders(); } catch (e) { console.error('[reminders]', e.message); } };
      setTimeout(remind, 60_000).unref(); setInterval(remind, 3_600_000).unref();
    }
    // שמירה על השרת ער: בשרת החינמי של Render השירות "נרדם" אחרי 15 דקות בלי כניסות, ואז הכניסה הבאה
    // מציגה מסך שחור של Render עד שהשרת עולה (כחצי דקה עד דקה). פנייה קצרה לכתובת הציבורית כל 10 דקות
    // נחשבת כניסה, כך שהשירות לא נרדם והאתר עולה מיד. כיבוי: KEEP_ALIVE=0
    const aliveBase = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
    if (process.env.KEEP_ALIVE !== '0' && /^https:\/\/[^\s/]+$/.test(aliveBase)) {
      const ping = async () => {
        try { const r = await fetch(aliveBase + '/api/health', { headers: { 'User-Agent': 'handasa-keepalive' }, signal: AbortSignal.timeout(20_000) }); await r.arrayBuffer(); }
        catch (e) { console.warn('[keep-alive]', e.message); }
      };
      setTimeout(ping, 90_000).unref(); setInterval(ping, 10 * 60_000).unref();
      console.log('[keep-alive] פעיל: ' + aliveBase);
    }
    // כיבוי מסודר (Render שולח SIGTERM לפני כיבוי): שמירה אחרונה לענן
    let stopping = false;
    for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => {
      if (stopping) return; stopping = true;
      server.close();
      try { await Promise.race([cloud.flush(), new Promise(r => setTimeout(r, 20000))]); } catch { /* */ }
      process.exit(0);
    });
  });
}

module.exports = { server, start };
