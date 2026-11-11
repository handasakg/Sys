'use strict';
// בדיקות דפדפן אמיתי (Chrome + Playwright): מובייל, נגישות, ניגודיות, מקלדת, חלונות, XSS, טפסים, קישורים, ביצועים.
// דורש playwright מותקן (לא תלות של המערכת עצמה). תוצאות וצילומי מסך נשמרים בתיקייה הזמנית של המערכת
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');

const ROOT = __dirname;
const SHOTS = path.join(os.tmpdir(), 'coord-shots'); fs.mkdirSync(SHOTS, { recursive: true });
let engPwOut = ''; let chainNames = [];
const out = { checks: [], mobile: [], contrast: [], a11y: [], links: [], perf: {} };
const rec = (area, name, pass, detail = '') => { out.checks.push({ area, name, pass, detail: String(detail).slice(0, 400) }); console.log(`${pass ? 'PASS' : 'FAIL'} [${area}] ${name}${detail ? ' – ' + String(detail).slice(0, 200) : ''}`); };
const pw = () => 'Br' + crypto.randomBytes(9).toString('base64url') + '9x';

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-br-'));
  const env = { ...process.env, NODE_ENV: 'production', FORCE_HTTPS: '0', DISABLE_BACKUPS: '1', PORT: '4811', DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'u'), BACKUP_DIR: path.join(dataDir, 'b'), LOG_DIR: path.join(dataDir, 'l') };
  const base = 'http://127.0.0.1:4811';
  const adminPw = pw();
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'create-admin.js'], { cwd: ROOT, env: { ...env, ADMIN_USERNAME: 'chief', ADMIN_FULLNAME: 'דנה לוי', ADMIN_PASSWORD: adminPw } });
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'start.js'], { cwd: ROOT, env });
  await new Promise(r => srv.stdout.on('data', d => String(d).includes('פועלת') && r()));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  try {
    // ---------- נתוני הדגמה דרך ה-API ----------
    const ctx0 = await browser.newContext(); const api = ctx0.request;
    let csrf = (await (await api.post(base + '/api/auth/login', { headers: { 'X-Requested-With': 'fetch' }, data: { username: 'chief', password: adminPw } })).json()).csrf;
    const call = async (m, u, d) => { const r = await api.fetch(base + u, { method: m, headers: { 'X-Requested-With': 'fetch', 'X-CSRF-Token': csrf }, data: d }); return r.json(); };
    const roles = (await call('GET', '/api/admin/roles')).items; const rid = n => roles.find(r => r.name === n).id;
    const engPw = pw(); engPwOut = engPw; const eng = await call('POST', '/api/admin/users', { username: 'yossi', full_name: 'יוסי כהן', role_id: rid('מהנדס / מאשר'), password: engPw, department: 'מינהל הנדסה', no_infra: true, no_request: true });
    const reqs = [];
    for (const [type, title, addr] of [['planning', 'תיאום תכנון להנחת קו מים 8"', 'רחוב הורדים 12'], ['execution', 'אישור חפירה להעתקת כבל חשמל', 'שדרות ירושלים 40'], ['completion', 'אישור גמר עבודה – תשתית תקשורת', 'רחוב הגפן 3'], ['execution', '<img src=x onerror=alert(1)> בדיקת XSS', '"><script>alert(2)</script>']]) {
      // בקשות נפתחות רק מהגשה באתר; לנתוני ההדגמה יוצרים אותן ישירות במסד
      const sdb = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'app.db'));
      const chiefId = sdb.prepare("SELECT id FROM users WHERE username = 'chief'").get().id;
      const info = sdb.prepare(`INSERT INTO requests (number, type, title, description, address, project_name, applicant_id, status, track, track_status, planned_start, planned_end, submitted_at, due_at)
        VALUES (?,?,?,?,?,?,?,'submitted',?,?,'2026-11-15','2027-01-20',datetime('now'),datetime('now','+14 days'))`)
        .run(`TH-2026-${String(reqs.length + 1).padStart(4, '0')}`, type, title, 'פירוט העבודה המתוכננת לצורך בדיקה.', addr, 'שדרוג קווי מים – שכונת הפרחים', chiefId,
          type === 'execution' ? 'fast' : 'regular', type === 'execution' ? 'pending' : 'none');
      sdb.close(); reqs.push(Number(info.lastInsertRowid));
    }
    await call('POST', `/api/requests/${reqs[0]}/assign`, { assignee_id: eng.id });
    await call('POST', `/api/requests/${reqs[0]}/status`, { status: 'review' });
    const infra = (await call('GET', '/api/infra')).items;
    await call('POST', `/api/requests/${reqs[0]}/approvals`, { infra_body_ids: infra.slice(0, 4).map(b => b.id) });
    await call('POST', `/api/requests/${reqs[0]}/status`, { status: 'coordination' });
    await call('PUT', '/api/admin/settings', { govmap_token: 'test-token' });
    await call('PUT', `/api/admin/infra/${infra[0].id}`, { contact_user_id: eng.id });
    const types0 = (await call('GET', '/api/admin/request-types')).items;
    await call('PUT', `/api/admin/request-types/${types0[0].id}`, { infra_chain: [infra[1].id, infra[0].id] });
    chainNames = [infra[1].name, infra[0].name];
    await call('POST', '/api/tasks', { title: 'סיור שטח עם נציג התאגיד', request_id: reqs[0], infra_body_id: infra[0].id, priority: 'גבוהה', start_date: '2026-11-12', due_date: '2026-11-20' });
    await ctx0.close();

    // ---------- מובייל + מסכים ----------
    const PAGES = ['#/', '#/requests?scope=all', `#/requests/${reqs[0]}`, `#/requests/${reqs[1]}/edit`, '#/tasks', '#/reports', '#/documents', '#/appearance', '#/account', '#/admin/users', '#/admin/roles', '#/admin/types', '#/admin/settings', '#/admin/audit', '#/admin/backups'];
    const consoleErrors = []; let xssFired = false;
    async function login(page) {
      await page.goto(base + '/'); await page.fill('input[name=username]', 'chief'); await page.fill('input[name=password]', adminPw);
      await page.click('button[type=submit]'); await page.waitForSelector('.sidebar');
    }
    async function measure(page, label, vw) {
      const r = await page.evaluate(() => {
        const sw = document.documentElement.scrollWidth; const iw = window.innerWidth;
        const small = [];
        for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=tab], summary')) {
          const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
          if (el.closest('p, li .note, .doc-page, .side-foot, .footer, dd') && el.tagName === 'A') continue; // קישורים בתוך טקסט פטורים (WCAG 2.5.8)
          if (el.classList.contains('sr-only') || (el.type === 'file')) continue;
          if (b.height < 24 || b.width < 24) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 20)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
        return { overflow: sw > iw + 1 ? sw - iw : 0, small };
      });
      out.mobile.push({ page: label, vw, ...r });
      return r;
    }
    for (const vw of [360, 390, 768]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 768 ? 1024 : 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: vw < 768 });
      const page = await ctx.newPage();
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${vw}: ${m.text()}`); });
      page.on('pageerror', e => consoleErrors.push(`${vw}: ${e.message}`));
      page.on('dialog', d => { xssFired = true; d.dismiss(); });
      await page.goto(base + '/'); await page.waitForSelector('form');
      await measure(page, 'login', vw); await page.screenshot({ path: path.join(SHOTS, `login-${vw}.png`), fullPage: true });
      for (const sp of ['/privacy.html', '/accessibility.html', '/nope-404']) { await page.goto(base + sp); await measure(page, sp, vw); }
      await login(page);
      for (const p of PAGES) {
        await page.goto(base + '/' + p); await page.waitForTimeout(350);
        await measure(page, p, vw);
        if (['#/', `#/requests/${reqs[0]}`, '#/requests?scope=all', '#/appearance'].includes(p)) await page.screenshot({ path: path.join(SHOTS, `${p.replace(/[^a-z0-9]/gi, '_')}-${vw}.png`), fullPage: true });
      }
      // תפריט נפתח במובייל
      if (vw < 820) {
        await page.click('.menu-btn'); await page.waitForTimeout(250);
        const open = await page.evaluate(() => document.querySelector('.sidebar').classList.contains('open') && document.activeElement.closest('.sidebar') !== null);
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        const closed = await page.evaluate(() => !document.querySelector('.sidebar').classList.contains('open'));
        if (vw === 360) rec('מובייל', 'תפריט המבורגר נפתח, מעביר פוקוס ונסגר ב-Esc', open && closed);
      }
      await ctx.close();
    }
    const overflow = out.mobile.filter(m => m.overflow);
    rec('מובייל', 'אין גלילה לצדדים ב-360/390/768 (22 מסכים × 3 רוחבים)', overflow.length === 0, overflow.map(m => `${m.page}@${m.vw}:+${m.overflow}px`).join(', '));
    const small = [...new Set(out.mobile.flatMap(m => m.small.map(s => `${m.page}@${m.vw}: ${s}`)))];
    rec('מובייל', 'כל היעדים ללחיצה לפחות 24×24 (WCAG 2.5.8)', small.length === 0, small.slice(0, 6).join(' | '));
    rec('XSS', 'קוד זדוני בכותרת/כתובת של בקשה לא רץ בדפדפן', !xssFired);

    // ---------- דסקטופ: ניגודיות בכל ערכות הנושא, נגישות ----------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', d => { xssFired = true; d.dismiss(); });
    const csp = []; page.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) csp.push(m.text()); if (m.type() === 'error') consoleErrors.push('1280: ' + m.text()); });
    // ברירת מחדל חדשה + זכור אותי
    await page.goto(base + '/'); await page.waitForSelector('form');
    const def = await page.evaluate(() => { const d = document.documentElement.dataset; return `${d.theme}/${d.bg}/${d.style}/${d.shape}/${d.sidebar}`; });
    rec('עיצוב', 'ברירת המחדל: אוקיינוס בהיר, רקע זוהר נע, כרטיסי זכוכית, פינות מעוגלות, תפריט צף', def === 'ocean/aurora/glass/soft/floating' && await page.evaluate(() => document.documentElement.dataset.mode) === 'light', def);
    const rememberBox = await page.evaluate(() => { const c = document.querySelector('input[name=remember]'); return c && c.type === 'checkbox' && !!c.closest('label') && c.getBoundingClientRect().width >= 24; });
    rec('זכור אותי', 'במסך הכניסה יש תיבת "זכור אותי" עם תווית והסבר', !!rememberBox);
    const lg = await page.evaluate(() => {
      const logo = document.querySelector('.auth-form .auth-logo'); const h2 = document.querySelector('.auth-form h2');
      const flow = document.querySelectorAll('.auth-art svg.auth-flow .af-flow');
      return { aboveHeading: !!logo && !!h2 && logo.getBoundingClientRect().bottom <= h2.getBoundingClientRect().top, size: logo ? Math.round(logo.getBoundingClientRect().height) : 0,
        inArt: !!document.querySelector('.auth-art img'), flows: flow.length, anim: flow.length ? getComputedStyle(flow[0]).animationName : '', dots: getComputedStyle(document.querySelector('.auth-art'), '::before').content };
    });
    rec('מסך כניסה', 'הלוגו מעל "כניסה למערכת", גדול (80px ומעלה) ולא בפאנל הכחול', lg.aboveHeading && lg.size >= 80 && !lg.inArt, JSON.stringify(lg));
    rec('מסך כניסה', 'רקע כחול מונפש עם קווי תשתית זורמים, בלי רשת הנקודות', lg.flows === 5 && lg.anim === 'af-flow' && (lg.dots === 'none' || lg.dots === 'normal'), `${lg.flows} קווים, ${lg.anim}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOTS, 'login-default-1280.png') });
    // מקלדת במסך כניסה
    await page.goto(base + '/'); await page.waitForSelector('form');
    await page.keyboard.press('Tab');
    const firstFocus = await page.evaluate(() => ({ text: document.activeElement.textContent.trim(), cls: document.activeElement.className, outline: getComputedStyle(document.activeElement).outlineStyle, top: document.activeElement.getBoundingClientRect().top }));
    rec('נגישות', 'Tab ראשון = "דילוג לתוכן הראשי", גלוי עם מסגרת פוקוס', firstFocus.cls === 'skip' && firstFocus.top >= 0 && firstFocus.outline !== 'none', JSON.stringify(firstFocus));
    const tabOrder = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); tabOrder.push(await page.evaluate(() => { const a = document.activeElement; return `${a.tagName}${a.name ? '[' + a.name + ']' : ''}:${getComputedStyle(a).outlineStyle}`; })); }
    rec('נגישות', 'כל רכיבי מסך הכניסה נגישים במקלדת עם פוקוס נראה', tabOrder.every(t => !t.endsWith(':none')), tabOrder.join(' → '));
    // שגיאת טופס נכנסת
    await page.fill('input[name=username]', 'chief'); await page.fill('input[name=password]', 'wrong-pass-1');
    await page.click('button[type=submit]'); await page.waitForSelector('.form-error:not([hidden])');
    const errTxt = await page.textContent('.form-error');
    rec('טפסים', 'כניסה שגויה מציגה שגיאה (role=alert) ולא מאפסת את שם המשתמש', /שגויים/.test(errTxt) && await page.inputValue('input[name=username]') === 'chief', errTxt);
    await page.click('button[type=submit]'); await page.waitForSelector('.form-error:not([hidden])');
    const emptyErr = await page.evaluate(() => ({ t: document.querySelector('.form-error').textContent, inv: document.querySelector('input[name=password]').getAttribute('aria-invalid') }));
    rec('טפסים', 'שדה חובה ריק מסומן aria-invalid עם הודעה בטקסט', emptyErr.inv === 'true', emptyErr.t);
    await page.fill('input[name=password]', adminPw); await page.click('button[type=submit]'); await page.waitForSelector('.sidebar');

    // נגישות מבנית בכל המסכים
    for (const p of PAGES) {
      await page.goto(base + '/' + p); await page.waitForTimeout(300);
      const a = await page.evaluate(() => {
        const issues = [];
        if (document.documentElement.lang !== 'he' || document.documentElement.dir !== 'rtl') issues.push('lang/dir');
        if (document.querySelectorAll('h1').length !== 1) issues.push('h1 count ' + document.querySelectorAll('h1').length);
        for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea')) {
          const id = el.id; const lab = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (!lab && !el.getAttribute('aria-label') && !el.closest('label')) issues.push(`no label: ${el.name}`);
        }
        for (const el of document.querySelectorAll('button, a[href]')) if (!(el.textContent.trim() || el.getAttribute('aria-label') || el.getAttribute('title'))) issues.push(`no name: ${el.outerHTML.slice(0, 60)}`);
        for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) issues.push('img no alt');
        const ids = [...document.querySelectorAll('[id]')].map(e => e.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) issues.push('dup ids ' + dup.join(','));
        if (!document.title || document.title.length < 5) issues.push('title');
        return issues;
      });
      if (a.length) out.a11y.push({ page: p, issues: a });
    }
    rec('נגישות', 'תוויות לשדות, שמות לכפתורים, alt לתמונות, h1 יחיד, lang=he בכל 18 המסכים', out.a11y.length === 0, out.a11y.map(x => `${x.page}: ${x.issues.join(';')}`).join(' | '));

    // ניגודיות
    const themes = [['drafting', 'light'], ['drafting', 'dark'], ['concrete', 'light'], ['concrete', 'dark'], ['sand', 'light'], ['sand', 'dark'], ['ocean', 'light'], ['ocean', 'dark'], ['aurora', 'light'], ['aurora', 'dark'], ['night', 'dark'], ['graphite', 'dark'], ['ocean', 'light', 'glass', 'aurora'], ['ocean', 'dark', 'glass', 'aurora'], ['aurora', 'light', 'glass', 'aurora'], ['aurora', 'dark', 'glass', 'aurora'], ['ocean', 'light', 'raised', 'gradient'], ['concrete', 'light', 'outline', 'plain']];
    const contrastFn = () => {
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
      function bgOf(el) {
        const stack = []; let e = el;
        while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) stack.push(c); if (c && c.a === 1) break; e = e.parentElement; }
        let bg = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) bg = blend(c, bg); return bg;
      }
      const fails = []; let checked = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) {
        const t = walker.currentNode; if (!t.textContent.trim()) continue;
        const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden], .sr-only, svg, [aria-hidden=true], dialog:not([open])')) continue;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (el.closest('.btn[disabled], input[disabled], select[disabled]')) continue;
        const fg = parse(cs.color); if (!fg) continue;
        const bg = bgOf(el); const fgc = fg.a < 1 ? blend(fg, bg) : fg;
        const L1 = lum(fgc), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
        const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5; checked++;
        if (ratio < need) fails.push(`"${t.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}<${need}`);
      }
      return { checked, fails: [...new Set(fails)] };
    };
    for (const [theme, mode, style = 'flat', bg = 'plain'] of themes) {
      const setT = ([t, m, st, b]) => { const r = document.documentElement; r.dataset.theme = t; r.dataset.mode = m; r.dataset.style = st; r.dataset.bg = b; r.dataset.chartAnim = 'off'; };
      let total = 0; const fails = [];
      for (const p of ['#/', '#/reports', '#/requests?scope=all', `#/requests/${reqs[0]}`, '#/tasks', '#/admin/users', '#/admin/audit', '#/appearance']) {
        await page.goto(base + '/' + p); await page.waitForTimeout(350);
        await page.evaluate(setT, [theme, mode, style, bg]);
        await page.waitForTimeout(80);
        const c = await page.evaluate(contrastFn); total += c.checked; fails.push(...c.fails.map(f => `${p}: ${f}`));
      }
      out.contrast.push({ theme: `${theme}/${style}/${bg}`, mode, checked: total, fails: [...new Set(fails)] });
      if (style === 'glass' || theme === 'graphite') { await page.goto(base + '/#/reports'); await page.waitForTimeout(400); await page.evaluate(setT, [theme, mode, style, bg]); await page.waitForTimeout(150); await page.screenshot({ path: path.join(SHOTS, `theme-${theme}-${mode}-${style}.png`), fullPage: true }); }
    }
    const cf = out.contrast.filter(c => c.fails.length);
    rec('נגישות', 'ניגודיות AA (4.5:1 / 3:1) בכל 12 ערכות הצבע + 6 שילובי סגנון/רקע (כולל ברירת המחדל החדשה) (8 מסכים כל אחד)', cf.length === 0, cf.map(c => `${c.theme}/${c.mode}: ${c.fails.length} – ${c.fails.slice(0, 3).join('; ')}`).join(' | '));
    for (const p of ['/privacy.html', '/accessibility.html', '/nope-404']) {
      await page.goto(base + p); const c = await page.evaluate(contrastFn);
      if (c.fails.length) out.contrast.push({ theme: 'static', page: p, fails: c.fails });
    }
    rec('נגישות', 'ניגודיות בעמודי פרטיות, נגישות ו-404', !out.contrast.some(c => c.theme === 'static'), out.contrast.filter(c => c.theme === 'static').map(c => c.page + ': ' + c.fails.join(';')).join(' | '));

    // גרפים: נגישות וטולטיפ במקלדת
    await page.goto(base + '/#/reports'); await page.waitForSelector('figure.chart svg');
    await page.evaluate(() => { const r = document.documentElement; r.dataset.theme = 'drafting'; r.dataset.mode = 'light'; r.dataset.style = 'flat'; r.dataset.bg = 'plain'; });
    const charts = await page.evaluate(() => [...document.querySelectorAll('figure.chart')].map(f => ({ t: f.querySelector('h3').textContent, img: !!f.querySelector('svg[role=img][aria-label]') || !!f.querySelector('.chart-empty'), tbl: !!f.querySelector('table') || !!f.querySelector('.chart-empty') })));
    rec('גרפים', `${charts.length} גרפים בעמוד הדוחות, לכל אחד role=img + תיאור + תצוגת טבלה`, charts.length >= 6 && charts.every(c => c.img && c.tbl), charts.map(c => c.t).join(' | '));
    await page.locator('figure.chart [data-tip][tabindex="0"]').first().focus();
    const tipShown = await page.evaluate(() => { const t = document.querySelector('.chart-tip:not([hidden])'); return t ? t.textContent : null; });
    rec('גרפים', 'טולטיפ מופיע גם בניווט מקלדת (Tab), לא רק בעכבר', !!tipShown, tipShown);
    const tbtn = page.locator('figure.chart .chart-head button[aria-expanded]').first(); await tbtn.click();
    rec('גרפים', 'כפתור "הצגה כטבלה" פותח טבלת נתונים (aria-expanded)', await tbtn.getAttribute('aria-expanded') === 'true' && await page.locator('figure.chart .tbl-wrap:not([hidden]) table').count() > 0);
    await page.goto(base + '/#/appearance'); await page.waitForSelector('.preset');
    await page.click('.preset:has-text("מודרני")'); await page.waitForTimeout(200);
    const modern = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, b: document.documentElement.dataset.bg, st: document.documentElement.dataset.style, sb: document.documentElement.dataset.sidebar }));
    rec('עיצוב', 'ערכה מוכנה "מודרני" מחילה ערכת צבעים, רקע, סגנון ותפריט צף בבת אחת', modern.t === 'aurora' && modern.b === 'aurora' && modern.st === 'glass' && modern.sb === 'floating', JSON.stringify(modern));
    await page.screenshot({ path: path.join(SHOTS, 'appearance-modern-1280.png'), fullPage: true });
    await page.fill('#accent-pick', '#ffee00'); await page.waitForTimeout(150);
    const acc = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { a: cs.getPropertyValue('--accent').trim(), s: cs.getPropertyValue('--surface').trim(), msg: document.querySelector('[role=status][aria-live=polite]').textContent }; });
    const lum = (hx) => { const n = parseInt(hx.replace('#', ''), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    rec('עיצוב', 'צבע אישי בהיר מדי (צהוב) מתוקן אוטומטית לניגודיות קריאה', cr(acc.a, acc.s) >= 4.5 && /הוכהה/.test(acc.msg), `${acc.a} על ${acc.s} = ${cr(acc.a, acc.s).toFixed(2)}:1`);
    await page.click('text=ביטול השינויים');

    // גורמי תשתית בלשונית בתפקידים והרשאות
    await page.goto(base + '/#/admin/roles?tab=infra'); await page.waitForSelector('[role=tab][aria-selected=true]');
    const tabName = await page.textContent('[role=tab][aria-selected=true]');
    await page.click('.approval .btn:has-text("עריכה")'); await page.waitForSelector('dialog[open]');
    await page.fill('dialog[open] input[name=contact]', '08-6000000'); await page.click('dialog[open] .dlg-foot .btn.primary'); await page.waitForTimeout(400);
    rec('גורמי תשתית', 'לשונית "גורמי תשתית" בתוך תפקידים והרשאות: עריכה ושמירה', tabName === 'גורמי תשתית' && (await page.textContent('main')).includes('08-6000000'));
    // לוגו: העלאה מהממשק ← מופיע בתפריט ובמסך הכניסה
    await page.goto(base + '/#/admin/settings'); await page.waitForSelector('#logo-file', { state: 'attached' });
    const fs2 = require('node:fs');
    await page.setInputFiles('#logo-file', { name: 'logo.png', mimeType: 'image/png', buffer: fs2.readFileSync(path.join(ROOT, 'og-image.png')).length > 1048576 ? Buffer.alloc(1) : fs2.readFileSync(path.join(ROOT, 'og-image.png')) });
    await page.waitForSelector('.brand-mark.custom');
    const ctxL = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const pl = await ctxL.newPage();
    await pl.goto(base + '/'); await pl.waitForSelector('.auth-logo');
    const lsrc = await pl.getAttribute('.auth-logo', 'src'); const lok = await pl.evaluate(() => document.querySelector('.auth-logo').naturalWidth > 0);
    rec('לוגו', 'לוגו שהועלה מהגדרות מופיע בתפריט הצד ובמסך הכניסה', lsrc.startsWith('/api/logo?v=') && lok, lsrc);
    await pl.screenshot({ path: path.join(SHOTS, 'login-logo-1280.png') }); await ctxL.close();
    page.once('dialog', d => d.accept());
    await page.click('text=חזרה ללוגו ברירת המחדל'); await page.click('dialog[open] .btn.danger'); await page.waitForTimeout(400);

    // פס עליון: כרטיס משתמש, שעון, לוגו לדף הבית, "דף הבית"
    await page.goto(base + '/#/admin/users'); await page.waitForSelector('.user-card');
    const top = await page.evaluate(() => ({ card: document.querySelector('.user-card').textContent, clock: document.querySelector('time.clock').getAttribute('aria-label'),
      nav: document.querySelector('.nav a[href="#/"]').textContent, border: getComputedStyle(document.querySelector('.user-card')).borderTopWidth }));
    await page.click('a.brand'); await page.waitForTimeout(400);
    const home = await page.evaluate(() => location.hash === '#/' && document.querySelector('.nav a[href="#/"]').getAttribute('aria-current') === 'page');
    rec('פס עליון', 'השם במסגרת עם תפקיד, שעון ותאריך, לחיצה על הלוגו מחזירה לדף הבית, ו"דף הבית" בתפריט',
      top.card.includes('דנה לוי') && top.card.includes('מנהל מערכת') && /השעה \d{2}:\d{2}/.test(top.clock) && top.nav === 'דף הבית' && top.border === '2px' && home, JSON.stringify(top));
    await page.screenshot({ path: path.join(SHOTS, 'topbar-1280.png'), clip: { x: 0, y: 0, width: 1280, height: 140 } });

    // משתמש חדש: שדות חובה
    await page.goto(base + '/#/admin/users'); await page.waitForSelector('h1');
    await page.click('.page-head .btn.primary'); await page.waitForSelector('dialog[open]');
    await page.fill('dialog[open] input[name=full_name]', 'בדיקה'); await page.fill('dialog[open] input[name=username]', 'ui.test'); await page.fill('dialog[open] input[name=password]', 'Abcdef123456xyz');
    await page.click('dialog[open] .dlg-foot .btn.primary'); await page.waitForTimeout(200);
    const err1 = await page.textContent('dialog[open] .form-error');
    await page.selectOption('dialog[open] select[name=role_id]', { index: 1 }); await page.selectOption('dialog[open] select[name=infra_choice]', 'none');
    await page.click('dialog[open] .dlg-foot .btn.primary'); await page.waitForTimeout(200);
    const err2 = await page.textContent('dialog[open] .form-error');
    await page.check('dialog[open] .req-pick-list input >> nth=0');
    await page.click('dialog[open] .dlg-foot .btn.primary'); await page.waitForTimeout(500);
    const saved = await page.evaluate(() => !document.querySelector('dialog[open]') && document.querySelector('main').textContent.includes('ui.test'));
    rec('משתמש חדש', 'בטופס משתמש חדש: תפקיד, גורם תשתית ושיוך לבקשה חובה; עם הבחירות – נשמר', /שדה|נא/.test(err1) && /לשייך/.test(err2) && saved, `${err1} | ${err2}`);
    await page.goto(base + '/'); await page.waitForSelector('.sidebar');

    // חלון קופץ: פוקוס, Esc, החזרת פוקוס
    await page.goto(base + '/#/admin/users'); await page.waitForSelector('h1');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'drafting'; document.documentElement.dataset.mode = 'light'; });
    const opener = page.locator('.page-head .btn.primary'); await opener.focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('dialog[open]');
    const inDlg = await page.evaluate(() => !!document.activeElement.closest('dialog[open]'));
    const labelled = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); return !!document.getElementById(d.getAttribute('aria-labelledby')); });
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    const trapped = await page.evaluate(() => !!document.activeElement.closest('dialog[open]') || document.activeElement === document.body);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    const closedBack = await page.evaluate(() => !document.querySelector('dialog[open]') && document.activeElement.classList.contains('primary'));
    rec('נגישות', 'חלון קופץ: פוקוס נכנס, נשאר בפנים, נסגר ב-Esc ומחזיר פוקוס', inDlg && labelled && trapped && closedBack, JSON.stringify({ inDlg, labelled, trapped, closedBack }));

    // XSS בדסקטופ + בתצוגת רשימה
    await page.goto(base + `/#/requests/${reqs[3]}`); await page.waitForSelector('.req-title');
    const shown = await page.textContent('.req-title');
    await page.goto(base + '/#/requests?scope=all'); await page.waitForTimeout(300);
    const injected = await page.evaluate(() => document.querySelectorAll('main img[src="x"], main script').length);
    rec('XSS', 'מטען XSS מוצג כטקסט ולא נוצרים תגים בדף', !xssFired && shown.includes('<img src=x') && injected === 0, shown);
    rec('XSS', 'אין הפרות CSP בזמן ריצה (אין קוד inline)', csp.length === 0, csp.slice(0, 2).join(' | '));

    // טפסים: שליחה אמיתית + כישלון רשת
    const editUrl = `/#/requests/${reqs[1]}/edit`; const isPut = (r) => /\/api\/requests\/\d+$/.test(r.url()) && r.request().method() === 'PUT';
    await page.goto(base + editUrl); await page.waitForSelector('form input[name=title]');
    await page.fill('input[name=title]', 'בדיקת שליחת טופס מהדפדפן');
    const [resp] = await Promise.all([page.waitForResponse(isPut), page.click('button[value=save]')]);
    await page.waitForSelector('.req-number');
    rec('טפסים', 'טופס עריכת בקשה נשלח לשרת ונשמר (200) ומחזיר לבקשה', resp.status() === 200 && (await page.textContent('.req-title')).includes('בדיקת שליחת טופס'), await page.textContent('.req-number'));
    await page.goto(base + editUrl); await page.waitForSelector('form input[name=title]');
    await page.route('**/api/requests/*', r => r.request().method() === 'PUT' ? r.abort('internetdisconnected') : r.continue());
    await page.fill('input[name=title]', 'נפילת רשת');
    await page.click('button[value=save]'); await page.waitForSelector('.form-error:not([hidden])');
    rec('טפסים', 'כשהשליחה נכשלת (אין רשת) מוצגת שגיאה והטופס נשמר', (await page.inputValue('input[name=title]')) === 'נפילת רשת', await page.textContent('.form-error'));
    await page.unroute('**/api/requests/*');
    await page.route('**/api/requests/*', r => r.request().method() === 'PUT' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"שגיאת שרת"}' }) : r.continue());
    await page.click('button[value=save]'); await page.waitForTimeout(300);
    rec('טפסים', 'שגיאת שרת 500 מוצגת למשתמש', /שגיאת שרת/.test(await page.textContent('.form-error')));
    await page.unroute('**/api/requests/*');
    // העלאת קובץ דרך הממשק
    await page.goto(base + `/#/requests/${reqs[0]}`); await page.waitForSelector('.dropzone');
    await page.setInputFiles('.dropzone input[type=file]', { name: 'malware.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    const upErr = await page.textContent('.dropzone [role=status]');
    await page.setInputFiles('.dropzone input[type=file]', { name: 'תוכנית.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    await page.waitForSelector('section[aria-labelledby=docs-h] .fname >> text=תוכנית.pdf');
    rec('טפסים', 'העלאת קובץ מהממשק: exe נדחה עם הודעה, PDF עולה ומופיע ברשימה', /אינו מורשה/.test(upErr) && (await page.textContent('section[aria-labelledby=docs-h]')).includes('תוכנית.pdf'), upErr);
    // העדפות עיצוב נשמרות בשרת
    await page.goto(base + '/#/appearance'); await page.waitForSelector('.swatch');
    await page.click('text=לילה תכנוני'); await page.click('text=שמירת העיצוב'); await page.waitForTimeout(300);
    await page.reload(); await page.waitForSelector('.sidebar');
    rec('עיצוב', 'בחירת ערכת נושא נשמרת בחשבון ונטענת אחרי רענון', await page.evaluate(() => document.documentElement.dataset.theme) === 'night');
    await page.screenshot({ path: path.join(SHOTS, 'saved-night-1280.png') });
    await page.goto(base + '/#/appearance'); await page.click('text=שרטוט'); await page.click('text=שמירת העיצוב'); await page.waitForTimeout(200);

    // ---------- קישורים שבורים ----------
    const hrefs = new Set();
    for (const p of ['/', '/privacy.html', '/accessibility.html', '/nope']) {
      await page.goto(base + p + (p === '/' ? '#/' : '')); await page.waitForTimeout(250);
      for (const h of await page.evaluate(() => [...document.querySelectorAll('a[href], link[href], img[src], script[src]')].map(a => a.getAttribute('href') || a.getAttribute('src')))) hrefs.add(h);
    }
    for (const p of PAGES) { await page.goto(base + '/' + p); await page.waitForTimeout(200); for (const h of await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))) hrefs.add(h); }
    const broken = [];
    for (const h of hrefs) {
      if (h.startsWith('#/')) { const ok = /^#\/(|requests(\?.*|\/\d+(\/edit)?)?|tasks(\?mine=1)?|reports|documents(\?tab=(open|done))?|appearance|account|admin\/(users|roles|types|settings|audit|backups)|forgot|apply\?kind=(resident|entrepreneur))$/.test(h.split('&')[0]); if (!ok) broken.push(h); continue; }
      if (h === '#main') continue;
      const url = new URL(h, base + '/');
      if (url.origin !== base) { out.links.push({ href: h, status: 'external' }); if (!/^https:\/\/(www\.)?(gov\.il|govmap\.gov\.il)\//.test(url.href)) broken.push(`${h}:unexpected-external`); continue; } // אין אינטרנט בסביבת הבדיקה
      const st = (await ctx.request.get(url.href)).status();
      out.links.push({ href: h, status: st }); if (st >= 400) broken.push(`${h}:${st}`);
    }
    rec('קישורים', `${hrefs.size} קישורים/משאבים נבדקו, אין שבורים`, broken.length === 0, broken.join(', '));
    const anchors = await page.evaluate(() => !!document.getElementById('main'));
    rec('קישורים', 'עוגן "#main" של קישור הדילוג קיים', anchors);

    // ---------- התקנה כאפליקציה ----------
    {
      const mf = await (await ctx.request.get(base + '/manifest.webmanifest')).json();
      const iconsOk = [];
      for (const ic of mf.icons) { const r = await ctx.request.get(base + ic.src); iconsOk.push(r.status() === 200); }
      const touch = (await ctx.request.get(base + '/apple-touch-icon.png')).status();
      rec('אפליקציה', 'מניפסט תקין: שם, display=standalone, אייקונים 192/512 + maskable, אייקון לאייפון', mf.display === 'standalone' && mf.short_name === 'תיאום הנדסי' && mf.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable') && iconsOk.every(Boolean) && touch === 200, mf.icons.map(i => i.sizes + '/' + i.purpose).join(', '));
      const ip = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await ip.goto(base + '/'); await ip.waitForSelector('.auth-logo');
      const swOk = await ip.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
      const logoDef = await ip.evaluate(() => { const i = document.querySelector('.auth-logo'); return i.getAttribute('src') === '/logo.png' && i.naturalWidth > 0; });
      rec('אפליקציה', 'Service worker פעיל, ולוגו ברירת המחדל (קריית גת) מוצג במסך הכניסה', swOk && logoDef);
      const hiddenFirst = await ip.evaluate(() => document.querySelector('.install-btn').hidden);
      await ip.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
      const shown = await ip.evaluate(() => !document.querySelector('.install-btn').hidden);
      await ip.click('.install-btn'); await ip.waitForTimeout(150);
      const after = await ip.evaluate(() => ({ prompted: !!window.__prompted, hidden: document.querySelector('.install-btn').hidden }));
      await ip.reload(); await ip.waitForSelector('.auth-logo');
      const stillHidden = await ip.evaluate(() => document.querySelector('.install-btn').hidden);
      rec('אפליקציה', 'כפתור ההתקנה מופיע רק כשהדפדפן מציע התקנה, פותח את חלון ההתקנה, ונעלם אחרי ההתקנה', hiddenFirst && shown && after.prompted && after.hidden && stillHidden, JSON.stringify({ hiddenFirst, shown, ...after, stillHidden }));
      await ip.context().close();
      const { devices } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
      const ictx = await browser.newContext({ ...devices['iPhone 13'] }); const iph = await ictx.newPage();
      await iph.goto(base + '/'); await iph.waitForSelector('.auth-logo');
      const iVisible = await iph.evaluate(() => !document.querySelector('.install-btn').hidden);
      await iph.click('.install-btn'); await iph.waitForSelector('dialog[open]');
      const steps = await iph.textContent('dialog[open] .inst-steps');
      await iph.click('text=כבר התקנתי'); await iph.waitForTimeout(150);
      const iHidden = await iph.evaluate(() => document.querySelector('.install-btn').hidden);
      const sz = await iph.evaluate(() => 1);
      rec('אפליקציה', 'באייפון: הכפתור מציג הוראות "הוספה למסך הבית", ואפשר להסתיר אותו אחרי ההתקנה', iVisible && /הוספה למסך הבית/.test(steps) && iHidden, steps.slice(0, 80));
      await iph.screenshot({ path: path.join(SHOTS, 'iphone-login.png') });
      await ictx.close();
      const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await sctx.addInitScript(() => { const o = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : o(q); });
      const sp2 = await sctx.newPage(); await sp2.goto(base + '/'); await sp2.waitForSelector('.auth-logo');
      await sp2.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
      rec('אפליקציה', 'בתוך האפליקציה המותקנת לא מוצג שום כפתור התקנה', await sp2.evaluate(() => document.querySelectorAll('.install-btn:not([hidden])').length === 0));
      await sctx.close();
    }

    // GovMap מדומה: בסביבת הבדיקה אין אינטרנט, אז הסקריפט של GovMap מוחלף בגרסה שמממשת את אותו API
    const GOVMAP_MOCK = `window.govmap = { events: { CLICK: 'click', EXTENT_CHANGE: 'extent' }, geocodeType: { FullResult: 1 },
      createMap(id, o) { const d = document.getElementById(id); d.style.background = '#cfe0ee'; d.textContent = 'GovMap'; window.__opts = o; setTimeout(() => o.onLoad && o.onLoad(), 30); },
      onEvent(ev) { return { progress(cb) { if (ev === 'click') window.__click = cb; return this; } }; },
      zoomToXY(p) { window.__zoom = p; }, geocode() { return Promise.resolve({ data: [{ X: 177800, Y: 613300 }] }); } };`;
    const mockGovmap = (ctx) => ctx.route('https://www.govmap.gov.il/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: GOVMAP_MOCK }));

    // ---------- הגשת בקשה מהציבור (מובייל 390px) ----------
    {
      const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await mockGovmap(actx);
      const ap = await actx.newPage(); const aErrs = []; ap.on('pageerror', e => aErrs.push(e.message));
      await ap.goto(base + '/'); await ap.waitForSelector('.apply-btn');
      const ctaFirst = await ap.evaluate(() => { const b = document.querySelector('.apply-btn').getBoundingClientRect(); const f = document.querySelector('input[name=username]').getBoundingClientRect(); return b.top < f.top && b.height >= 60; });
      rec('הגשת בקשה', 'כפתור "הגשת בקשה" מודגש מעל טופס הכניסה', ctaFirst);
      await ap.screenshot({ path: path.join(SHOTS, 'apply-cta.png') });
      await ap.click('.apply-btn'); await ap.waitForSelector('dialog[open] .kind-grid');
      const q = await ap.textContent('dialog[open] .kind-q');
      rec('הגשת בקשה', 'נפתחת שאלה "האם אתה יזם או תושב/ת?" עם שתי בחירות', q.includes('האם אתה יזם או תושב/ת?') && (await ap.$$('dialog[open] .kind-card')).length === 2);
      await ap.click('dialog[open] .kind-card >> text=תושב/ת'); await ap.waitForSelector('form.apply-form');
      // שליחה ריקה – הודעת שגיאה ולא נשלח
      await ap.click('form.apply-form button[type=submit]');
      rec('הגשת בקשה', 'שליחה בלי שדות חובה נעצרת עם הודעה', await ap.isVisible('form.apply-form .form-error'));
      await ap.fill('input[name=username]', 'רונית אברהם'); await ap.fill('form.apply-form input[name=password]', 'Br' + 'Apply' + 'Test' + '2026x');
      await ap.selectOption('select[name=type]', { index: 1 });
      const hintSteps = await ap.$$eval('.type-hint .chain-steps li', x => x.map(li => li.textContent));
      rec('סנכרון גורמים', 'בבחירת סוג הבקשה מוצגים למגיש גורמי התשתית הקבועים של הסוג, לפי הסדר', hintSteps.join('|') === chainNames.map((n, i) => (i + 1) + n).join('|'), hintSteps.join('|'));
      await ap.fill('input[name=email]', 'ronit@example.com'); await ap.fill('form.apply-form input[name=phone]', '050-1234567');
      await ap.fill('input[name=address]', 'רחוב הנרקיס 7, קריית גת'); await ap.fill('form.apply-form input[name=project]', 'חיבור ביוב לבית פרטי');
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
      await ap.setInputFiles('#f-route_plan', { name: 'tvai.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
      rec('הגשת בקשה', 'תוכנית תוואי דוחה קובץ שאינו PDF/DWF כבר בבחירה', (await ap.textContent('.file-card.bad .file-name')).includes('PDF'));
      await ap.setInputFiles('#f-route_plan', { name: 'tvai.pdf', mimeType: 'application/pdf', buffer: pdf });
      await ap.setInputFiles('#f-work_request', { name: 'bakasha.pdf', mimeType: 'application/pdf', buffer: pdf });
      await ap.click('form.apply-form button[type=submit]');
      rec('מיקום', 'בלי מיקום במפה – הבקשה לא נשלחת', (await ap.textContent('form.apply-form .form-error')).includes('מיקום'));
      const locBelowProject = await ap.evaluate(() => { const pr = document.querySelector('form.apply-form input[name=project]').getBoundingClientRect(); const lc = document.querySelector('.loc-card').getBoundingClientRect(); return lc.top > pr.bottom; });
      await ap.click('.loc-card'); await ap.waitForSelector('dialog[open] iframe.loc-frame');
      const mframe = await (await ap.waitForSelector('dialog[open] iframe.loc-frame')).contentFrame();
      await mframe.waitForFunction(() => typeof window.__click === 'function');
      const center = await mframe.evaluate(() => window.__opts.center);
      await ap.click('dialog[open] .dlg-foot .btn.primary');
      const noPick = (await ap.textContent('dialog[open] .form-error')).includes('ללחוץ על המפה');
      await mframe.evaluate(() => window.__click({ mapPoint: { x: 177812.44, y: 613245.71 } }));
      await ap.waitForSelector('dialog[open] .loc-coords.ok');
      await ap.fill('dialog[open] input[name=loc_label]', 'רחוב הנרקיס 7, מול החניה');
      await ap.screenshot({ path: path.join(SHOTS, 'apply-location.png') });
      await ap.click('dialog[open] .dlg-foot .btn.primary'); await ap.waitForSelector('.loc-card.done');
      rec('מיקום', 'שדה "מיקום" מתחת לפרויקט פותח את GovMap על קריית גת, מסמנים בלחיצה ושומרים', locBelowProject && center.x > 170000 && center.x < 185000 && center.y > 605000 && center.y < 620000 && noPick && (await ap.textContent('.loc-card')).includes('רחוב הנרקיס 7'), JSON.stringify(center));
      await ap.click('form.apply-form button[type=submit]');
      rec('הגשת בקשה', 'בלי טופס משטרה – הבקשה לא נשלחת', (await ap.textContent('form.apply-form .form-error')).includes('משטרה'));
      await ap.click('.police-card'); await ap.waitForSelector('dialog[open] form.police-form');
      await ap.screenshot({ path: path.join(SHOTS, 'apply-police.png') });
      await ap.fill('.police-form input[name=applicant_name]', 'רונית אברהם');
      await ap.click('.police-form .seg button >> text=ח.פ'); await ap.click('.police-form .seg button >> text=תעודת זהות');
      await ap.fill('.police-form input[name=id_number]', '123456789');
      await ap.fill('.police-form textarea[name=description]', 'חפירה במדרכה לחיבור ביוב'); await ap.fill('.police-form input[name=work_time]', 'א׳-ה׳');
      await ap.fill('.police-form input[name=work_hours]', '07:00-16:00'); await ap.fill('.police-form input[name=contact]', 'משה הקבלן 052-7654321');
      await ap.click('dialog[open] .dlg-foot .btn.primary');
      rec('הגשת בקשה', 'ת.ז לא תקינה נדחית בטופס המשטרה', (await ap.textContent('dialog[open] .form-error')).includes('תעודת הזהות'));
      await ap.fill('.police-form input[name=id_number]', '000000018'); await ap.click('dialog[open] .dlg-foot .btn.primary');
      await ap.waitForSelector('.police-card.done');
      rec('הגשת בקשה', 'טופס המשטרה נשמר ומסומן "מולא"', (await ap.textContent('.pol-status')) === 'מולא');
      const ovf = await ap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      rec('הגשת בקשה', 'טופס ההגשה בלי גלילה אופקית ב-390px', ovf <= 0, 'overflow=' + ovf);
      await ap.screenshot({ path: path.join(SHOTS, 'apply-form.png'), fullPage: true });
      await ap.click('form.apply-form button[type=submit]');
      await ap.waitForSelector('dialog[open] .apply-done', { timeout: 15000 });
      const num = (await ap.textContent('dialog[open] .done-num')).trim(); const msg = await ap.textContent('dialog[open] .apply-done');
      rec('הגשת בקשה', 'אחרי השליחה: "הבקשה הוגשה בהצלחה ותעבור להמשך טיפול" + מספר בקשה', msg.includes('הבקשה הוגשה בהצלחה ותעבור להמשך טיפול') && num.length > 2, num);
      await ap.screenshot({ path: path.join(SHOTS, 'apply-done.png') });
      await ap.click('dialog[open] .btn.primary'); await ap.waitForSelector('.req-number');
      rec('הגשת בקשה', 'המגיש מחובר אוטומטית ורואה את הבקשה שלו', (await ap.textContent('.req-number')).trim() === num);
      const apNav = await ap.evaluate(() => [...document.querySelectorAll('#sidebar .nav a, #sidebar .nav-group')].map(e => e.textContent.trim()));
      rec('תפריט', 'למגיש מהציבור אין "ניהול עבודה" ואין "בקשה חדשה" בתפריט', !apNav.some(t => /ניהול עבודה|בקשה חדשה|פרויקטים|תקציב|לוח זמנים|משימות/.test(t)) && apNav.includes('הבקשות שלי'), apNav.join(', '));
      const reqUrl = ap.url();
      await ap.goto(base + '/#/tasks'); await ap.waitForTimeout(400);
      rec('תפריט', 'מגיש מהציבור שמקליד כתובת של ניהול עבודה מוחזר לדף הבית', /#\/$/.test(ap.url()));
      await ap.goto(reqUrl); await ap.waitForSelector('.req-number');

      const docsTxt = await ap.textContent('#docs-h + *, section[aria-labelledby=docs-h]');
      rec('הגשת בקשה', 'טופס המשטרה (PDF) לא גלוי למגיש', !/משטרה/.test(docsTxt) && /tvai\.pdf/.test(docsTxt), docsTxt.slice(0, 120));
      rec('הגשת בקשה', 'אין שגיאות JavaScript בזרימת ההגשה', aErrs.length === 0, aErrs.join(' | '));
      await actx.close();
      // מנהל: רואה את טופס המשטרה כמסמך מוגבל, וממפה גורמים בסדר
      const mctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await mockGovmap(mctx); const mp = await mctx.newPage();
      await login(mp); await mp.goto(base + '/#/requests?scope=all'); await mp.waitForSelector('table, .empty');
      await mp.click(`text=${num}`); await mp.waitForSelector('.req-number');
      rec('הגשת בקשה', 'מנהל המערכת רואה את טופס המשטרה כמסמך "מוגבל"', await mp.isVisible('.lock-chip'));
      const vf = await (await mp.waitForSelector('.loc-figure iframe.loc-view')).contentFrame();
      await vf.waitForFunction(() => !!window.__zoom);
      const zoomed = await vf.evaluate(() => window.__zoom);
      const figBox = await mp.evaluate(() => { const f = document.querySelector('.loc-figure').getBoundingClientRect(); const i = document.querySelector('.details-with-map dl').getBoundingClientRect(); return { side: !!document.querySelector('.details-with-map > .loc-figure') && f.width > 180 && f.height > 150 && (Math.abs(f.top - i.top) < 40 || f.bottom <= i.top + 4), w: f.width }; });
      rec('מיקום', 'בעמוד הבקשה המיקום מוצג כמפה עם סמן צמוד לפרטי הבקשה, עם קישור ל-GovMap', zoomed.x === 177812.44 && zoomed.marker === true && figBox.side && (await mp.getAttribute('.loc-figure a[href*="govmap.gov.il/?c=177812.44,613245.71"]', 'target')) === '_blank', JSON.stringify({ zoomed, figBox }));
      await mp.screenshot({ path: path.join(SHOTS, 'request-location.png') });
      await mp.click('text=בחירת גורמים וסדר'); await mp.waitForSelector('dialog[open] .order-rest');
      await mp.click('dialog[open] .order-rest button >> nth=0'); await mp.click('dialog[open] .order-rest button >> nth=0');
      await mp.click('dialog[open] .order-list li:nth-child(2) button[aria-label^="העלאה"]');
      const firstName = (await mp.textContent('dialog[open] .order-list li:nth-child(1) .grow')).trim();
      await mp.click('dialog[open] .dlg-foot .btn.primary'); await mp.waitForSelector('.approvals.ordered');
      await mp.click('text=העברה לבדיקה'); await mp.click('dialog[open] .dlg-foot .btn.primary'); await mp.waitForSelector('.approval.turn');
      const turnName = await mp.textContent('.approval.turn .who');
      rec('הגשת בקשה', 'גורמים נשמרים בסדר שנבחר, והראשון מסומן "התור הנוכחי"', turnName.includes(firstName) && turnName.includes('התור הנוכחי'), turnName);
      await mp.screenshot({ path: path.join(SHOTS, 'request-turn.png'), fullPage: true });
      await mp.goto(base + '/#/admin/types'); await mp.waitForSelector('.type-card');
      rec('הגשת בקשה', 'מסך "סוגי בקשות" מציג את הסוגים', (await mp.$$('.type-card')).length >= 3);
      await mp.click('.type-card >> nth=0 >> button >> text=עריכה'); await mp.waitForSelector('dialog[open] .order-rest');
      const dlgText = await mp.textContent('dialog[open]');
      await mp.click('dialog[open] .order-rest button >> nth=0'); await mp.click('dialog[open] .order-rest button >> nth=0');
      const chosen = await mp.$$eval('dialog[open] .order-list li .grow', x => x.map(e => e.textContent.trim()));
      await mp.click('dialog[open] .dlg-foot .btn.primary'); await mp.waitForFunction((n) => !document.querySelector('dialog[open]') && document.querySelector('.type-card .chain-steps') && document.querySelector('.type-card .chain-steps').children.length === n, chosen.length, { timeout: 8000 }).catch(() => {});
      const card0 = await mp.evaluate(() => ({ steps: [...document.querySelector('.type-card .chain-steps').children].map(li => li.textContent), page: document.querySelector('main').textContent }));
      rec('סוגי בקשות', 'אין יותר "מטפלים אוטומטיים" (לא בחלון ולא בתיאור הראשי)', !/מטפלים אוטומטיים/.test(dlgText) && !/מטפלים/.test(card0.page));
      rec('סוגי בקשות', 'במקום "ייקבעו ידנית על ידי אחראי המיפוי" מוצגים הגורמים שנבחרו, לפי הסדר', !/ייקבעו ידנית/.test(card0.page) && card0.steps.length === chosen.length && chosen.length === 4 && card0.steps.every((t, i) => t === (i + 1) + chosen[i]), JSON.stringify(card0.steps));
      await mp.screenshot({ path: path.join(SHOTS, 'types.png'), fullPage: true });
      const adNav = await mp.evaluate(() => [...document.querySelectorAll('#sidebar .nav > a, #sidebar .nav-folder')].map(e => e.textContent.trim()));
      rec('תפריט', 'אין בתפריט "בקשה חדשה", "פרויקטים", "תקציב", "לוח זמנים" (נמחקו מהמערכת)', !adNav.some(t => ['בקשה חדשה', 'פרויקטים', 'תקציב', 'לוח זמנים'].includes(t)) && adNav.includes('מסמכים') && adNav.includes('משימות'), adNav.join(', '));
      rec('תפריט', 'מנהל המערכת: אין כפתור "בקשה חדשה" בדף הבית', await (async () => { await mp.goto(base + '/#/'); await mp.waitForSelector('.page-head'); return !(await mp.$('a[href="#/requests/new"]')); })());
      // מסמכים: תיקייה בתפריט הצד + תיקייה לכל בקשה + לשוניות פתוחות/שטופלו
      await mp.goto(base + '/#/'); await mp.waitForSelector('.nav-folder');
      const fBefore = await mp.getAttribute('.nav-folder', 'aria-expanded');
      await mp.click('.nav-folder'); const fAfter = await mp.getAttribute('.nav-folder', 'aria-expanded');
      if (fAfter !== 'true') await mp.click('.nav-folder');
      const subLinks = await mp.evaluate(() => [...document.querySelectorAll('.nav-sub a')].map(a => a.textContent.trim()));
      rec('מסמכים', 'בתפריט הצד "מסמכים" היא תיקייה שנפתחת ונסגרת, ובתוכה "בקשות פתוחות" ו"בקשות שטופלו"', fBefore !== fAfter && subLinks.join() === 'בקשות פתוחות,בקשות שטופלו', `${fBefore}→${fAfter} ${subLinks}`);
      await mp.click('.nav-sub a >> text=בקשות פתוחות'); await mp.waitForSelector('.doc-folder');
      const closedByDefault = await mp.evaluate(() => [...document.querySelectorAll('.doc-folder')].every(d => !d.open));
      await mp.click('.doc-folder >> nth=0 >> summary'); const opened = await mp.evaluate(() => document.querySelector('.doc-folder').open && !!document.querySelector('.doc-folder .files li'));
      await mp.click('.doc-folder >> nth=0 >> summary'); const reclosed = await mp.evaluate(() => !document.querySelector('.doc-folder').open);
      rec('מסמכים', 'כל בקשה היא תיקייה סגורה שנפתחת ונסגרת בלחיצה', closedByDefault && opened && reclosed);
      const groups = await mp.evaluate(() => [...document.querySelectorAll('.doc-folder .df-num')].map(e => e.textContent.trim()));
      const sorted = [...groups].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      rec('מסמכים', 'התיקיות מסודרות לפי מספר בקשה, מהחדשה לישנה', groups.length >= 1 && JSON.stringify(groups) === JSON.stringify(sorted) && groups.includes(num), groups.join(' | '));
      await mp.click('button[role=tab] >> text=בקשות שטופלו');
      const doneTab = await mp.evaluate(() => ({ sel: document.querySelector('[role=tab][aria-selected=true]').textContent, url: location.hash, nums: [...document.querySelectorAll('.doc-folder .df-num')].map(e => e.textContent) }));
      rec('מסמכים', 'לשונית "בקשות שטופלו" מציגה רק בקשות שהסתיימו', doneTab.sel.startsWith('בקשות שטופלו') && /tab=done/.test(doneTab.url) && !doneTab.nums.includes(num), JSON.stringify(doneTab));
      await mp.click('button[role=tab] >> text=בקשות פתוחות');
      await mp.click('text=פתיחת הכל');
      await mp.screenshot({ path: path.join(SHOTS, 'documents-grouped.png'), fullPage: true });
      // כל הבקשות: בלי מסלול, סינון אוטומטי, לשוניות
      await mp.goto(base + '/#/requests?scope=all'); await mp.waitForSelector('[role=tab]');
      const noTrack = await mp.evaluate(() => !document.querySelector('select[name=track]') && !document.querySelector('form[role=search] button[type=submit]') && ![...document.querySelectorAll('th')].some(t => t.textContent.includes('מסלול')));
      rec('כל הבקשות', 'אין סינון לפי מסלול ואין כפתור "סינון"', noTrack);
      const rowsAll = await mp.$$eval('tbody tr', t => t.length);
      await mp.fill('#fq', num); await mp.waitForTimeout(400);
      const rowsQ = await mp.$$eval('tbody tr', t => t.map(r => r.textContent));
      rec('כל הבקשות', 'החיפוש מסנן מיד בזמן ההקלדה, בלי ללחוץ על כפתור', rowsQ.length === 1 && rowsQ[0].includes(num) && rowsAll > 1, `${rowsAll}→${rowsQ.length}`);
      await mp.fill('#fq', ''); await mp.waitForTimeout(300);
      await mp.selectOption('#fs', 'pending_admin'); await mp.waitForTimeout(200);
      const stRows = await mp.$$eval('tbody tr', t => t.map(r => r.textContent));
      rec('כל הבקשות', 'בחירת סטטוס מסננת מיד', stRows.length >= 0 && stRows.every(t => t.includes('ממתינה לאישור מנהל') || t.includes('לא נמצאו')), stRows.length);
      await mp.selectOption('#fs', ''); await mp.click('button[role=tab] >> text=בקשות שטופלו');
      const counts = await mp.$$eval('[role=tab]', t => t.map(x => x.textContent));
      rec('כל הבקשות', 'לשוניות "בקשות פתוחות" ו"בקשות שטופלו" עם מספר הבקשות בכל אחת', counts.length === 2 && /בקשות פתוחות \(\d+\)/.test(counts[0]) && /בקשות שטופלו \(\d+\)/.test(counts[1]), counts.join(' | '));
      await mp.screenshot({ path: path.join(SHOTS, 'requests-tabs.png'), fullPage: true });
      // צפייה בקובץ בלי להוריד
      await mp.goto(base + '/#/requests?scope=all'); await mp.waitForSelector('[role=tab]'); await mp.click(`text=${num}`); await mp.waitForSelector('.req-number');
      const wtRow = await mp.evaluate(() => { const dts = [...document.querySelectorAll('.details-with-map dt')]; const i = dts.findIndex(x => x.textContent === 'זמן עבודה'); return { wt: i >= 0 ? dts[i].nextElementSibling.textContent : null, track: dts.some(x => x.textContent === 'מסלול') }; });
      rec('זמן עבודה', 'בעמוד הבקשה מופיע "זמן עבודה" מטופס המשטרה, ואין יותר "מסלול"', wtRow.wt === 'א׳-ה׳' && !wtRow.track && !(await mp.$('.chip.fast')), JSON.stringify(wtRow));
      await mp.click('section[aria-labelledby=docs-h] button[aria-label="צפייה בbakasha.pdf"]'); await mp.waitForSelector('dialog[open] iframe.viewer-frame');
      const vsrc = await mp.getAttribute('dialog[open] iframe.viewer-frame', 'src');
      const vfr = await (await mp.$('dialog[open] iframe.viewer-frame')).contentFrame(); await mp.waitForTimeout(600);
      const vResp = await mp.evaluate(async (u) => { const r = await fetch(u); return { st: r.status, cd: r.headers.get('content-disposition'), ct: r.headers.get('content-type') }; }, vsrc);
      rec('צפייה בקבצים', 'לחיצה על "צפייה" פותחת את הקובץ בתוך המערכת, בלי להוריד אותו', /\/view$/.test(vsrc) && vResp.st === 200 && /^inline/.test(vResp.cd) && vResp.ct === 'application/pdf' && !!vfr, JSON.stringify(vResp));
      await mp.screenshot({ path: path.join(SHOTS, 'file-viewer.png') });
      await mp.click('dialog[open] .dlg-foot button >> text=סגירה');
      // משימות: אחראי = גורם תשתית ואיש הקשר שלו
      await mp.goto(base + '/#/tasks'); await mp.click('text=משימה חדשה'); await mp.waitForSelector('dialog[open] select[name=infra_body_id]');
      const tOpts = await mp.$$eval('dialog[open] select[name=infra_body_id] option', o => o.map(x => ({ t: x.textContent, d: x.disabled })));
      rec('משימות', 'ברשימת האחראי מופיעים גורמי התשתית עם איש הקשר שהוגדר (גורם בלי איש קשר לא ניתן לבחירה)', tOpts.some(o => /– יוסי כהן$/.test(o.t) && !o.d) && tOpts.some(o => /לא הוגדר איש קשר/.test(o.t) && o.d), tOpts.map(o => o.t).join(' | '));
      await mp.click('dialog[open] .dlg-foot button >> text=ביטול');
      { const d0 = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'app.db')); d0.prepare("UPDATE users SET must_change_pw = 0 WHERE username = 'yossi'").run(); d0.close(); }
      const engCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const ep = await engCtx.newPage();
      await ep.goto(base + '/'); await ep.fill('input[name=username]', 'yossi'); await ep.fill('input[name=password]', engPwOut); await ep.click('form button[type=submit]'); await ep.waitForSelector('#gsearch');
      await ep.goto(base + '/#/tasks'); await ep.waitForSelector('.page-head');
      rec('משימות', 'רק מנהל המערכת ורכז תיאום רואים "משימה חדשה" (מהנדס – לא)', !(await ep.$('text=משימה חדשה')) && (await ep.textContent('main')).includes('סיור שטח עם נציג התאגיד'));
      await engCtx.close();
      // מסך הכניסה: הכותרת והתיאור למעלה, מתחת לשם הארגון
      const lc = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const lpp = await lc.newPage(); await lpp.goto(base + '/'); await lpp.waitForSelector('.auth-art h1');
      const pos = await lpp.evaluate(() => { const o = document.querySelector('.auth-org').getBoundingClientRect(); const t = document.querySelector('.auth-art h1').getBoundingClientRect(); return { gap: t.top - o.bottom, top: t.top }; });
      rec('מסך כניסה', 'הכותרת והתיאור בצד מוצגים למעלה, מיד מתחת ל"מינהל הנדסה"', pos.gap >= 0 && pos.gap < 60 && pos.top < 200, JSON.stringify(pos));
      await lpp.screenshot({ path: path.join(SHOTS, 'login-top.png') });
      await lc.close();
      // כל הבקשות במובייל: טקסט החיפוש לא נחתך
      const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mob = await mc.newPage();
      await login(mob); await mob.goto(base + '/#/requests?scope=all'); await mob.waitForSelector('#fq'); await mob.waitForTimeout(400);
      const fitq = await mob.evaluate(() => { const i = document.getElementById('fq'); const cs = getComputedStyle(i); const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; return { ph: i.placeholder, need: c.measureText(i.placeholder).width, room: i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; });
      rec('כל הבקשות', 'במכשיר נייד טקסט החיפוש מוצג עד הסוף (לא נחתך)', fitq.ph.length > 3 && fitq.need <= fitq.room, JSON.stringify(fitq));
      await mc.close();
      // החזרה לתיקון: בחירה למי מחזירים
      await mp.goto(base + '/#/requests?scope=all'); await mp.waitForSelector('[role=tab]'); await mp.click(`text=${num}`); await mp.waitForSelector('.req-number');
      await mp.click('.req-head button >> text=החזרה לתיקון'); await mp.waitForSelector('dialog[open] [name=return_to]');
      const opts = await mp.$$eval('dialog[open] [name=return_to]', x => x.length);
      await mp.screenshot({ path: path.join(SHOTS, 'return-dialog.png') });
      await mp.check('dialog[open] [name=return_to] >> nth=1'); await mp.fill('dialog[open] textarea[name=comment]', 'חסרה תוכנית חתומה');
      await mp.click('dialog[open] .dlg-foot .btn.primary'); await mp.waitForSelector('.toast');
      const tmsg = await mp.textContent('.toast');
      rec('החזרה לתיקון', 'בחלון ההחזרה בוחרים למי מחזירים (מגיש או גורם תשתית), וההחזרה נשלחת עם הסיבה', opts >= 3 && /הוחזרה ל/.test(tmsg) && /אימייל/.test(tmsg), tmsg);
      // מסך הכניסה: בלי שורות התשתיות, עם שם הארגון המלא
      const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const lp = await lctx.newPage(); await lp.goto(base + '/'); await lp.waitForSelector('.auth-art h1');
      const art = await lp.textContent('.auth-art');
      rec('מסך כניסה', 'מסך הכניסה בלי "מים וביוב / חשמל / תקשורת", ועם "מינהל הנדסה עיריית קריית גת"', !/מים וביוב|חשמל|תקשורת/.test(art) && art.includes('מינהל הנדסה עיריית קריית גת'), art.slice(0, 120));
      await lctx.close();
      await mp.goto(base + '/#/admin/settings'); await mp.waitForSelector('[name=login_heading]');
      await mp.fill('[name=login_heading]', 'ברוכים הבאים לתיאום ההנדסי'); await mp.fill('[name=login_text]', 'כאן מגישים ועוקבים אחרי בקשות.');
      await mp.click('text=שמירת מסך הכניסה'); await mp.waitForTimeout(400);
      const lctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const lp2 = await lctx2.newPage(); await lp2.goto(base + '/'); await lp2.waitForSelector('.auth-art h1');
      rec('מסך כניסה', 'עריכת הכותרת והתיאור של מסך הכניסה מהגדרות וקבצים', (await lp2.textContent('.auth-art h1')) === 'ברוכים הבאים לתיאום ההנדסי' && (await lp2.textContent('.auth-art')).includes('כאן מגישים ועוקבים'));
      await lp2.screenshot({ path: path.join(SHOTS, 'login-edited.png') });
      await lctx2.close();
      await mctx.close();
    }

    // ---------- ביצועים ----------
    const perfPage = await (await browser.newContext()).newPage();
    const sizes = [];
    perfPage.on('response', async r => { try { const b = await r.body(); sizes.push({ url: r.url().replace(base, ''), bytes: Number(r.headers()['content-length'] || b.length), raw: b.length, enc: r.headers()['content-encoding'] || 'none', cache: r.headers()['cache-control'] }); } catch { /* */ } });
    const t0 = Date.now(); await perfPage.goto(base + '/', { waitUntil: 'networkidle' }); const loadMs = Date.now() - t0;
    const nav = await perfPage.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
    out.perf = { loadMs, nav, totalBytes: sizes.reduce((a, s) => a + s.bytes, 0), resources: sizes };
    rec('ביצועים', `טעינת מסך כניסה: ${(out.perf.totalBytes / 1024).toFixed(0)}KB ברשת (${(sizes.reduce((a, s) => a + s.raw, 0) / 1024).toFixed(0)}KB לפני דחיסה), DOMContentLoaded ${nav.dcl}ms`, out.perf.totalBytes < 120 * 1024, sizes.map(s => `${s.url} ${(s.bytes / 1024).toFixed(1)}KB enc=${s.enc}`).join(' | '));
    rec('ביצועים', 'דחיסת gzip/brotli פעילה', sizes.some(s => s.enc !== 'none'), 'enc=' + [...new Set(sizes.map(s => s.enc))].join(','));
    rec('שגיאות', 'אין שגיאות JavaScript בקונסול', consoleErrors.filter(e => !/401|Failed to load resource/.test(e)).length === 0, consoleErrors.slice(0, 4).join(' | '));
  } catch (e) { console.error(e); rec('הרצה', 'בדיקות הדפדפן רצו עד הסוף', false, e.message); }
  await browser.close(); srv.kill();
  fs.writeFileSync(path.join(os.tmpdir(), 'coord-browser-results.json'), JSON.stringify(out, null, 2));
  const f = out.checks.filter(c => !c.pass).length; console.log(`\n${out.checks.length - f}/${out.checks.length} passed`);
})();
