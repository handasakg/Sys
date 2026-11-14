'use strict';
/* מערכת תיאום הנדסי – צד לקוח.
   כלל אבטחה: כל טקסט שמגיע מהשרת נכנס ל-DOM רק דרך textContent (פונקציית h). אין innerHTML עם נתונים. */
(() => {
  const S = { me: null, csrf: null, perms: new Set(), meta: null, prefs: {}, title: 'מערכת תיאום הנדסי', org: 'מינהל הנדסה עיריית קריית גת', login: { heading: '', text: '' }, logo: null };
  const logoUrl = () => (S.logo ? `/api/logo?v=${encodeURIComponent(S.logo)}` : '/logo.png'); // ברירת מחדל: הלוגו הקבוע של הארגון
  const root = document.getElementById('root');

  // ---------- DOM ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
    plus: 'M12 5v14M5 12h14',
    folder: 'M3 6h6l2 2h10v11H3z',
    folderOpen: 'M3 6h6l2 2h10v3M3 6v13h15l3-9H6l-3 9',
    chevron: 'M9 6l6 6-6 6',
    check: 'M4 12l5 5L20 6',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 20c0-3-2-5-4-5',
    key: 'M15 8a4 4 0 1 1-3.5 6L4 21H2v-3l7.5-7.5A4 4 0 0 1 15 8zM16 7h.01',
    sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    badge: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.3 7.2 16.9l.9-5.4L4.2 7.7l5.4-.8z M12 17v5',
    send: 'M3 11l18-8-8 18-2-8z',
    home2: 'M3 10l9-7 9 7M5 9v11h14V9',
    building: 'M4 21V4h10v17M14 9h6v12M7 8h2M7 12h2M7 16h2M17 13h1M17 17h1',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
    ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    db: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0',
    palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 4 1 6-1 1-12-8-12zM7.5 11h.01M10 7h.01M15 7h.01',
    bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
    menu: 'M4 7h16M4 12h16M4 17h16',
    out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
    x: 'M6 6l12 12M18 6L6 18',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
    edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    task: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    install: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 6v8M8.5 10.5L12 14l3.5-3.5M10 18h4',
    share: 'M12 3v12M8 7l4-4 4 4M5 11v9h14v-9',
  };
  function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name] || ''); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    svg.append(p); return svg;
  }
  const can = (p) => S.perms.has(p);
  const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + 'Z'); return Number.isNaN(+d) ? s : d.toLocaleDateString('he-IL'); };
  const fmtDateTime = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return Number.isNaN(+d) ? s : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); };
  const fmtMoney = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n || 0);
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------- תקשורת עם השרת ----------
  async function api(method, url, body, { raw = false } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (S.csrf) opts.headers['X-CSRF-Token'] = S.csrf;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); }
    catch { throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.'); }
    if (raw) return res;
    let data = {}; try { data = await res.json(); } catch { /* ריק */ }
    if (res.status === 401 && S.me && url !== '/api/auth/me') { S.me = null; S.csrf = null; renderLogin('פג תוקף ההתחברות. היכנסו שוב.'); throw new Error('נדרשת התחברות'); }
    if (!res.ok) { const e = new Error(data.error || `הפעולה נכשלה (שגיאה ${res.status})`); e.status = res.status; throw e; }
    return data;
  }

  // ---------- התראות קופצות וחלונות ----------
  function toast(msg, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: err ? 'alert' : null }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), err ? 7000 : 3500);
  }
  function modal(title, body, actions = []) {
    const prevFocus = document.activeElement;
    const titleId = 'dlg-' + Math.random().toString(36).slice(2);
    const dlg = h('dialog', { 'aria-labelledby': titleId },
      h('div', { class: 'dlg-head' }, h('h2', { id: titleId }, title),
        h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'סגירה', onclick: () => close() }, icon('x'))),
      h('div', { class: 'dlg-body' }, body),
      actions.length ? h('div', { class: 'dlg-foot' }, actions) : null);
    function close() { dlg.close(); dlg.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.append(dlg);
    dlg.showModal(); // showModal מגביל את הפוקוס לחלון ו-Esc סוגר
    const first = dlg.querySelector('.dlg-body input, .dlg-body select, .dlg-body textarea, .dlg-body button');
    if (first) first.focus();
    return { dlg, close };
  }
  function confirmDlg(title, text, okLabel = 'אישור', danger = false) {
    return new Promise(resolve => {
      const m = modal(title, h('p', null, text), [
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => { m.close(); resolve(true); } }, okLabel),
        h('button', { class: 'btn', type: 'button', onclick: () => { m.close(); resolve(false); } }, 'ביטול'),
      ]);
    });
  }

  // ---------- טפסים ----------
  let fid = 0;
  function field(label, input, { hint, required } = {}) {
    const id = input.id || ('f' + (++fid));
    input.id = id;
    if (required) { input.required = true; input.setAttribute('aria-required', 'true'); }
    let hintEl = null;
    if (hint) { hintEl = h('span', { class: 'hint', id: id + '-h' }, hint); input.setAttribute('aria-describedby', id + '-h'); }
    return h('div', { class: 'field' }, h('label', { for: id }, label, required ? h('span', { class: 'req-mark', 'aria-hidden': 'true' }, ' *') : null), input, hintEl);
  }
  const inp = (name, attrs = {}) => h('input', { name, type: 'text', ...attrs });
  function sel(name, options, value, attrs = {}) {
    const s = h('select', { name, ...attrs });
    for (const [v, l] of options) { const o = h('option', { value: v }, l); if (String(v) === String(value ?? '')) o.selected = true; s.append(o); }
    return s;
  }
  const area = (name, attrs = {}) => { const t = h('textarea', { name, ...attrs }); if (attrs.value) t.value = attrs.value; return t; };
  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else out[el.name] = el.value.trim() === '' ? null : el.value.trim();
    }
    return out;
  }
  // אימות בצד לקוח (נוחות בלבד – האימות המחייב נעשה בשרת)
  function validate(form, errBox) {
    errBox.hidden = true; errBox.textContent = '';
    let firstBad = null;
    for (const el of form.elements) {
      if (!el.willValidate) continue;
      el.removeAttribute('aria-invalid');
      if (!el.checkValidity()) { el.setAttribute('aria-invalid', 'true'); firstBad = firstBad || el; }
    }
    if (firstBad) {
      const lbl = form.querySelector(`label[for="${firstBad.id}"]`);
      showErr(errBox, `נא למלא כראוי את השדה "${lbl ? lbl.textContent.replace(' *', '') : firstBad.name}".`);
      firstBad.focus(); return false;
    }
    return true;
  }
  function showErr(box, msg) { box.textContent = msg; box.hidden = false; }
  const errBox = () => h('div', { class: 'form-error', role: 'alert', hidden: true });
  async function submitting(btn, fn) {
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'שומר…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  }

  // ---------- עיצוב ותצוגה ----------
  const PREF_DEFAULTS = { theme: 'ocean', mode: 'light', shape: 'soft', style: 'glass', density: 'regular', font: 'sans', fontSize: '16', accent: '', motion: 'full', sidebar: 'floating', contrast: 'normal', bg: 'aurora',
    width: 'regular', header: 'blur', chartTexture: 'off', chartGrid: 'on', chartAnim: 'on' };
  const DARK_ONLY = ['night', 'graphite'];
  // ניגודיות: צבע הדגשה מותאם אישית מתוקן אוטומטית עד שהוא קריא (4.5:1) על המשטח של ערכת הנושא
  const hex2rgb = (hx) => { const m = /^#?([0-9a-f]{6})$/i.exec(hx.trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgb2hex = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const relLum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const l1 = relLum(a), l2 = relLum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  function readableAccent(hx, surfaceHex) {
    let c = hex2rgb(hx); const sf = hex2rgb(surfaceHex) || [255, 255, 255];
    const toward = relLum(sf) > 0.4 ? [0, 0, 0] : [255, 255, 255];
    for (let i = 0; i < 20 && ratio(c, sf) < 4.5; i++) c = c.map((v, k) => v + (toward[k] - v) * 0.12);
    const ink = ratio(c, [255, 255, 255]) >= ratio(c, [0, 0, 0]) ? '#FFFFFF' : '#000000';
    return { accent: rgb2hex(c), ink, adjusted: rgb2hex(c).toLowerCase() !== hx.toLowerCase() };
  }
  function applyPrefs(p) {
    const r = document.documentElement; const x = { ...PREF_DEFAULTS, ...p };
    const dark = x.mode === 'dark' || (x.mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    r.dataset.mode = DARK_ONLY.includes(x.theme) || dark ? 'dark' : 'light';
    r.dataset.theme = x.theme; r.dataset.shape = x.shape; r.dataset.style = x.style; r.dataset.density = x.density;
    r.dataset.font = x.font; r.dataset.motion = x.motion; r.dataset.sidebar = x.sidebar; r.dataset.contrast = x.contrast; r.dataset.bg = x.bg;
    r.dataset.width = x.width; r.dataset.header = x.header; r.dataset.chartTexture = x.chartTexture; r.dataset.chartGrid = x.chartGrid; r.dataset.chartAnim = x.chartAnim;
    r.style.setProperty('--fs', (/^\d{2}$/.test(x.fontSize) ? x.fontSize : '16') + 'px');
    for (const v of ['--accent', '--accent-ink', '--accent-soft']) r.style.removeProperty(v);
    if (x.accent && /^#[0-9a-f]{6}$/i.test(x.accent) && x.contrast !== 'high') {
      const surface = getComputedStyle(r).getPropertyValue('--surface').trim();
      const fix = readableAccent(x.accent, surface);
      r.style.setProperty('--accent', fix.accent); r.style.setProperty('--accent-ink', fix.ink);
      r.style.setProperty('--accent-soft', `color-mix(in srgb, ${fix.accent} 16%, ${surface})`);
      return fix;
    }
    return null;
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPrefs(S.prefs));

  // ---------- תוויות ----------
  const T = (k) => (S.meta && S.meta.types[k]) || k;
  const ST = (k) => (S.meta && S.meta.statuses[k]) || k;
  const statusChip = (s) => h('span', { class: 'chip st-' + s }, ST(s));
  function markClass(name) {
    const n = String(name);
    if (/מים|ביוב|תאגיד/.test(n)) return 'm-water';
    if (/חשמל|תאורה/.test(n)) return 'm-power';
    if (/בזק|תקשורת|סיבים|כבלים/.test(n)) return 'm-telecom';
    if (/גז|דלק/.test(n)) return 'm-gas';
    if (/ניקוז|גנים|נוף/.test(n)) return 'm-sewer';
    if (/מדידה|מודד/.test(n)) return 'm-survey';
    if (/תנועה|תחבורה|כביש/.test(n)) return 'm-reclaimed';
    return 'm-white';
  }

  // ---------- התקנה כאפליקציה (Android, iPhone/iPad, מחשב) ----------
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
  const Install = { evt: null, btns: new Set() };
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  function canInstall() {
    if (isStandalone() || LS.get('app-installed') === '1') return false;
    return !!Install.evt || isIOS || isMacSafari; // Chrome/Edge/Samsung: אירוע התקנה. iOS / Safari במק: הוראות
  }
  function refreshInstall() { const show = canInstall(); for (const b of Install.btns) { if (!b.isConnected) Install.btns.delete(b); else b.hidden = !show; } }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); Install.evt = e; refreshInstall(); });
  window.addEventListener('appinstalled', () => { Install.evt = null; LS.set('app-installed', '1'); refreshInstall(); toast('האפליקציה הותקנה. אפשר לפתוח אותה מהמסך הראשי או מתפריט התוכניות.'); });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', refreshInstall);
  async function doInstall() {
    if (Install.evt) {
      const e = Install.evt; Install.evt = null; refreshInstall();
      e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') LS.set('app-installed', '1');
      refreshInstall(); return;
    }
    const step = (n, ...t) => h('li', null, h('span', { class: 'inst-n', 'aria-hidden': 'true' }, String(n)), h('span', null, ...t));
    const shareIcon = h('span', { class: 'inst-ic' }, icon('share'));
    const steps = isIOS
      ? h('ol', { class: 'inst-steps' }, step(1, 'לחצו על כפתור השיתוף ', shareIcon, ' (בספארי בפס התחתון, בכרום למעלה).'), step(2, 'גללו ובחרו ', h('strong', null, '"הוספה למסך הבית"'), '.'), step(3, 'לחצו ', h('strong', null, '"הוסף"'), '. הסמל יופיע במסך הבית.'))
      : h('ol', { class: 'inst-steps' }, step(1, 'בתפריט העליון של ספארי בחרו ', h('strong', null, 'קובץ'), '.'), step(2, 'בחרו ', h('strong', null, '"הוספה ל-Dock"'), ' ואשרו.'), step(3, 'המערכת תיפתח כאפליקציה מה-Dock ומ-Launchpad.'));
    const m = modal('התקנה כאפליקציה', h('div', null, h('p', null, 'כך מתקינים את המערכת במכשיר הזה:'), steps), [
      h('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, 'הבנתי'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { LS.set('app-installed', '1'); refreshInstall(); m.close(); } }, 'כבר התקנתי – להסתיר את הכפתור')]);
  }
  // compact: כפתור סמל קטן (פס עליון). אחרת: כפתור טקסט קטן (מסך כניסה)
  function installButton(compact) {
    const b = compact
      ? h('button', { class: 'btn ghost icon-btn install-btn', type: 'button', 'aria-label': 'התקנת המערכת כאפליקציה', title: 'התקנה כאפליקציה', onclick: doInstall }, icon('install'))
      : h('button', { class: 'btn sm ghost install-btn', type: 'button', onclick: doInstall }, icon('install'), 'התקנה כאפליקציה');
    b.hidden = !canInstall(); Install.btns.add(b); return b;
  }
  if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* ההתקנה פשוט לא תוצע */ }); });

  // ---------- מסך כניסה ----------
  // רקע מונפש למסך הכניסה: קווי תשתית (מים, חשמל, תקשורת, גז, ניקוז) שזורמים לאורך הפאנל, עם תחנות שמהבהבות בעדינות.
  function authBackdrop() {
    const W = 800, H = 900;
    const lines = [
      ['var(--m-water)', 'M-40 690 C 120 640, 210 520, 360 540 S 600 660, 840 560', 13],
      ['var(--m-power)', 'M-40 760 C 160 720, 260 650, 420 680 S 660 780, 840 700', 17],
      ['var(--m-telecom)', 'M-40 600 C 140 560, 250 450, 400 470 S 640 580, 840 470', 11],
      ['var(--m-gas)', 'M-40 830 C 180 800, 300 760, 460 790 S 700 860, 840 820', 19],
      ['var(--m-sewer)', 'M-40 520 C 100 500, 240 380, 380 400 S 620 500, 840 380', 15],
    ];
    const root = svg('svg', { class: 'auth-flow', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMax slice', 'aria-hidden': 'true', focusable: 'false' },
      svg('defs', null, svg('radialGradient', { id: 'af-glow', cx: '50%', cy: '50%', r: '50%' }, svg('stop', { offset: '0%', 'stop-color': '#5CC8FF', 'stop-opacity': '.35' }), svg('stop', { offset: '100%', 'stop-color': '#5CC8FF', 'stop-opacity': '0' }))),
      svg('circle', { class: 'af-glow g1', cx: 620, cy: 220, r: 260, fill: 'url(#af-glow)' }),
      svg('circle', { class: 'af-glow g2', cx: 140, cy: 420, r: 200, fill: 'url(#af-glow)' }),
      lines.map(([c, d, sp], i) => svg('g', { class: 'af-line', style: `--c: ${c}; --sp: ${sp}s; --dl: ${-i * 2.3}s` },
        svg('path', { class: 'af-base', d }), svg('path', { class: 'af-flow', d }))),
      [[360, 540], [420, 680], [400, 470], [460, 790], [380, 400], [600, 640], [640, 560]].map(([x, y], i) => svg('circle', { class: 'af-node', cx: x, cy: y, r: 6, style: `--dl: ${i * 0.7}s` })));
    return root;
  }
  function authShell(formContent, { wide = false } = {}) {
    const art = h('section', { class: 'auth-art', 'aria-label': 'אודות המערכת' }, authBackdrop(),
      h('div', { class: 'auth-art-top' }, h('span', { class: 'auth-org' }, S.org || ''),
        h('h1', null, (S.login && S.login.heading) || S.title || 'מערכת תיאום הנדסי'),
        S.login && S.login.text ? h('p', { class: 'auth-desc' }, S.login.text) : null));
    const logo = h('div', { class: 'auth-logo-wrap' }, h('img', { class: 'auth-logo', src: logoUrl(), alt: `לוגו ${S.org}` }));
    root.replaceChildren(h('div', { class: 'auth' + (wide ? ' wide' : '') }, art, h('main', { class: 'auth-form', id: 'main' }, h('div', { class: 'box' }, logo, formContent))));
  }
  function authLinks() {
    return h('div', { class: 'links' }, h('a', { href: '/accessibility.html' }, 'הצהרת נגישות'), h('a', { href: '/privacy.html' }, 'מדיניות פרטיות'), installButton(false));
  }
  // ---------- הגשת בקשה מהציבור ----------
  function applyCta() {
    const box = h('div', { class: 'apply-cta' },
      h('button', { class: 'apply-btn', type: 'button', onclick: chooseKind, 'aria-describedby': 'apply-sub' },
        h('span', { class: 'apply-ic', 'aria-hidden': 'true' }, icon('send')),
        h('span', null, h('span', { class: 'apply-title' }, 'הגשת בקשה'), h('span', { class: 'apply-sub', id: 'apply-sub' }, 'תושבים ויזמים – פתיחת בקשה לתיאום הנדסי, בלי משתמש קיים'))),
      h('div', { class: 'or-line', role: 'presentation' }, h('span', null, 'או כניסה עם משתמש קיים')));
    api('GET', '/api/public/apply-meta').then(m => { S.applyMeta = m; if (!m.enabled) box.hidden = true; }).catch(() => {});
    return box;
  }
  function chooseKind() {
    const pick = (kind) => { m.close(); location.hash = '#/apply?kind=' + kind; };
    const card = (kind, ic, title, sub) => h('button', { class: 'kind-card', type: 'button', onclick: () => pick(kind) },
      h('span', { class: 'kind-ic', 'aria-hidden': 'true' }, icon(ic)), h('span', { class: 'kind-t' }, title), h('span', { class: 'kind-s' }, sub));
    const m = modal('הגשת בקשה', h('div', null, h('p', { class: 'kind-q' }, 'האם אתה יזם או תושב/ת?'),
      h('div', { class: 'kind-grid' }, card('resident', 'home2', 'תושב/ת', 'עבודה ליד הבית, חיבור תשתית או בקשה פרטית'), card('entrepreneur', 'building', 'יזם', 'חברה, קבלן או פרויקט בנייה ותשתיות'))));
  }
  const validId = (id) => { if (!/^\d{5,9}$/.test(id)) return false; const s9 = id.padStart(9, '0'); let sum = 0; for (let i = 0; i < 9; i++) { let n = +s9[i] * ((i % 2) + 1); if (n > 9) n -= 9; sum += n; } return sum % 10 === 0; };
  const phoneOk = (p) => /^0\d{8,9}$/.test(String(p).replace(/[\s\-()]/g, '').replace(/^\+972/, '0'));
  // ---------- צפייה בקבצים בלי להוריד ----------
  const extOf = (name) => (String(name || '').split('.').pop() || '').toLowerCase();
  const VIEW_KIND = { pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', txt: 'text', csv: 'text', docx: 'office', xlsx: 'office' };
  const viewKind = (f) => VIEW_KIND[extOf(f.original_name)] || null;
  function viewBtn(f, { label = 'צפייה', cls = 'btn sm' } = {}) {
    if (!can('files.download')) return null;
    return h('button', { class: cls, type: 'button', 'aria-label': `צפייה ב${f.original_name}`, onclick: () => fileViewer(f) }, icon('eye'), label);
  }
  function fileViewer(f) {
    const kind = viewKind(f);
    const url = `/api/documents/${f.id}/view`;
    const body = h('div', { class: 'viewer-body' });
    const actions = [h('a', { class: 'btn primary', href: `/api/documents/${f.id}/download` }, icon('download'), 'הורדה'),
      ['pdf', 'image', 'text'].includes(kind) ? h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'פתיחה בלשונית חדשה') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'סגירה')].filter(Boolean);
    const m = modal(f.original_name, body, actions);
    m.dlg.classList.add('viewer-dlg');
    const fail = (msg) => body.replaceChildren(h('div', { class: 'viewer-empty' }, icon('file'), h('p', null, msg), h('a', { class: 'btn primary', href: `/api/documents/${f.id}/download` }, icon('download'), 'הורדת הקובץ')));
    if (kind === 'pdf') pdfView(body, url, f.original_name, m);
    else if (kind === 'image') body.append(h('div', { class: 'viewer-img' }, h('img', { src: url, alt: f.original_name, onerror: () => fail('לא ניתן להציג את התמונה.') })));
    else if (kind === 'text') {
      body.append(h('p', { class: 'muted', role: 'status' }, 'טוען…'));
      fetch(url, { credentials: 'same-origin' }).then(r => (r.ok ? r.text() : Promise.reject(new Error()))).then(t => body.replaceChildren(h('pre', { class: 'viewer-text', dir: 'auto' }, t.slice(0, 500000)))).catch(() => fail('לא ניתן להציג את הקובץ.'));
    } else if (kind === 'office') {
      body.append(h('p', { class: 'muted', role: 'status' }, 'טוען…'));
      api('GET', `/api/documents/${f.id}/preview`).then(p => body.replaceChildren(officeView(p))).catch(ex => fail(ex.message || 'לא ניתן להציג את הקובץ.'));
    } else fail(`אין תצוגה מקדימה לקובץ מסוג ${extOf(f.original_name).toUpperCase() || 'זה'} בדפדפן. אפשר להוריד אותו ולפתוח בתוכנה המתאימה.`);
    return m;
  }
  // PDF: מוצג בתוך המערכת עם pdf.js – עובד בכל דפדפן, גם בנייד (אנדרואיד ואייפון), וגם כשהדפדפן מוגדר להוריד PDF במקום להציג.
  // אם pdf.js לא נטען – חוזרים לתצוגה המובנית של הדפדפן
  const PDFJS_URL = '/pdfjs.mjs';
  let pdfjsLib = null;
  async function loadPdfjs() {
    if (!pdfjsLib) {
      const lib = await import(PDFJS_URL);
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs-worker.mjs';
      pdfjsLib = lib;
    }
    return pdfjsLib;
  }
  function pdfView(body, url, name, m) {
    const status = h('p', { class: 'muted', role: 'status' }, 'טוען את המסמך…');
    body.replaceChildren(status);
    let doc = null, zoom = 1, closed = false, obs = null;
    const pagesBox = h('div', { class: 'pdf-pages', tabindex: '0', 'aria-label': `תצוגת ${name}` });
    const counter = h('span', { class: 'pdf-count', 'aria-live': 'polite' });
    const zoomLbl = h('span', { class: 'pdf-zoom num' }, '100%');
    const nativeView = () => body.replaceChildren(h('iframe', { class: 'viewer-frame', src: url, title: `תצוגת ${name}` }));
    m.dlg.addEventListener('close', () => { closed = true; if (obs) obs.disconnect(); if (doc) doc.destroy(); });
    const setZoom = (z) => { zoom = Math.min(3, Math.max(0.5, Math.round(z * 4) / 4)); zoomLbl.textContent = Math.round(zoom * 100) + '%'; layout(); };
    const bar = h('div', { class: 'pdf-bar', role: 'toolbar', 'aria-label': 'שליטה בתצוגה' },
      h('button', { class: 'btn sm', type: 'button', 'aria-label': 'הקטנה', onclick: () => setZoom(zoom - 0.25) }, '−'), zoomLbl,
      h('button', { class: 'btn sm', type: 'button', 'aria-label': 'הגדלה', onclick: () => setZoom(zoom + 0.25) }, '+'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => setZoom(1) }, 'התאמה לרוחב'), counter);
    const slots = [];
    function layout() {
      // רוחב העמוד = רוחב החלון × זום. הציור עצמו מתבצע רק לעמודים שנראים במסך
      const avail = Math.max(200, pagesBox.clientWidth - 24);
      for (const sl of slots) {
        const w = Math.round(avail * zoom), hgt = Math.round(w * sl.ratio);
        sl.el.style.setProperty('width', w + 'px'); sl.el.style.setProperty('height', hgt + 'px');
        if (sl.w !== w) { sl.w = w; sl.done = false; if (sl.visible) draw(sl); }
      }
    }
    async function draw(sl) {
      if (sl.busy || sl.done || closed) return;
      sl.busy = true;
      try {
        const page = await doc.getPage(sl.n);
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        // הגבלת גודל הציור (זיכרון בטלפון)
        const scale = Math.min((sl.w / base.width) * dpr, 4096 / Math.max(base.width, base.height) * 1.5);
        const vp = page.getViewport({ scale });
        const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        cv.setAttribute('aria-hidden', 'true');
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, canvas: cv }).promise;
        if (!closed) { sl.el.replaceChildren(cv); sl.done = true; }
      } catch (e) { sl.el.replaceChildren(h('span', { class: 'muted small' }, 'לא ניתן להציג עמוד זה')); }
      finally { sl.busy = false; }
    }
    (async () => {
      try {
        const lib = await loadPdfjs();
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('http ' + res.status);
        const data = new Uint8Array(await res.arrayBuffer());
        doc = await lib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
        if (closed) { doc.destroy(); return; }
        const total = doc.numPages;
        counter.textContent = `${total} ${total === 1 ? 'עמוד' : 'עמודים'}`;
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        for (let n = 1; n <= Math.min(total, 500); n++) {
          const el = h('div', { class: 'pdf-page', role: 'img', 'aria-label': `עמוד ${n} מתוך ${total}` }, h('span', { class: 'muted small' }, `עמוד ${n}`));
          slots.push({ n, el, ratio: first.height / first.width, w: 0, done: false, visible: false, busy: false });
        }
        pagesBox.append(...slots.map(sl => sl.el));
        body.replaceChildren(bar, pagesBox);
        // יחס הגובה של כל עמוד (עמודים בגדלים שונים)
        layout();
        obs = new IntersectionObserver((ents) => {
          for (const en of ents) { const sl = slots.find(x => x.el === en.target); if (!sl) continue; sl.visible = en.isIntersecting; if (en.isIntersecting) draw(sl); }
        }, { root: pagesBox, rootMargin: '600px 0px' });
        for (const sl of slots) obs.observe(sl.el);
        new ResizeObserver(() => layout()).observe(pagesBox);
        for (const sl of slots.slice(1, 40)) doc.getPage(sl.n).then(p => { const v = p.getViewport({ scale: 1 }); const r = v.height / v.width; if (Math.abs(r - sl.ratio) > 0.01) { sl.ratio = r; sl.w = 0; layout(); } }).catch(() => {});
        if (total > 500) pagesBox.append(h('p', { class: 'muted' }, 'מוצגים 500 העמודים הראשונים. להצגה מלאה הורידו את הקובץ.'));
      } catch (e) {
        if (closed) return;
        console.warn('[pdf.js]', e && (e.message || e));
        if (e && e.name === 'PasswordException') { body.replaceChildren(h('div', { class: 'viewer-empty' }, icon('lock'), h('p', null, 'הקובץ מוגן בסיסמה. אפשר להוריד אותו ולפתוח בתוכנה המתאימה.'))); return; }
        nativeView();
      }
    })();
  }
  // Word: פסקאות וטבלאות; Excel: גיליון בכל לשונית. הכל כטקסט בלבד
  function officeView(p) {
    const table = (rows, head) => h('div', { class: 'viewer-table' }, h('table', null, h('tbody', null, rows.map((r, i) => h('tr', null, r.map(c => h(head && i === 0 ? 'th' : 'td', { dir: 'auto' }, c)))))));
    if (p.kind === 'doc') {
      const out = h('div', { class: 'viewer-doc', dir: 'auto' }, p.blocks.map(b => b.type === 'table' ? table(b.rows, false) : b.type === 'h' ? h('h' + (b.level + 1), { dir: 'auto' }, b.text) : b.text.trim() ? h('p', { dir: 'auto' }, b.text) : h('p', { class: 'blank' })));
      if (p.truncated) out.append(h('p', { class: 'muted' }, 'המסמך ארוך – מוצג החלק הראשון. להצגה מלאה הורידו את הקובץ.'));
      return out;
    }
    const wrap = h('div', { class: 'viewer-sheets' });
    const panel = h('div', { id: 'tabpanel', role: 'tabpanel' });
    const show = (i) => { const sh = p.sheets[i]; panel.replaceChildren(sh.rows.length ? table(sh.rows, true) : h('p', { class: 'muted' }, 'הגיליון ריק.'), sh.truncated ? h('p', { class: 'muted' }, 'מוצגות 1,000 השורות הראשונות.') : null); };
    if (p.sheets.length > 1) wrap.append(tabBar('גיליונות', p.sheets.map((sh, i) => [String(i), sh.name]), '0', (k) => show(Number(k))));
    wrap.append(panel); show(0);
    return wrap;
  }

  // ---------- מיקום במפת GovMap ----------
  const KG = { x: 177750, y: 613200, level: 6 };
  const govmapUrl = (loc) => loc ? `https://www.govmap.gov.il/?c=${loc.x},${loc.y}&z=${loc.z || 9}` : `https://www.govmap.gov.il/?c=${KG.x},${KG.y}&z=${KG.level}&q=${encodeURIComponent('קריית גת')}`;
  const inIsrael = (x, y) => x > 100000 && x < 300000 && y > 350000 && y < 820000;
  // קישור שהועתק מ-GovMap (…?c=X,Y&z=N) או זוג קואורדינטות "X, Y"
  function parseLocation(text) {
    const t = String(text || '').trim(); if (!t) return null;
    let x, y, z = 9;
    try {
      const u = new URL(t); const c = (u.searchParams.get('c') || '').split(/[,\s]+/).map(Number);
      if (c.length >= 2) { [x, y] = c; } const zz = Number(u.searchParams.get('z')); if (Number.isFinite(zz) && zz > 0) z = Math.min(10, zz);
    } catch { const m = t.match(/(\d{5,6}(?:\.\d+)?)\s*[,\s]\s*(\d{6}(?:\.\d+)?)/); if (m) { x = Number(m[1]); y = Number(m[2]); } }
    return Number.isFinite(x) && Number.isFinite(y) && inIsrael(x, y) ? { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z } : null;
  }
  // חלון בחירת מיקום: מפה חיה (כשהוגדר מפתח GovMap), או קישור מ-GovMap כגיבוי
  function locationDialog(current, hasMap, onSave) {
    let picked = current && current.x ? { x: current.x, y: current.y, z: current.z || 9 } : null;
    const err = errBox();
    const coords = h('p', { class: 'loc-coords', 'aria-live': 'polite' });
    const showCoords = () => { coords.textContent = picked ? `נבחר מיקום: ${Math.round(picked.x)}, ${Math.round(picked.y)} (רשת ישראל)` : 'עדיין לא סומן מיקום.'; coords.classList.toggle('ok', !!picked); };
    const label = inp('loc_label', { value: (current && current.label) || '', maxlength: 300, placeholder: 'למשל: רחוב הגפן 12, ליד הכניסה לחניון' });
    let body;
    const onMsg = (e) => {
      if (e.origin !== location.origin || !e.data || e.data.source !== 'handasa-map') return;
      if (e.data.type === 'pick' && inIsrael(e.data.x, e.data.y)) { picked = { x: e.data.x, y: e.data.y, z: e.data.z || 9 }; showCoords(); err.hidden = true; }
      if (e.data.type === 'error' && fallback) { fallback.hidden = false; }
    };
    // גיבוי: פותחים את GovMap באתר שלהם, מסמנים, ומדביקים כאן את הקישור
    const linkIn = inp('loc_link', { dir: 'ltr', placeholder: 'https://www.govmap.gov.il/?c=…', inputmode: 'url' });
    linkIn.addEventListener('input', () => { const p = parseLocation(linkIn.value); if (p) { picked = p; showCoords(); err.hidden = true; } });
    const fallback = h('div', { class: 'loc-fallback', hidden: hasMap },
      h('ol', null,
        h('li', null, h('a', { class: 'btn sm', href: govmapUrl(picked), target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'פתיחת GovMap על קריית גת'), ' (נפתח בלשונית חדשה)'),
        h('li', null, 'מזיזים את המפה כך שמקום העבודה יהיה בדיוק במרכז, ומעתיקים את הקישור מהדפדפן (או מכפתור השיתוף של GovMap).'),
        h('li', null, 'מדביקים כאן את הקישור:')),
      field('קישור מ-GovMap', linkIn, { hint: 'המערכת קוראת מהקישור את נקודת המרכז של המפה.' }));
    if (hasMap) {
      const q = new URLSearchParams({ mode: 'pick' }); if (picked) { q.set('x', picked.x); q.set('y', picked.y); q.set('z', picked.z); }
      body = h('div', { class: 'loc-frame-wrap' }, h('iframe', { class: 'loc-frame', src: '/map.html?' + q, title: 'מפת GovMap לסימון מיקום העבודה', loading: 'eager' }));
    }
    window.addEventListener('message', onMsg);
    const content = h('div', { class: 'loc-dlg' }, err, body || null, fallback, coords, field('תיאור המיקום (לא חובה)', label));
    const save = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      if (!picked) { showErr(err, hasMap ? 'יש ללחוץ על המפה במקום המדויק של העבודה.' : 'יש להדביק קישור מ-GovMap.'); return; }
      try { await onSave({ ...picked, label: label.value.trim() || null }); m.close(); } catch (ex) { showErr(err, ex.message); }
    } }, icon('pin'), 'שמירת המיקום');
    const m = modal('מיקום העבודה', content, [save, h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    m.dlg.classList.add('loc-dialog');
    m.dlg.addEventListener('close', () => window.removeEventListener('message', onMsg));
    showCoords();
    return m;
  }

  async function renderApply(kind, existingPre = false, presetUser = '') {
    if (!['resident', 'entrepreneur'].includes(kind)) { location.hash = '#/'; return; }
    const KIND = { resident: 'תושב/ת', entrepreneur: 'יזם' };
    document.title = `הגשת בקשה – ${KIND[kind]} – ${S.title}`;
    let meta = S.applyMeta; try { meta = await api('GET', '/api/public/apply-meta'); S.applyMeta = meta; } catch { /* */ }
    if (!meta || !meta.enabled) { authShell([h('h2', null, 'הגשת בקשה'), h('div', { class: 'form-error', role: 'alert' }, 'הגשת בקשות מהאתר סגורה כרגע.'), h('a', { class: 'btn', href: '#/' }, 'חזרה לכניסה')]); return; }
    const err = errBox(); let police = null;
    const typeSel = sel('type', [['', 'בחרו סוג בקשה'], ...meta.types.map(t => [t.key, t.name])], '');
    const typeHint = h('div', { class: 'hint type-hint', id: 'type-desc', 'aria-live': 'polite' });
    typeSel.setAttribute('aria-describedby', 'type-desc');
    // בבחירת סוג: התיאור, וגורמי התשתית הקבועים שיטפלו בבקשה (נכנסים אליה אוטומטית)
    typeSel.addEventListener('change', () => {
      const t = meta.types.find(x => x.key === typeSel.value) || {};
      typeHint.replaceChildren(...[t.description ? h('span', null, t.description) : null,
        t.bodies && t.bodies.length ? h('span', { class: 'type-bodies' }, h('span', null, 'גורמי התשתית שיטפלו בבקשה, לפי הסדר:'),
          h('ol', { class: 'chain-steps' }, t.bodies.map((n, i) => h('li', null, h('span', { class: 'seq', 'aria-hidden': 'true' }, String(i + 1)), n)))) : null].filter(Boolean));
    });
    const fileCard = (name, title, exts, hint) => {
      const id = 'f-' + name; const out = h('span', { class: 'file-name', 'aria-live': 'polite' }, 'לא נבחר קובץ');
      const input = h('input', { type: 'file', id, name, accept: exts.map(e => '.' + e).join(','), class: 'sr-only', required: true, 'aria-required': 'true' });
      input.addEventListener('change', () => {
        const f = input.files[0]; input.removeAttribute('aria-invalid'); card.classList.remove('bad');
        if (!f) { out.textContent = 'לא נבחר קובץ'; card.classList.remove('done'); return; }
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (!exts.includes(ext)) { out.textContent = `סוג לא מותר – רק ${exts.map(x => x.toUpperCase()).join(' / ')}`; input.value = ''; card.classList.add('bad'); card.classList.remove('done'); return; }
        if (f.size > meta.maxMb * 1048576) { out.textContent = `הקובץ גדול מ-${meta.maxMb}MB`; input.value = ''; card.classList.add('bad'); card.classList.remove('done'); return; }
        out.textContent = `${f.name} · ${fmtSize(f.size)}`; card.classList.add('done'); if (/תוכנית תוואי|בקשת עבודה/.test(err.textContent)) err.hidden = true;
      });
      const card = h('div', { class: 'file-card' }, h('span', { class: 'fc-n', 'aria-hidden': 'true' }), h('div', { class: 'fc-body' },
        h('label', { for: id, class: 'fc-title' }, title, h('span', { class: 'req-mark', 'aria-hidden': 'true' }, ' *')), h('span', { class: 'hint' }, hint), out),
        h('label', { for: id, class: 'btn sm', 'aria-hidden': 'true' }, icon('upload'), 'בחירת קובץ'), input);
      return card;
    };
    // מיקום העבודה (חובה) – מסומן במפת GovMap
    let loc = null;
    const locStatus = h('span', { class: 'loc-status' }, 'טרם סומן');
    const locText = h('span', { class: 'loc-sub' }, 'לחצו כדי לפתוח את מפת GovMap של קריית גת ולסמן את המקום המדויק');
    const locBtn = h('button', { class: 'loc-card', type: 'button', 'aria-labelledby': 'loc-lbl loc-t', onclick: () => locationDialog(loc, meta.map, (v0) => {
      loc = v0; locBtn.classList.add('done'); locBtn.classList.remove('bad'); locStatus.textContent = 'סומן';
      locText.textContent = (v0.label ? v0.label + ' · ' : '') + `נ.צ. ${Math.round(v0.x)}, ${Math.round(v0.y)}`;
      if (/מיקום/.test(err.textContent)) err.hidden = true; locBtn.focus();
    }) }, h('span', { class: 'loc-ic', 'aria-hidden': 'true' }, icon('pin')), h('span', { class: 'loc-text' }, h('span', { class: 'loc-title', id: 'loc-t' }, 'סימון מיקום במפה'), locText), locStatus);
    const polStatus = h('span', { class: 'pol-status' }, 'טרם מולא');
    const polBtn = h('button', { class: 'police-card', type: 'button', 'aria-describedby': 'pol-desc', onclick: () => policeDialog() },
      h('span', { class: 'pol-badge', 'aria-hidden': 'true' }, icon('shield')),
      h('span', { class: 'pol-text' }, h('span', { class: 'pol-title' }, 'משטרה', h('span', { class: 'pol-req' }, 'חובה')), h('span', { class: 'pol-desc', id: 'pol-desc' }, 'טופס פרטי העבודה לתיאום מול המשטרה')), polStatus);
    // "יש לי כבר שם משתמש וסיסמה במערכת" – אז שם המשתמש והסיסמה הם התחברות למשתמש הקיים, ולא נפתח משתמש חדש
    const USER_PATTERN = '[A-Za-z0-9\u05D0-\u05EA][A-Za-z0-9\u05D0-\u05EA._ \-]{1,58}[A-Za-z0-9\u05D0-\u05EA]';
    const userIn = inp('username', { maxlength: 60, autocomplete: 'username', pattern: USER_PATTERN });
    const pwIn = inp('password', { type: 'password', minlength: 12, maxlength: 128, autocomplete: 'new-password', dir: 'ltr' });
    const userField = field('שם משתמש', userIn, { required: true, hint: 'אפשר בעברית, למשל: ישראל כהן' });
    const pwField = field('סיסמה', pwIn, { required: true, hint: 'לפחות 12 תווים, אותיות וספרות.' });
    const userLegend = h('legend', null, 'משתמש לכניסה למערכת');
    const headNote = h('p', { class: 'muted' });
    const existingChk = h('label', { class: 'check existing-chk' }, h('input', { type: 'checkbox', name: 'existing', checked: existingPre }),
      h('span', null, h('strong', null, 'יש לי כבר שם משתמש וסיסמה במערכת'),
        h('span', { class: 'small muted', style: { display: 'block' } }, 'למשל אם הגשתם בעבר בקשה. הבקשה החדשה תצורף למשתמש הקיים, בלי לפתוח משתמש חדש.')));
    let contactFields = [];
    function setExisting(on) {
      userLegend.textContent = on ? 'כניסה עם המשתמש הקיים' : 'משתמש לכניסה למערכת';
      headNote.textContent = on ? 'כל השדות חובה. הזינו את שם המשתמש והסיסמה שכבר יש לכם במערכת – הבקשה תצורף אליהם, ופרטי הקשר יילקחו מהמשתמש.'
        : 'כל השדות חובה. אחרי ההגשה ייפתח לכם משתמש, ותוכלו לעקוב אחרי הבקשה עם שם המשתמש והסיסמה.';
      if (on) { userIn.removeAttribute('pattern'); pwIn.removeAttribute('minlength'); pwIn.autocomplete = 'current-password'; }
      else { userIn.setAttribute('pattern', USER_PATTERN); pwIn.setAttribute('minlength', '12'); pwIn.autocomplete = 'new-password'; }
      userField.querySelector('.hint').textContent = on ? 'שם המשתמש שאיתו אתם נכנסים למערכת.' : 'אפשר בעברית, למשל: ישראל כהן';
      pwField.querySelector('.hint').textContent = on ? 'הסיסמה הנוכחית שלכם.' : 'לפחות 12 תווים, אותיות וספרות.';
      // פרטי הקשר (אימייל, פלאפון, כתובת) כבר שמורים במשתמש – לא צריך למלא שוב
      for (const fEl of contactFields) { fEl.hidden = on; const i = fEl.querySelector('input'); i.disabled = on; if (on) i.removeAttribute('aria-invalid'); }
      err.hidden = true;
    }
    existingChk.querySelector('input').addEventListener('change', (e) => setExisting(e.target.checked));
    const emailField = field('אימייל', inp('email', { type: 'email', maxlength: 200, autocomplete: 'email', dir: 'ltr' }), { required: true, hint: 'לכאן יישלחו עדכונים ומסמך האישור.' });
    const phoneFieldEl = field('פלאפון', inp('phone', { type: 'tel', maxlength: 20, autocomplete: 'tel', dir: 'ltr', inputmode: 'tel' }), { required: true });
    const addrField = kind === 'entrepreneur'
      ? field('כתובת', inp('address', { maxlength: 300, autocomplete: 'street-address' }), { required: true, hint: 'כתובת החברה או המשרד.' })
      : field('כתובת מגורים', inp('address', { maxlength: 300, autocomplete: 'street-address' }), { required: true });
    contactFields = [emailField, phoneFieldEl, addrField];
    const form = h('form', { class: 'apply-form', novalidate: true },
      h('div', { class: 'apply-head' }, h('span', { class: 'chip fast plain' }, KIND[kind]), h('h2', null, 'הגשת בקשה לתיאום הנדסי'),
        headNote), err,
      h('div', { class: 'existing-box' }, existingChk),
      h('fieldset', null, userLegend, h('div', { class: 'row' }, userField, pwField)),
      h('fieldset', null, h('legend', null, 'פרטי הבקשה'),
        field('סוג בקשה', typeSel, { required: true }), typeHint,
        h('div', { class: 'row' }, emailField, phoneFieldEl),
        h('div', { class: 'row' }, addrField,
          field('פרויקט', inp('project', { maxlength: 200 }), { required: true, hint: 'שם הפרויקט או תיאור קצר של העבודה.' })),
        h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'loc-lbl' }, 'מיקום', h('span', { class: 'req-mark', 'aria-hidden': 'true' }, ' *'), h('span', { class: 'sr-only' }, ' (חובה)')), locBtn)),
      h('fieldset', null, h('legend', null, 'מסמכים'),
        h('div', { class: 'file-list' },
          fileCard('route_plan', 'תוכנית תוואי', meta.routeExt, 'PDF או DWF בלבד'),
          fileCard('work_request', 'בקשת עבודה', meta.workExt, 'PDF, Word או תמונה'))),
      h('fieldset', null, h('legend', null, 'משטרה'), polBtn),
      h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', null, 'אתר', h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' }))),
      h('div', { class: 'apply-actions' }, h('button', { class: 'btn primary big', type: 'submit' }, icon('send'), 'בקשה לפתיחת בקשה'), h('a', { class: 'btn ghost', href: '#/' }, 'ביטול')));
    function policeDialog() {
      const pErr = errBox(); const p = police || { id_kind: 'id', project: form.project.value, phone: form.phone.value, date: today() };
      const idInput = inp('id_number', { value: p.id_number || '', inputmode: 'numeric', maxlength: 9, dir: 'ltr', pattern: '\\d{5,9}' });
      const idLabelSpan = h('span', null, p.id_kind === 'company' ? 'ח.פ' : 'תעודת זהות');
      const kindSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'סוג מזהה' }, [['id', 'תעודת זהות'], ['company', 'ח.פ']].map(([v0, l]) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(p.id_kind === v0), 'aria-pressed': String(p.id_kind === v0), 'data-v': v0, onclick: (e) => {
          p.id_kind = v0; for (const b of kindSeg.children) { const on = b.dataset.v === v0; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); }
          idLabelSpan.textContent = l; } }, l)));
      const f2 = h('form', { class: 'police-form', novalidate: true }, pErr,
        h('div', { class: 'row' }, field('שם מבקש/ת', inp('applicant_name', { value: p.applicant_name || '', maxlength: 100 }), { required: true }),
          field('פרויקט', inp('project', { value: p.project || '', maxlength: 200 }), { required: true })),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'תעודת זהות או ח.פ', h('span', { class: 'req-mark', 'aria-hidden': 'true' }, ' *')), kindSeg),
        h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'pid' }, idLabelSpan, h('span', { class: 'req-mark', 'aria-hidden': 'true' }, ' *')), (idInput.id = 'pid', idInput.required = true, idInput)),
          field('פלאפון', inp('phone', { type: 'tel', value: p.phone || '', maxlength: 20, dir: 'ltr', inputmode: 'tel' }), { required: true })),
        field('תיאור', area('description', { value: p.description || '', maxlength: 2000, rows: 3 }), { required: true }),
        h('div', { class: 'row' }, field('זמן עבודה', inp('work_time', { value: p.work_time || '', maxlength: 200, placeholder: 'למשל: ימים א׳-ה׳' }), { required: true }),
          field('שעות עבודה', inp('work_hours', { value: p.work_hours || '', maxlength: 100, placeholder: 'למשל: 07:00-19:00', dir: 'ltr' }), { required: true })),
        field('תאריך', inp('date', { type: 'date', value: p.date || today() }), { required: true }),
        h('fieldset', { class: 'contact-fs' }, h('legend', null, 'איש קשר'),
          h('div', { class: 'row' }, field('שם מלא', inp('contact_name', { value: p.contact_name || '', maxlength: 100, autocomplete: 'off' }), { required: true }),
            field('פלאפון', inp('contact_phone', { type: 'tel', value: p.contact_phone || '', maxlength: 20, dir: 'ltr', inputmode: 'tel', autocomplete: 'off' }), { required: true }))),
        field('הערות', area('notes', { value: p.notes || '', maxlength: 2000, rows: 2 })));
      const m = modal('משטרה – פרטי העבודה', f2, [h('button', { class: 'btn primary', type: 'button', onclick: () => f2.requestSubmit() }, 'שמירת הטופס'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
      m.dlg.classList.add('police-dlg');
      f2.addEventListener('submit', (e) => {
        e.preventDefault(); if (!validate(f2, pErr)) return;
        const idn = f2.id_number.value.replace(/\D/g, '');
        if (p.id_kind === 'id' && !validId(idn)) { f2.id_number.setAttribute('aria-invalid', 'true'); f2.id_number.focus(); return showErr(pErr, 'מספר תעודת הזהות אינו תקין. בדקו את כל 9 הספרות.'); }
        if (p.id_kind === 'company' && !/^\d{9}$/.test(idn)) { f2.id_number.setAttribute('aria-invalid', 'true'); f2.id_number.focus(); return showErr(pErr, 'ח.פ חייב להיות 9 ספרות.'); }
        if (!phoneOk(f2.phone.value)) { f2.phone.setAttribute('aria-invalid', 'true'); f2.phone.focus(); return showErr(pErr, 'מספר הפלאפון אינו תקין.'); }
        if (!phoneOk(f2.contact_phone.value)) { f2.contact_phone.setAttribute('aria-invalid', 'true'); f2.contact_phone.focus(); return showErr(pErr, 'מספר הפלאפון של איש הקשר אינו תקין.'); }
        police = { ...formData(f2), id_kind: p.id_kind, id_number: idn };
        polStatus.textContent = 'מולא'; err.hidden = true; polBtn.classList.add('done'); polBtn.classList.remove('bad'); m.close(); polBtn.focus();
      });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate(form, err)) return;
      if (!form.phone.disabled && !phoneOk(form.phone.value)) { form.phone.setAttribute('aria-invalid', 'true'); form.phone.focus(); return showErr(err, 'מספר הפלאפון אינו תקין.'); }
      for (const n of ['route_plan', 'work_request']) if (!form[n].files[0]) { form.querySelector(`#f-${n}`).closest('.file-card').classList.add('bad'); form.querySelector(`label[for="f-${n}"]`).focus(); return showErr(err, `יש לצרף ${n === 'route_plan' ? 'תוכנית תוואי' : 'בקשת עבודה'}.`); }
      if (!loc) { locBtn.classList.add('bad'); locBtn.focus(); return showErr(err, 'יש לסמן את מיקום העבודה במפה.'); }
      if (!police) { polBtn.classList.add('bad'); polBtn.focus(); return showErr(err, 'יש למלא את טופס המשטרה.'); }
      const fd = new FormData();
      fd.append('kind', kind);
      const existing = form.existing.checked;
      if (existing) fd.append('existing', '1');
      for (const n of ['username', 'password', 'type', 'email', 'phone', 'address', 'project', 'website']) if (!(existing && ['email', 'phone', 'address'].includes(n))) fd.append(n, form[n].value);
      fd.append('police', JSON.stringify(police));
      fd.append('location', JSON.stringify(loc));
      fd.append('route_plan', form.route_plan.files[0]); fd.append('work_request', form.work_request.files[0]);
      const btn = form.querySelector('[type=submit]');
      try {
        const r = await submitting(btn, () => api('POST', '/api/public/apply', fd));
        S.csrf = r.csrf;
        const done = modal('הבקשה הוגשה בהצלחה', h('div', { class: 'apply-done' }, h('span', { class: 'done-ic', 'aria-hidden': 'true' }, icon('check')),
          h('p', null, 'הבקשה הוגשה בהצלחה ותעבור להמשך טיפול.'), h('p', { class: 'muted' }, 'מספר הבקשה:'), h('p', { class: 'done-num ltr' }, r.number),
          h('p', { class: 'small muted' }, 'אישור נשלח לאימייל שלכם. תקבלו עדכון בכל שלב, ובסיום – מסמך האישור.')),
          [h('button', { class: 'btn primary', type: 'button', onclick: async () => { done.close(); location.hash = `#/requests/${r.id}`; await boot(); } }, 'מעבר לבקשה')]);
      } catch (ex) { showErr(err, ex.message); err.scrollIntoView({ block: 'center' }); }
    });
    setExisting(existingPre);
    if (presetUser) userIn.value = presetUser;
    authShell([form, authLinks()], { wide: true });
  }

  function renderLogin(message) {
    document.title = 'כניסה – ' + (S.title || 'מערכת תיאום הנדסי');
    const err = errBox();
    const form = h('form', { novalidate: true },
      h('h2', null, 'כניסה למערכת'),
      message ? h('div', { class: 'form-ok', role: 'status' }, message) : null, err,
      field('שם משתמש', inp('username', { autocomplete: 'username', maxlength: 60, dir: 'auto' }), { required: true }),
      field('סיסמה', inp('password', { type: 'password', autocomplete: 'current-password', maxlength: 256, dir: 'ltr' }), { required: true }),
      h('label', { class: 'check', style: { 'margin-bottom': '4px' } }, h('input', { type: 'checkbox', name: 'remember', 'aria-describedby': 'rem-h' }), 'זכור אותי'),
      h('p', { class: 'small muted', id: 'rem-h', style: { margin: '0 0 14px' } }, 'תישארו מחוברים במכשיר הזה עד 30 יום. לא מומלץ במחשב משותף.'),
      h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'כניסה'),
      h('p', { class: 'small', style: { 'margin-top': '14px' } }, h('a', { href: '#/forgot' }, 'שכחתי סיסמה')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const btn = form.querySelector('form > button[type=submit], button.primary[type=submit]');
      try {
        await submitting(btn, async () => {
          const r = await api('POST', '/api/auth/login', formData(form));
          S.csrf = r.csrf; await boot(); if (!location.hash || location.hash === '#/forgot') location.hash = '#/';
        });
      } catch (ex) { showErr(err, ex.message); form.password.value = ''; form.password.focus(); }
    });
    authShell([applyCta(), form, authLinks()]);
  }
  function renderForgot() {
    document.title = 'שכחתי סיסמה – ' + S.title;
    const err = errBox(); const ok = h('div', { class: 'form-ok', role: 'status', hidden: true });
    const form = h('form', { novalidate: true }, h('h2', null, 'שכחתי סיסמה'),
      h('p', { class: 'muted' }, 'הבקשה תועבר למנהל המערכת, שישלח אליך קישור איפוס חד-פעמי.'), err, ok,
      field('שם משתמש', inp('username', { autocomplete: 'username', dir: 'ltr', maxlength: 60 }), { required: true }),
      h('button', { class: 'btn primary', type: 'submit' }, 'שליחת בקשה'), ' ', h('a', { class: 'btn ghost', href: '#/' }, 'חזרה לכניסה'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { const r = await submitting(form.querySelector('[type=submit]'), () => api('POST', '/api/auth/forgot', formData(form))); ok.textContent = r.message; ok.hidden = false; }
      catch (ex) { showErr(err, ex.message); }
    });
    authShell([form, authLinks()]);
  }
  function renderReset(token) {
    document.title = 'איפוס סיסמה – ' + S.title;
    const err = errBox();
    const form = h('form', { novalidate: true }, h('h2', null, 'בחירת סיסמה חדשה'), err,
      field('סיסמה חדשה', inp('password', { type: 'password', autocomplete: 'new-password', minlength: 12, maxlength: 128, dir: 'ltr' }), { required: true, hint: 'לפחות 12 תווים, אותיות וספרות.' }),
      field('אימות סיסמה', inp('confirm', { type: 'password', autocomplete: 'new-password', minlength: 12, maxlength: 128, dir: 'ltr' }), { required: true }),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירת סיסמה'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      if (form.password.value !== form.confirm.value) return showErr(err, 'הסיסמאות אינן זהות.');
      try {
        await submitting(form.querySelector('[type=submit]'), () => api('POST', '/api/auth/reset', { token, password: form.password.value }));
        history.replaceState(null, '', '/#/'); renderLogin('הסיסמה עודכנה. אפשר להיכנס.');
      } catch (ex) { showErr(err, ex.message); }
    });
    authShell([form, authLinks()]);
  }
  function renderMustChange() {
    const err = errBox();
    const form = h('form', { novalidate: true }, h('h2', null, 'החלפת סיסמה ראשונית'),
      h('p', { class: 'muted' }, 'מטעמי אבטחה יש לבחור סיסמה אישית לפני תחילת העבודה.'), err,
      field('סיסמה נוכחית', inp('current', { type: 'password', autocomplete: 'current-password', dir: 'ltr' }), { required: true }),
      field('סיסמה חדשה', inp('next', { type: 'password', autocomplete: 'new-password', minlength: 12, maxlength: 128, dir: 'ltr' }), { required: true, hint: 'לפחות 12 תווים, אותיות וספרות.' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירה והמשך'), ' ', h('button', { class: 'btn ghost', type: 'button', onclick: logout }, 'יציאה'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { const r = await submitting(form.querySelector('[type=submit]'), () => api('POST', '/api/auth/change-password', formData(form))); S.csrf = r.csrf; await boot(); }
      catch (ex) { showErr(err, ex.message); }
    });
    authShell([form, authLinks()]);
  }
  async function logout() {
    try { await api('POST', '/api/auth/logout', {}); } catch { /* ממשיכים */ }
    S.me = null; S.csrf = null; S.perms = new Set(); location.hash = '#/'; renderLogin('התנתקת מהמערכת.');
  }

  // ---------- מעטפת האפליקציה ----------
  // הלשוניות של לוח הבקרה לניהול (כל לשונית מוצגת רק למי שיש לו הרשאה אליה)
  const ADMIN_TABS = [
    ['users', 'משתמשים', 'users', ['admin.users']],
    ['roles', 'תפקידים והרשאות', 'key', ['admin.roles']],
    ['types', 'סוגי בקשות', 'layers', ['admin.settings']],
    ['settings', 'הגדרות וקבצים', 'sliders', ['admin.settings']],
    ['audit', 'יומן אבטחה', 'shield', ['admin.audit']],
    ['backups', 'גיבויים', 'db', ['admin.backup']]];
  const adminTabs = () => ADMIN_TABS.filter(t => t[3].some(can));
  const ADMIN_VIEWS = { users: viewAdminUsers, roles: viewAdminRoles, types: viewAdminTypes, settings: viewAdminSettings, audit: viewAdminAudit, backups: viewAdminBackups };
  // עוטף מסך ניהול: שורת לשוניות (קישורים) מעל, והמסך עצמו מתחת
  function adminPage(key0, view0) {
    return async (main, q, id, path) => {
      const tabs = adminTabs();
      let key = key0, view = view0;
      if (!tabs.length) { location.hash = '#/'; return; }
      // כניסה ל"לוח בקרה לניהול" עצמו (או ללשונית בלי הרשאה) – פותחים את הלשונית הראשונה המותרת
      if (!tabs.some(t => t[0] === key)) {
        key = tabs[0][0]; view = ADMIN_VIEWS[key];
        try { history.replaceState(null, '', '#/admin/' + key); } catch { /* */ }
      }
      const strip = h('nav', { class: 'admin-tabs', 'aria-label': 'לוח בקרה לניהול' },
        h('span', { class: 'admin-tabs-title' }, icon('sliders'), 'לוח בקרה לניהול'),
        h('div', { class: 'admin-tabs-row' }, tabs.map(([k, label, ic]) => h('a', { href: '#/admin/' + k, class: 'admin-tab', ...(k === key ? { 'aria-current': 'page' } : {}) }, icon(ic), h('span', null, label)))));
      const body = safeHost(h('div', { class: 'admin-body' }, h('p', { class: 'muted', role: 'status' }, 'טוען…')));
      main.replaceChildren(strip, body);
      // בנייד: גוללים את שורת הלשוניות כך שהלשונית הפעילה תיראה
      const row = strip.querySelector('.admin-tabs-row'), cur = strip.querySelector('[aria-current]');
      const rr = row.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      if (cr.left < rr.left) row.scrollLeft -= rr.left - cr.left + 8; else if (cr.right > rr.right) row.scrollLeft += cr.right - rr.right + 8;
      await view(body, q, id, path);
    };
  }
  const NAV = [
    { g: null, items: [['#/', 'דף הבית', 'home', null]] },
    { g: 'בקשות תיאום', items: [
      ['#/requests?scope=pending_me', 'ממתין לטיפולי', 'inbox', ['requests.view_own', 'requests.view_all', 'approvals.decide']],
      ['#/requests?scope=mine', 'הבקשות שלי', 'file', ['requests.view_own']],
      ['#/requests?scope=all', 'כל הבקשות', 'layers', ['requests.view_all']]] },
    { g: 'ניהול עבודה', hide: 'public', items: [
      ['#/tasks', 'משימות', 'task', ['tasks.view']],
      ['#/reports', 'דוחות וגרפים', 'chart', null],
      ['#/documents', 'מסמכים', 'folder', null]] },
    // לוח בקרה לניהול: פריט אחד בתפריט, ובתוכו המסכים כלשוניות
    { g: 'ניהול', items: [['#/admin', 'לוח בקרה לניהול', 'sliders', ADMIN_TABS.flatMap(t => t[3])]] },
    { g: 'אישי', items: [['#/appearance', 'עיצוב ותצוגה', 'palette', null], ['#/account', 'החשבון שלי', 'user', null]] },
  ];
  // מגישים מהציבור (תושב/ת, יזם) ומנהל המערכת רואים תפריט מצומצם
  const isPublicUser = () => !!(S.me && S.me.applicant_kind);
  const isSysUser = () => !!(S.me && S.me.is_sysadmin);
  const hiddenFor = (who) => !!who && ((who.includes('public') && isPublicUser()) || (who.includes('sys') && isSysUser()));
  // טקסט הסבר בשדה (placeholder) שמתאים את עצמו לרוחב: הנוסח הארוך ביותר שנכנס בלי להיחתך.
  // הנוסח המלא נשאר ב-title ובתווית, כך שלא הולך מידע לאיבוד
  const fitCtx = document.createElement('canvas').getContext('2d');
  function fitPlaceholder(input, options) {
    const fit = () => {
      const cs = getComputedStyle(input); const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 6;
      if (room <= 0) return;
      fitCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      input.placeholder = options.find(t => fitCtx.measureText(t).width <= room) || options[options.length - 1];
    };
    if (!input.title) input.title = options[0];
    input.placeholder = options[options.length - 1];
    if ('ResizeObserver' in window) new ResizeObserver(() => fit()).observe(input);
    requestAnimationFrame(fit); setTimeout(fit, 300);
    return fit;
  }
  // אזור תוכן שמתעלם מחלקים ריקים (null) – כדי שלא יוצג הטקסט "null" במסך
  function safeHost(el) {
    el.replaceChildren = (...kids) => Element.prototype.replaceChildren.call(el, ...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));
    return el;
  }
  let shell = null;
  function renderShell() {
    const nav = h('nav', { class: 'nav', 'aria-label': 'ניווט ראשי' });
    for (const grp of NAV) {
      if (hiddenFor(grp.hide)) continue;
      const items = grp.items.filter(([, , , perms, hide]) => (!perms || perms.some(can)) && !hiddenFor(hide));
      if (!items.length) continue;
      if (grp.g) nav.append(h('div', { class: 'nav-group', role: 'presentation' }, grp.g));
      for (const [href, label, ic, , , children] of items) {
        if (!children) { nav.append(h('a', { href, 'data-href': href, title: label }, icon(ic), h('span', { class: 'lbl' }, label))); continue; }
        // תיקייה שנפתחת ונסגרת (המצב נזכר בדפדפן)
        const key = 'nav-open:' + href; let open = location.hash.startsWith(href);
        try { const v = localStorage.getItem(key); if (v !== null) open = v === '1' || open; } catch { /* */ }
        const subId = 'sub-' + href.replace(/\W/g, '');
        const sub = h('div', { class: 'nav-sub', id: subId, hidden: !open }, children.map(([ch, cl]) => h('a', { href: ch, 'data-href': ch, title: cl }, h('span', { class: 'lbl' }, cl))));
        const btn = h('button', { type: 'button', class: 'nav-folder', 'aria-expanded': String(open), 'aria-controls': subId, title: label, onclick: () => {
          const now = btn.getAttribute('aria-expanded') !== 'true';
          btn.setAttribute('aria-expanded', String(now)); sub.hidden = !now; btn.querySelector('.nf-ic').replaceChildren(icon(now ? 'folderOpen' : 'folder'));
          try { localStorage.setItem(key, now ? '1' : '0'); } catch { /* */ }
        } }, h('span', { class: 'nf-ic' }, icon(open ? 'folderOpen' : 'folder')), h('span', { class: 'lbl' }, label), h('span', { class: 'nf-chev', 'aria-hidden': 'true' }, icon('chevron')));
        nav.append(btn, sub);
      }
    }
    const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'תפריט' },
      h('a', { class: 'brand has-logo', href: '#/', 'aria-label': `${S.title} – מעבר לדף הבית`, title: 'לדף הבית' },
        h('img', { class: 'brand-mark custom', src: logoUrl(), alt: '' }),
        h('div', { class: 'brand-text', 'aria-hidden': 'true' }, h('div', { class: 'brand-title' }, S.title), h('div', { class: 'brand-org' }, S.org))),
      nav, h('div', { class: 'side-foot' }, h('a', { href: '/accessibility.html' }, 'הצהרת נגישות'), h('a', { href: '/privacy.html' }, 'פרטיות')));
    const bellCount = h('span', { class: 'badge-dot', hidden: !S.unread }, String(S.unread || ''));
    const bell = h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'התראות', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => toggleNotifs(bell, bellCount) }, icon('bell'), bellCount);
    const menuBtn = h('button', { class: 'btn ghost icon-btn menu-btn', type: 'button', 'aria-label': 'פתיחת תפריט', 'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: () => toggleSidebar(true) }, icon('menu'));
    // חיפוש עליון: טקסט ההסבר מתאים את עצמו לרוחב השדה, כדי שלא ייחתך
    const gsearch = h('input', { id: 'gsearch', name: 'q', type: 'search', maxlength: 100, title: 'חיפוש לפי מספר בקשה, נושא או כתובת', placeholder: 'חיפוש בקשה' });
    const fitPh = fitPlaceholder(gsearch, ['חיפוש לפי מספר בקשה, נושא או כתובת', 'חיפוש לפי מספר, נושא או כתובת', 'חיפוש מספר, נושא או כתובת', 'חיפוש בקשה', 'חיפוש']);
    const top = h('header', { class: 'topbar' }, menuBtn,
      h('form', { role: 'search', class: 'grow', onsubmit: (e) => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = '#/requests?scope=' + (can('requests.view_all') ? 'all' : 'mine') + (q ? '&q=' + encodeURIComponent(q) : ''); } },
        h('label', { for: 'gsearch', class: 'sr-only' }, 'חיפוש בקשה'),
        gsearch),
      h('div', { class: 'spacer' }), clockEl(), installButton(true), bell, userCard(),
      h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'יציאה מהמערכת', title: 'יציאה', onclick: logout }, icon('out')));
    const main = safeHost(h('main', { class: 'content', id: 'main', tabindex: '-1' }));
    const footer = h('footer', { class: 'footer' }, h('span', null, `© ${new Date().getFullYear()} ${S.org}`),
      h('a', { href: '/accessibility.html' }, 'הצהרת נגישות'), h('a', { href: '/privacy.html' }, 'מדיניות פרטיות'));
    root.replaceChildren(h('div', { class: 'app' }, sidebar, h('div', { class: 'main' }, top, main, footer)));
    shell = { main, nav, sidebar, menuBtn };
    fitPh(); setTimeout(fitPh, 400); if (!renderShell.rz) { renderShell.rz = true; window.addEventListener('resize', () => { const g = document.getElementById('gsearch'); if (g && g.fitPh) g.fitPh(); }); }
    gsearch.fitPh = fitPh;
  }
  // שעון ותאריך בפס העליון – מתעדכן כל דקה (בלי הכרזות לקורא מסך בכל עדכון)
  let clockTimer = null;
  function clockEl() {
    const time = h('span', { class: 'clock-time num' }); const date = h('span', { class: 'clock-date' });
    const el = h('time', { class: 'clock', title: '' }, time, date);
    const tick = () => {
      const d = new Date();
      time.textContent = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      date.textContent = d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      el.setAttribute('datetime', d.toISOString()); el.setAttribute('aria-label', `${date.textContent}, השעה ${time.textContent}`);
    };
    tick();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(() => { if (!el.isConnected) { clearInterval(clockTimer); clockTimer = null; return; } tick(); }, 15000);
    return el;
  }
  // כרטיס המשתמש המחובר: ראשי תיבות, שם בולט במסגרת, תפקיד וגורם תשתית
  function userCard() {
    const u = S.me; const parts = u.full_name.trim().split(/\s+/);
    const initials = (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    const sub = [u.role_name, u.infra_name].filter(Boolean).join(' · ');
    return h('a', { class: 'user-card', href: '#/account', title: 'החשבון שלי', 'aria-label': `מחובר: ${u.full_name}${sub ? ', ' + sub : ''}. מעבר לחשבון שלי` },
      h('span', { class: 'uc-avatar', 'aria-hidden': 'true' }, initials),
      h('span', { class: 'uc-text', 'aria-hidden': 'true' }, h('span', { class: 'uc-name' }, u.full_name),
        h('span', { class: 'uc-role' }, u.role_name || ''), u.infra_name ? h('span', { class: 'uc-infra' }, h('i', { class: 'mark ' + markClass(u.infra_name) }), u.infra_name) : null));
  }
  function toggleSidebar(open) {
    const { sidebar, menuBtn } = shell;
    sidebar.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open));
    document.querySelector('.scrim')?.remove();
    if (open) {
      document.body.append(h('div', { class: 'scrim', onclick: () => toggleSidebar(false) }));
      sidebar.querySelector('a')?.focus();
      sidebar.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { toggleSidebar(false); menuBtn.focus(); sidebar.removeEventListener('keydown', esc); } });
    }
  }
  async function toggleNotifs(btn, count) {
    const existing = document.getElementById('notif-pop');
    if (existing) { existing.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    const pop = h('div', { class: 'popover', id: 'notif-pop', role: 'region', 'aria-label': 'התראות' }, h('p', { class: 'empty' }, 'טוען…'));
    btn.parentElement.append(pop); btn.setAttribute('aria-expanded', 'true');
    const close = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { pop.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close));
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pop.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
    try {
      const { items } = await api('GET', '/api/notifications');
      pop.replaceChildren(...(items.length ? items.map(n => h('a', { class: 'n' + (n.read ? '' : ' unread'), href: safeHash(n.link) }, n.text, h('small', null, fmtDateTime(n.created_at)))) : [h('p', { class: 'empty' }, 'אין התראות חדשות.')]));
      pop.querySelector('a')?.focus();
      if (items.some(n => !n.read)) { await api('POST', '/api/notifications/read', {}); S.unread = 0; count.hidden = true; }
    } catch (ex) { pop.replaceChildren(h('p', { class: 'empty' }, ex.message)); }
  }
  const safeHash = (l) => (typeof l === 'string' && /^#\/[\w/?=&-]*$/.test(l) ? l : '#/');

  // ---------- ניתוב ----------
  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    return { path, q: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  const ROUTES = [
    [/^\/$/, viewDashboard], [/^\/requests$/, viewRequests], [/^\/requests\/(\d+)$/, viewRequest],
    [/^\/requests\/(\d+)\/edit$/, viewRequestForm], [/^\/tasks$/, viewTasks],
    [/^\/reports$/, viewReports], [/^\/documents$/, viewDocuments], [/^\/appearance$/, viewAppearance],
    [/^\/account$/, viewAccount], [/^\/admin\/?$/, adminPage('', null)],
    [/^\/admin\/users$/, adminPage('users', viewAdminUsers)], [/^\/admin\/roles$/, adminPage('roles', viewAdminRoles)], [/^\/admin\/settings$/, adminPage('settings', viewAdminSettings)], [/^\/admin\/types$/, adminPage('types', viewAdminTypes)],
    [/^\/admin\/audit$/, adminPage('audit', viewAdminAudit)], [/^\/admin\/backups$/, adminPage('backups', viewAdminBackups)],
  ];
  async function route() {
    const { path, q } = parseHash();
    if (path === '/reset') return renderReset(q.token || '');
    // תושב/ת או יזם מחובר שלוחץ על "הגשת בקשה חדשה": יוצאים מהחשבון ופותחים את טופס ההגשה עם המשתמש הקיים (שם המשתמש כבר ממולא)
    if (S.me && path === '/apply' && isPublicUser()) {
      const kind0 = ['resident', 'entrepreneur'].includes(q.kind) ? q.kind : S.me.applicant_kind; const uname = S.me.username;
      try { await api('POST', '/api/auth/logout', {}); } catch { /* ממשיכים */ }
      S.me = null; S.csrf = null; S.perms = new Set(); shell = null;
      return renderApply(kind0, true, uname);
    }
    if (!S.me) return path === '/forgot' ? renderForgot() : path === '/apply' ? renderApply(q.kind, q.existing === '1') : renderLogin();
    if (S.me.must_change_pw) return renderMustChange();
    if (!shell || !document.body.contains(shell.main)) renderShell();
    toggleSidebar(false);
    const full = location.hash || '#/';
    for (const a of shell.nav.querySelectorAll('a')) {
      const href = a.dataset.href;
      const active = href === full || (href !== '#/' && full.startsWith(href) && !/^#\/requests\?/.test(href)) || (href === '#/' && full === '#/');
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (isPublicUser() && /^\/(tasks|reports|documents)/.test(path)) { location.hash = '#/'; return; }
    const main = shell.main;
    main.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'טוען…'));
    for (const [re, fn] of ROUTES) {
      const m = path.match(re);
      if (m) {
        try { await fn(main, q, m[1] ? Number(m[1]) : undefined, path); }
        catch (ex) { if (ex.message !== 'נדרשת התחברות') main.replaceChildren(pageHead('שגיאה'), h('div', { class: 'form-error', role: 'alert' }, ex.message), h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')); }
        const h1 = main.querySelector('h1');
        document.title = (h1 ? h1.textContent + ' – ' : '') + S.title;
        main.focus({ preventScroll: true }); window.scrollTo(0, 0);
        return;
      }
    }
    main.replaceChildren(pageHead('העמוד לא נמצא', 'הכתובת אינה קיימת במערכת.'), h('a', { class: 'btn primary', href: '#/' }, 'חזרה לדף הבית'));
    document.title = 'העמוד לא נמצא – ' + S.title;
  }
  function pageHead(title, sub, ...actions) {
    return h('div', { class: 'page-head' }, h('h1', null, title), actions.length ? h('div', { class: 'actions' }, actions) : null, sub ? h('p', { class: 'sub' }, sub) : null);
  }
  function tableOf(cols, rows, { onRow, empty, caption, stack = true } = {}) {
    if (!rows.length) return h('div', { class: 'table-wrap' }, empty || h('p', { class: 'empty' }, 'אין נתונים להצגה.'));
    return h('div', { class: 'table-wrap' + (stack ? ' stack' : '') }, h('table', null,
      caption ? h('caption', { class: 'sr-only' }, caption) : null,
      h('thead', null, h('tr', null, cols.map(c => h('th', { scope: 'col' }, c.label)))),
      h('tbody', null, rows.map(r => h('tr', { class: onRow ? 'clickable' : null, onclick: onRow ? (e) => { if (!e.target.closest('a,button,input,select')) onRow(r); } : null },
        cols.map(c => { const v = c.render ? c.render(r) : (r[c.key] ?? '—'); return h('td', { 'data-l': c.label, class: c.cls || null }, v); }))))));
  }

  // ======================================================================
  // גרפים (SVG ללא ספריות): קו, טבעת, עמודות, עמודות מוערמות, תקציב, מד עמידה ביעד.
  // כל גרף: כותרת, טולטיפ בעכבר ובמקלדת, מקרא, ותצוגת טבלה נגישה.
  // ======================================================================
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      // CSP חוסם מאפיין style בטקסט – מגדירים דרך CSSOM
      if (k === 'style') { for (const decl of String(v).split(';')) { const i = decl.indexOf(':'); if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim()); } }
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat(Infinity)) { if (kid === null || kid === undefined || kid === false) continue; el.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
    return el;
  }
  let chartSeq = 0;
  const CAT = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
  const nf = new Intl.NumberFormat('he-IL');
  const compactMoney = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const texOn = () => document.documentElement.dataset.chartTexture === 'on';
  function texDefs(id) {
    // מרקם קווים אלכסוניים – ערוץ נוסף מלבד צבע (עיוורון צבעים / הדפסה)
    return svg('defs', null, [45, 135, 0, 90, 45].map((a, i) => svg('pattern', { id: `${id}-tx${i}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: `rotate(${a})` },
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--surface)', 'stroke-width': i === 4 ? 1 : 2, 'stroke-opacity': .7 }))));
  }
  const texFill = (id, i) => texOn() ? `url(#${id}-tx${i % 5})` : null;
  function niceMax(v) { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('he-IL', { month: 'short', timeZone: 'UTC' }) + ` ${String(y).slice(2)}`; }

  function chartFrame({ title, sub, wide, table, csv }, body, legend) {
    const id = 'ch' + (++chartSeq);
    const tip = h('div', { class: 'chart-tip', hidden: true, 'aria-hidden': 'true' });
    const tblBox = h('div', { class: 'tbl-wrap', id: id + '-tbl', hidden: true });
    if (table) tblBox.append(h('table', null, h('caption', { class: 'sr-only' }, title),
      h('thead', null, h('tr', null, table.head.map(x => h('th', { scope: 'col' }, x)))),
      h('tbody', null, table.rows.map(r => h('tr', null, r.map((c, i) => i === 0 ? h('th', { scope: 'row' }, c) : h('td', { class: 'num' }, c)))))));
    const toggle = table ? h('button', { class: 'btn sm ghost', type: 'button', 'aria-expanded': 'false', 'aria-controls': id + '-tbl', onclick: (e) => {
      const open = tblBox.hidden; tblBox.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open)); e.currentTarget.textContent = open ? 'הסתרת טבלה' : 'הצגה כטבלה'; } }, 'הצגה כטבלה') : null;
    const csvBtn = csv ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => downloadCsv(csv.name, table.head, table.rows) }, icon('download'), h('span', { class: 'sr-only' }, 'ייצוא '), 'CSV') : null;
    const fig = h('figure', { class: 'chart' + (wide ? ' wide' : ''), 'aria-labelledby': id + '-t' },
      h('div', { class: 'chart-head' }, h('div', null, h('h3', { id: id + '-t' }, title), sub ? h('p', { class: 'sub' }, sub) : null), toggle, csvBtn),
      body, legend || null, tblBox, tip);
    // טולטיפ: עכבר ומקלדת
    const show = (el, x, y) => {
      const [t, ...lines] = el.getAttribute('data-tip').split('\n');
      tip.replaceChildren(h('b', null, t), ...lines.map(l => h('div', null, l)));
      tip.hidden = false;
      const fr = fig.getBoundingClientRect();
      const left = Math.min(Math.max(x - fr.left, 80), fr.width - 80);
      tip.style.left = left + 'px'; tip.style.top = (y - fr.top) + 'px';
      const g = el.closest('svg'); if (g) { g.classList.add('dim'); g.querySelectorAll(`[data-k="${el.dataset.k}"]`).forEach(m => m.classList.add('hot')); }
      if (el.dataset.col !== undefined && g) g.querySelectorAll('[data-colshow]').forEach(c => { c.style.visibility = c.dataset.colshow === el.dataset.col ? 'visible' : 'hidden'; });
    };
    const hide = () => { tip.hidden = true; fig.querySelectorAll('svg.dim').forEach(g => g.classList.remove('dim')); fig.querySelectorAll('.hot').forEach(m => m.classList.remove('hot')); fig.querySelectorAll('[data-colshow]').forEach(c => { c.style.visibility = 'hidden'; }); };
    fig.addEventListener('pointermove', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); });
    fig.addEventListener('pointerleave', hide);
    fig.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (!el) return; const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    fig.addEventListener('focusout', hide);
    fig.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    return fig;
  }
  function downloadCsv(name, head, rows) {
    const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = '﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `${name}-${today()}.csv` });
    document.body.append(a); a.click(); a.remove();
  }
  function legendList(items) {
    return h('ul', { class: 'legend', 'aria-label': 'מקרא' }, items.map(it => h('li', null, h('i', { style: { background: it.color } }), it.label,
      it.value !== undefined ? h('span', { class: 'lv' }, it.value) : null, it.pct !== undefined ? h('span', { class: 'lp' }, `(${it.pct}%)`) : null)));
  }
  function emptyChart(opts, text) { return chartFrame(opts, h('p', { class: 'chart-empty' }, text || 'אין עדיין נתונים לתקופה שנבחרה.')); }

  // ---- עזרים: ציור ברוחב האמיתי (טקסט נשאר 12px בכל גודל) וטקסט עברי תקין ----
  function responsive(draw, guess = 600) {
    const box = h('div', { class: 'svg-box' });
    let w = 0;
    box.append(draw(guess));
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver((entries) => {
        if (!box.isConnected) { ro.disconnect(); return; }
        const nw = Math.round(entries[0].contentRect.width);
        if (nw && Math.abs(nw - w) > 8) { w = nw; box.replaceChildren(draw(Math.max(nw, 260))); }
      });
      ro.observe(box);
    }
    return box;
  }
  // align: 'right' = הקצה הימני של הטקסט ב-x, 'left' = הקצה השמאלי ב-x, 'middle' = ממורכז. הטקסט עצמו תמיד בכיוון עברי
  function txt(x, y, side, content, cls) {
    return svg('text', { x, y, 'text-anchor': side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle', class: cls || null, style: 'direction: rtl; unicode-bidi: plaintext' }, content);
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // ---- גרף קו: מגמה לאורך זמן (ציר הזמן מימין לשמאל, כמו בכל הממשק) ----
  function lineChart(opts, labels, series) {
    if (!labels.length || series.every(s => s.values.every(v => !v))) return emptyChart(opts);
    const max = niceMax(Math.max(...series.flatMap(s => s.values)));
    const n = labels.length;
    const draw = (W) => {
      const H = 240, pt = 14, pb = 30, pr = 36, pl = 78;
      const step = (W - pr - pl) / Math.max(n - 1, 1);
      const X = (i) => W - pr - i * step; const Y = (v) => pt + (H - pt - pb) * (1 - v / max);
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${opts.title}: ${series.map(s => `${s.name} – סה"כ ${s.values.reduce((a, b) => a + b, 0)}`).join(', ')}` });
      for (let t = 0; t <= 4; t++) { const v = max / 4 * t; root.append(svg('line', { class: t ? 'gridline' : 'axis', x1: pl, x2: W - pr, y1: Y(v), y2: Y(v) }), txt(W - pr + 8, Y(v) + 4, 'left', nf.format(v))); }
      const minGap = 58; let lastX = -Infinity; // מתחילים מהחודש האחרון כדי שתמיד יופיע
      for (let i = n - 1; i >= 0; i--) { const x = X(i); if (x - lastX >= minGap) { root.append(txt(x, H - 8, 'middle', monthLabel(labels[i]))); lastX = x; } }
      series.forEach((s, si) => {
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
        if (si === 0) root.append(svg('path', { class: 'area fade', d: `${d} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)} Z`, fill: s.color }));
        root.append(svg('path', { class: 'line draw mark', 'data-k': 's' + si, d, stroke: s.color, style: '--len: 3000' }));
      });
      // תוויות ישירות בקצה הקו, בהיסט כדי שלא יתנגשו
      const ends = series.map(s => ({ y: Y(s.values[n - 1]), s })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
      for (const e of ends) root.append(txt(X(n - 1) - 8, e.y + 4, 'right', `${e.s.name} ${e.s.values[n - 1]}`, 'v'));
      labels.forEach((l, i) => root.append(svg('g', { 'data-colshow': i, style: 'visibility: hidden' }, svg('line', { class: 'cross', x1: X(i), x2: X(i), y1: pt, y2: H - pb }),
        series.map(s => svg('circle', { class: 'dot', cx: X(i), cy: Y(s.values[i]), r: 5, fill: s.color })))));
      labels.forEach((l, i) => {
        const w = Math.max(step, 12);
        root.append(svg('rect', { class: 'hit', x: X(i) - w / 2, y: pt, width: w, height: H - pt - pb, tabindex: 0, 'data-col': i,
          'data-tip': [monthLabel(l), ...series.map(s => `${s.name}: ${s.values[i]}`)].join('\n'), 'aria-label': `${monthLabel(l)}: ${series.map(s => `${s.name} ${s.values[i]}`).join(', ')}` }));
      });
      return root;
    };
    const legend = legendList(series.map(s => ({ label: s.name, color: s.color })));
    return chartFrame({ ...opts, table: { head: ['חודש', ...series.map(s => s.name)], rows: labels.map((l, i) => [monthLabel(l), ...series.map(s => s.values[i])]) } }, responsive(draw), legend);
  }

  // ---- טבעת: חלוקה לקטגוריות ----
  function donutChart(opts, items, centerLabel) {
    items = items.filter(i => i.value > 0);
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) return emptyChart(opts);
    if (items.length > 5) { const rest = items.slice(4).reduce((a, b) => a + b.value, 0); items = [...items.slice(0, 4), { label: 'אחר', value: rest }]; }
    const S = 200, c = S / 2, R = 88, r = 58; const id = 'dc' + (++chartSeq);
    const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', class: 'donut', 'aria-label': `${opts.title}: ${items.map(i => `${i.label} ${i.value}`).join(', ')}` }, texDefs(id));
    let a0 = -Math.PI / 2;
    const pt2 = (a, rad) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
    items.forEach((it, i) => {
      let a1 = a0 + (it.value / total) * Math.PI * 2; if (items.length === 1) a1 -= 0.0001;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt2(a0, R), [x1, y1] = pt2(a1, R), [x2, y2] = pt2(a1, r), [x3, y3] = pt2(a0, r);
      const d = `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
      const color = it.color || CAT[i];
      root.append(svg('path', { class: 'seg mark fade', 'data-k': 'k' + i, d, fill: color, 'data-tip': `${it.label}\n${nf.format(it.value)} (${pct(it.value, total)}%)`, tabindex: 0, 'aria-label': `${it.label}: ${it.value}` }));
      if (texFill(id, i)) root.append(svg('path', { d, fill: texFill(id, i), 'pointer-events': 'none' }));
      a0 = a1;
    });
    root.append(txt(c, c + 6, 'middle', nf.format(total), 'hero'), txt(c, c + 26, 'middle', centerLabel || 'סה"כ'));
    const legend = legendList(items.map((it, i) => ({ label: it.label, color: it.color || CAT[i], value: nf.format(it.value), pct: pct(it.value, total) })));
    return chartFrame({ ...opts, table: { head: ['קטגוריה', 'כמות', 'אחוז'], rows: items.map(it => [it.label, it.value, pct(it.value, total) + '%']) } }, h('div', { class: 'hero-row' }, root, legend));
  }

  // ---- עמודות אופקיות (גודל, גוון אחד) – העמודה יוצאת מימין ----
  function hbarPath(xr, w, y, hh, rad) { const x = xr - w; rad = Math.min(rad, w / 2, hh / 2); return `M${xr},${y} H${x + rad} Q${x},${y} ${x},${y + rad} V${y + hh - rad} Q${x},${y + hh} ${x + rad},${y + hh} H${xr} Z`; }
  function barChart(opts, items, { fmt = (v) => nf.format(v) } = {}) {
    if (!items.length || items.every(i => !i.value)) return emptyChart(opts);
    const max = Math.max(...items.map(i => i.value));
    const draw = (W) => {
      const row = 34, lw = Math.min(150, W * 0.34), vw = 48, H = items.length * row + 6;
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${opts.title}: ${items.map(i => `${i.label} ${fmt(i.value)}`).join(', ')}` });
      const xr = W - lw; const span = W - lw - vw;
      items.forEach((it, i) => {
        const y = i * row + 6; const w = max ? Math.max(it.value / max * span, it.value ? 3 : 0) : 0;
        root.append(txt(W - 2, y + 15, 'right', clip(it.label, Math.floor(lw / 7.5))));
        root.append(svg('path', { class: 'mark grow h', 'data-k': 'b' + i, d: hbarPath(xr - 8, w, y + 3, row - 14, 4), fill: it.color || 'var(--s1)' }));
        root.append(txt(xr - 8 - w - 6, y + 15, 'right', fmt(it.value), 'v'));
        root.append(svg('rect', { class: 'hit', x: 0, y, width: W, height: row - 4, tabindex: 0, 'data-k': 'b' + i, 'data-tip': `${it.label}\n${fmt(it.value)}`, 'aria-label': `${it.label}: ${fmt(it.value)}` }));
      });
      root.append(svg('line', { class: 'axis', x1: xr - 8, x2: xr - 8, y1: 0, y2: H }));
      return root;
    };
    return chartFrame({ ...opts, table: { head: ['', 'ערך'], rows: items.map(i => [i.label, fmt(i.value)]) } }, responsive(draw, 420));
  }

  // ---- עמודות מוערמות: החלטות גורמי תשתית (צבעי סטטוס + מקרא + טקסט) ----
  function stackedChart(opts, rows, keys) {
    if (!rows.length) return emptyChart(opts, 'עדיין לא נקבעו גורמי תשתית לבקשות בתקופה זו.');
    const max = Math.max(...rows.map(r => keys.reduce((a, k) => a + (r[k.key] || 0), 0)));
    const draw = (W) => {
      const row = 36, lw = Math.min(160, W * 0.34), H = rows.length * row + 6; const id = 'sc' + (++chartSeq);
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${opts.title}: ${rows.map(r => `${r.name} – ${keys.map(k => `${k.label} ${r[k.key] || 0}`).join(', ')}`).join('; ')}` }, texDefs(id));
      const span = W - lw - 44;
      rows.forEach((r, i) => {
        const y = i * row + 6; let xr = W - lw - 8; const tot = keys.reduce((a, k) => a + (r[k.key] || 0), 0);
        root.append(txt(W - 2, y + 16, 'right', clip(r.name, Math.floor(lw / 7.5))));
        keys.forEach((k, ki) => {
          const v = r[k.key] || 0; if (!v) return;
          const w = v / max * span;
          root.append(svg('rect', { class: 'seg mark grow h', 'data-k': k.key, x: xr - w, y: y + 3, width: w, height: row - 14, rx: 3, fill: k.color,
            tabindex: 0, 'data-tip': `${r.name} – ${k.label}\n${v} מתוך ${tot}`, 'aria-label': `${r.name}, ${k.label}: ${v}` }));
          if (texFill(id, ki)) root.append(svg('rect', { x: xr - w, y: y + 3, width: w, height: row - 14, fill: texFill(id, ki), 'pointer-events': 'none' }));
          xr -= w;
        });
        root.append(txt(xr - 6, y + 16, 'right', String(tot), 'v'));
      });
      return root;
    };
    const legend = legendList(keys.map(k => ({ label: k.label, color: k.color, value: nf.format(rows.reduce((a, r) => a + (r[k.key] || 0), 0)) })));
    return chartFrame({ ...opts, table: { head: ['גורם', ...keys.map(k => k.label), 'סה"כ'], rows: rows.map(r => [r.name, ...keys.map(k => r[k.key] || 0), keys.reduce((a, k) => a + (r[k.key] || 0), 0)]) } }, responsive(draw), legend);
  }

  // ---- מד עמידה ביעד (מספר מוביל + טבעת) ----
  function slaChart(opts, sla) {
    const closed = sla.onTime + sla.late;
    const p = closed ? pct(sla.onTime, closed) : null;
    const S = 180, c = S / 2, R = 72;
    const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', class: 'gauge', 'aria-label': p === null ? 'אין עדיין בקשות שהסתיימו' : `${p}% מהבקשות טופלו בזמן` },
      svg('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: 'var(--surface-2)', 'stroke-width': 14 }));
    if (p !== null) {
      const len = 2 * Math.PI * R;
      root.append(svg('circle', { class: 'draw', cx: c, cy: c, r: R, fill: 'none', stroke: p >= 80 ? 'var(--s3)' : p >= 50 ? 'var(--s4)' : 'var(--st-crit)', 'stroke-width': 14, 'stroke-linecap': 'round',
        'stroke-dasharray': `${len * p / 100} ${len}`, transform: `rotate(-90 ${c} ${c})`, style: `--len:${len}` }));
    }
    root.append(txt(c, c + 8, 'middle', p === null ? '—' : p + '%', 'hero'), txt(c, c + 28, 'middle', 'טופלו בזמן'));
    const facts = h('div', { class: 'facts' },
      h('div', null, h('b', null, nf.format(sla.onTime)), ' הסתיימו בזמן · ', h('b', null, nf.format(sla.late)), ' באיחור'),
      h('div', null, 'זמן טיפול ממוצע: ', h('b', null, sla.avgDays === null ? '—' : `${sla.avgDays} ימים`)),
      h('div', null, 'פתוחות כעת: ', h('b', null, nf.format(sla.open)), ' · מהן בחריגה: ', h('b', { class: sla.openOverdue ? 'sev-critical' : '' }, nf.format(sla.openOverdue))));
    return chartFrame({ ...opts, table: { head: ['מדד', 'ערך'], rows: [['הסתיימו בזמן', sla.onTime], ['הסתיימו באיחור', sla.late], ['אחוז עמידה ביעד', p === null ? '—' : p + '%'], ['זמן טיפול ממוצע (ימים)', sla.avgDays ?? '—'], ['פתוחות', sla.open], ['פתוחות בחריגה', sla.openOverdue]] } }, h('div', { class: 'hero-row' }, root, facts));
  }

  // ---- הרכבת גרפים מנתוני הדוח ----
  function reportCharts(d, { compact = false } = {}) {
    const out = [];
    out.push(slaChart({ title: 'עמידה בזמני טיפול', sub: 'בקשות שהסתיימו לעומת היעד שנקבע להן' }, d.sla));
    out.push(lineChart({ title: 'בקשות לאורך זמן', sub: `הוגשו ואושרו בכל חודש, ${d.months} חודשים אחרונים`, wide: !compact, csv: { name: 'trend' } },
      d.trend.labels, [{ name: 'הוגשו', values: d.trend.submitted, color: 'var(--s1)' }, { name: 'אושרו', values: d.trend.approved, color: 'var(--s2)' }]));
    out.push(donutChart({ title: 'לפי סוג בקשה', csv: { name: 'by-type' } }, Object.entries(d.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: T(k), value: v })), 'בקשות'));
    if (compact) return out;
    out.push(barChart({ title: 'לפי סטטוס', sub: 'כמה בקשות נמצאות בכל שלב', csv: { name: 'by-status' } },
      Object.keys(S.meta.statuses).filter(k => d.byStatus[k]).map(k => ({ label: ST(k), value: d.byStatus[k] }))));
    out.push(stackedChart({ title: 'החלטות גורמי תשתית', sub: 'כמה בקשות כל גורם אישר, אישר בתנאים, דחה או טרם השיב', wide: true, csv: { name: 'infra' } }, d.infra, [
      { key: 'approved', label: 'אישר', color: 'var(--st-good)' }, { key: 'conditions', label: 'אישר בתנאים', color: 'var(--st-warn)' },
      { key: 'pending', label: 'ממתין', color: 'var(--st-none)' }, { key: 'rejected', label: 'דחה', color: 'var(--st-crit)' }]));
    if (d.tasks) out.push(donutChart({ title: 'משימות לפי סטטוס', csv: { name: 'tasks' } }, ['פתוחה', 'בביצוע', 'ממתינה', 'הושלמה'].map(k => ({ label: k, value: d.tasks[k] || 0 })), 'משימות'));
    return out;
  }

  async function viewReports(main, q) {
    const months = ['3', '6', '12', '24'].includes(q.months) ? q.months : '12';
    const p = new URLSearchParams({ months }); if (q.type) p.set('type', q.type);
    const d = await api('GET', '/api/reports?' + p);
    const f = h('form', { class: 'filters-row', role: 'search', 'aria-label': 'סינון דוחות' },
      h('div', { class: 'field' }, h('label', { for: 'rm' }, 'תקופה'), sel('months', [['3', '3 חודשים'], ['6', '6 חודשים'], ['12', '12 חודשים'], ['24', 'שנתיים']], months, { id: 'rm' })),
      h('div', { class: 'field' }, h('label', { for: 'rt' }, 'סוג בקשה'), sel('type', [['', 'כל הסוגים'], ...Object.entries(S.meta.types)], q.type, { id: 'rt' })));
    f.addEventListener('change', () => { const pp = new URLSearchParams({ months: f.months.value }); if (f.type.value) pp.set('type', f.type.value); location.hash = '#/reports?' + pp; });
    main.replaceChildren(pageHead('דוחות וגרפים', `${nf.format(d.total)} בקשות בתקופה. ריחוף או מעבר במקלדת על גרף מציג פרטים; כל גרף זמין גם כטבלה.`,
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, icon('download'), 'הדפסה / PDF')), f, h('div', { class: 'charts' }, reportCharts(d)));
  }

  // ---------- דף הבית ----------
  async function viewDashboard(main) {
    const [d, rep6] = await Promise.all([api('GET', '/api/dashboard'), api('GET', '/api/reports?months=6')]);
    const k = d.kpi;
    const kpi = (v, l, href, alert) => h(href ? 'a' : 'div', { class: 'kpi' + (alert && v ? ' alert' : ''), href }, h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l));
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : 'ערב טוב';
    main.replaceChildren(
      pageHead(`${greet}, ${S.me.full_name.split(' ')[0]}`, 'מה ממתין לך היום, ומה מתעכב.', null),
      h('div', { class: 'kpis' },
        kpi(k.assignedToMe + d.pendingApprovals.length, 'ממתינות לטיפולי', '#/requests?scope=pending_me'),
        kpi(k.open, 'בקשות פתוחות', can('requests.view_all') ? '#/requests?scope=all' : '#/requests?scope=mine'),
        kpi(k.overdue, 'חרגו מזמן הטיפול', null, true),
        kpi(k.approved, 'אושרו')),
      h('div', { class: 'charts', style: { 'margin-bottom': '16px' } }, reportCharts(rep6, { compact: true })),
      h('p', { class: 'small', style: { margin: '-6px 0 16px' } }, h('a', { href: '#/reports' }, 'לכל הדוחות והגרפים')),
      h('div', { class: 'grid side' },
        h('section', { class: 'panel', 'aria-labelledby': 'rec-h' },
          h('div', { class: 'panel-head' }, h('h2', { id: 'rec-h' }, 'עודכנו לאחרונה')),
          tableOf([
            { label: 'מספר', cls: 'reqno', render: r => h('a', { class: 'rowlink ltr', href: `#/requests/${r.id}` }, r.number) },
            { label: 'נושא', key: 'title' }, { label: 'סוג', render: r => T(r.type) },
            { label: 'סטטוס', render: r => h('span', null, statusChip(r.status), ' ', r.overdue ? h('span', { class: 'chip late' }, 'בחריגה') : null) },
          ], d.recent, { onRow: r => { location.hash = `#/requests/${r.id}`; }, caption: 'בקשות שעודכנו לאחרונה',
            empty: h('div', { class: 'empty' }, h('p', null, 'עדיין אין בקשות.'), null) })),
        h('div', null,
          d.pendingApprovals.length ? h('section', { class: 'panel' }, h('h2', null, 'ממתינות לחוות דעתך'),
            h('ul', { class: 'files' }, d.pendingApprovals.map(a => h('li', null, h('a', { class: 'fname', href: `#/requests/${a.request_id}` }, h('span', { class: 'ltr' }, a.number), ' – ', a.title))))) : null,
          d.myTasks.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'המשימות שלי'), h('div', { class: 'actions' }, h('a', { href: '#/tasks', class: 'small' }, 'לכל המשימות'))),
            h('ul', { class: 'files' }, d.myTasks.map(t => h('li', null, h('span', { class: 'fname' }, t.title), h('span', { class: 'small muted' }, t.due_date ? 'עד ' + fmtDate(t.due_date) : ''), t.priority === 'דחופה' ? h('span', { class: 'chip late' }, 'דחופה') : null)))) : null)));
  }

  // ---------- רשימת בקשות ----------
  // בקשות שטופלו (הסתיימו) מול בקשות פתוחות – משמש ברשימת הבקשות ובמסמכים
  const DONE_STATUSES = ['approved', 'rejected', 'closed'];
  const isHandled = (status) => DONE_STATUSES.includes(status);
  // לשוניות נגישות (חצים ימינה/שמאלה, Home/End) שמחליפות תוכן בלי טעינה מחדש
  function tabBar(label, tabsDef, current, onPick) {
    const bar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
    const btns = tabsDef.map(([key, text]) => h('button', { type: 'button', role: 'tab', id: 'tab-' + key, 'aria-controls': 'tabpanel', 'data-k': key,
      'aria-selected': String(key === current), tabindex: key === current ? '0' : '-1', onclick: () => select(key, true) }, text, h('span', { class: 'tab-count', 'data-count': key })));
    function select(key, focus) {
      for (const b of btns) { const on = b.dataset.k === key; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
      onPick(key);
    }
    bar.addEventListener('keydown', (e) => {
      const i = btns.findIndex(b => b.getAttribute('aria-selected') === 'true'); let n = -1;
      if (e.key === 'ArrowLeft') n = (i + 1) % btns.length; else if (e.key === 'ArrowRight') n = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = btns.length - 1;
      if (n >= 0) { e.preventDefault(); select(btns[n].dataset.k, true); }
    });
    bar.append(...btns);
    bar.select = (key) => select(key, false);
    bar.setCount = (key, n) => { const el = bar.querySelector(`[data-count="${key}"]`); if (el) el.textContent = ` (${n})`; };
    return bar;
  }

  async function viewRequests(main, q) {
    const scope = q.scope || 'mine';
    const titles = { mine: 'הבקשות שלי', assigned: 'מוקצות אליי', all: 'כל הבקשות', pending_me: 'ממתין לטיפולי' };
    const { items } = await api('GET', '/api/requests?' + new URLSearchParams({ scope }));
    // הסינון מתבצע מיד עם כל שינוי – בלי כפתור. החיפוש והסינון חלים על שתי הלשוניות
    const st = { tab: q.tab === 'done' ? 'done' : 'open', q: q.q || '', status: q.status || '', type: q.type || '' };
    const search = h('input', { id: 'fq', name: 'q', type: 'search', value: st.q, maxlength: 100, autocomplete: 'off' });
    fitPlaceholder(search, ['מספר בקשה, נושא, כתובת או מגיש', 'מספר, נושא, כתובת או מגיש', 'מספר, נושא או כתובת', 'מספר או נושא', 'חיפוש']);
    const statusSel = sel('status', [['', 'הכל'], ...Object.entries(S.meta.statuses).filter(([k]) => k !== 'draft')], st.status, { id: 'fs' });
    const typeSel = sel('type', [['', 'הכל'], ...Object.entries(S.meta.types)], st.type, { id: 'ft' });
    const filters = h('form', { class: 'toolbar', role: 'search', 'aria-label': 'סינון בקשות', onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'field grow' }, h('label', { for: 'fq' }, 'חיפוש'), search),
      h('div', { class: 'field' }, h('label', { for: 'fs' }, 'סטטוס'), statusSel),
      h('div', { class: 'field' }, h('label', { for: 'ft' }, 'סוג'), typeSel));
    const live = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
    const panel = h('div', { id: 'tabpanel', role: 'tabpanel' });
    const tabs = tabBar('מצב הבקשות', [['open', 'בקשות פתוחות'], ['done', 'בקשות שטופלו']], st.tab, (k) => { st.tab = k; draw(); });
    let shown = [];
    const matches = (r) => {
      if (st.status && r.status !== st.status) return false;
      if (st.type && r.type !== st.type) return false;
      if (!st.q) return true;
      const t = st.q.toLowerCase();
      return [r.number, r.title, r.address, r.applicant_name, r.assignee_name, r.project_name].some(x => x && String(x).toLowerCase().includes(t));
    };
    function draw() {
      const all = items.filter(matches);
      const open = all.filter(r => !isHandled(r.status)); const done = all.filter(r => isHandled(r.status));
      tabs.setCount('open', open.length); tabs.setCount('done', done.length);
      shown = st.tab === 'done' ? done : open;
      panel.setAttribute('aria-labelledby', 'tab-' + st.tab);
      live.textContent = `${shown.length} בקשות ${st.tab === 'done' ? 'שטופלו' : 'פתוחות'}${st.q || st.status || st.type ? ' לפי הסינון' : ''}`;
      panel.replaceChildren(tableOf([
        { label: 'מספר', cls: 'reqno', render: r => h('a', { class: 'rowlink ltr', href: `#/requests/${r.id}` }, r.number) },
        { label: 'נושא', render: r => h('span', null, r.title, r.address ? h('div', { class: 'small muted' }, r.address) : null) },
        { label: 'סוג', render: r => T(r.type) },
        { label: 'מגיש', key: 'applicant_name' }, { label: 'מטפל', render: r => r.assignee_name || '—' },
        { label: 'גורמים', render: r => r.approvals_total ? h('span', { class: 'num' }, `${r.approvals_done}/${r.approvals_total}`) : '—' },
        { label: 'יעד', render: r => r.due_at ? h('span', { class: r.overdue ? 'sev-critical' : '' }, fmtDate(r.due_at)) : '—' },
        { label: 'סטטוס', render: r => h('span', null, statusChip(r.status), r.overdue ? [' ', h('span', { class: 'chip late' }, 'בחריגה')] : null) },
      ], shown, { onRow: r => { location.hash = `#/requests/${r.id}`; }, caption: `${titles[scope]} – ${st.tab === 'done' ? 'בקשות שטופלו' : 'בקשות פתוחות'}`,
        empty: h('div', { class: 'empty' }, h('p', null, st.q || st.status || st.type ? 'לא נמצאו בקשות לפי הסינון.' : st.tab === 'done' ? 'אין עדיין בקשות שטופלו.' : scope === 'pending_me' ? 'אין בקשות שממתינות לך. עבודה טובה.' : 'אין בקשות פתוחות.')) }));
      // שומר את הסינון בכתובת (בלי טעינה מחדש), כדי שחזרה אחורה תחזיר לאותו מצב
      const p = new URLSearchParams({ scope }); if (st.tab === 'done') p.set('tab', 'done');
      for (const k of ['q', 'status', 'type']) if (st[k]) p.set(k, st[k]);
      try { history.replaceState(null, '', '#/requests?' + p); } catch { /* */ }
    }
    let tmr = 0;
    search.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = search.value.trim(); draw(); }, 150); });
    statusSel.addEventListener('change', () => {
      st.status = statusSel.value;
      // בחירת סטטוס שסיים את הטיפול עוברת אוטומטית ללשונית המתאימה
      if (st.status) { const want = isHandled(st.status) ? 'done' : 'open'; if (want !== st.tab) { tabs.select(want); return; } }
      draw();
    });
    typeSel.addEventListener('change', () => { st.type = typeSel.value; draw(); });
    draw();
    main.replaceChildren(
      pageHead(titles[scope] || 'בקשות', `${items.length} בקשות`, null,
        h('button', { class: 'btn', type: 'button', onclick: () => exportCsv(shown) }, icon('download'), 'ייצוא ל-Excel')),
      filters, tabs, live, panel);
  }
  function exportCsv(items) {
    const cols = [['number', 'מספר'], ['title', 'נושא'], ['type', 'סוג'], ['address', 'כתובת'], ['applicant_name', 'מגיש'], ['assignee_name', 'מטפל'], ['status', 'סטטוס'], ['submitted_at', 'הוגשה'], ['due_at', 'יעד']];
    const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }; // מניעת הזרקת נוסחאות
    const val = (r, k) => k === 'type' ? T(r[k]) : k === 'status' ? ST(r[k]) : r[k];
    const csv = '﻿' + [cols.map(c => esc(c[1])).join(','), ...items.map(r => cols.map(c => esc(val(r, c[0]))).join(','))].join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `requests-${today()}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- טופס בקשה ----------
  async function viewRequestForm(main, q, id) {
    const r = (await api('GET', `/api/requests/${id}`)).request;
    const err = errBox();
    const form = h('form', { class: 'panel', novalidate: true }, err,
      h('div', { class: 'row' },
        field('סוג הבקשה', sel('type', [['', 'בחרו סוג'], ...(S.meta.typesActive || Object.keys(S.meta.types)).concat(r.type && !(S.meta.typesActive || []).includes(r.type) ? [r.type] : []).map(k => [k, T(k)])], r.type), { required: true, hint: 'בשינוי הסוג, גורמי התשתית מתעדכנים לגורמים הקבועים של הסוג החדש (כל עוד אף גורם לא התחיל לטפל).' }),
        field('פרויקט', inp('project_name', { value: r.project_name || '', maxlength: 200 }))),
      field('נושא הבקשה', inp('title', { value: r.title || '', maxlength: 200 }), { required: true }),
      field('תיאור העבודה', area('description', { value: r.description || '', maxlength: 5000 }), { hint: 'מה מתוכנן, היקף העבודה, תשתיות מושפעות.' }),
      h('div', { class: 'row' },
        field('זמן עבודה', inp('work_time', { value: r.work_time || '', maxlength: 200, placeholder: 'למשל: ימים א׳-ה׳' })),
        field('שעות עבודה', inp('work_hours', { value: r.work_hours || '', maxlength: 100, placeholder: 'למשל: 07:00-19:00', dir: 'ltr' }))),
      h('p', { class: 'small muted', style: { margin: '-6px 0 12px' } }, 'זמן העבודה ושעות העבודה מגיעים אוטומטית מטופס המשטרה בהגשת הבקשה.'),
      h('div', { class: 'actions', style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
        h('button', { class: 'btn primary', type: 'submit', value: 'save' }, 'שמירת שינויים'),
        h('a', { class: 'btn ghost', href: `#/requests/${id}` }, 'ביטול')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const data = formData(form);
      if (data.planned_start && data.planned_end && data.planned_end < data.planned_start) return showErr(err, 'תאריך הסיום מוקדם מתאריך ההתחלה.');
      try {
        await submitting(e.submitter, () => api('PUT', `/api/requests/${id}`, data)); toast('הבקשה עודכנה'); location.hash = `#/requests/${id}`;
      } catch (ex) { showErr(err, ex.message); }
    });
    main.replaceChildren(pageHead(`עריכת בקשה ${r.number}`), form);
  }

  // ---------- תצוגת בקשה ----------
  const ROUTE_STEPS = ['submitted', 'review', 'coordination', 'pending_admin', 'approved'];
  function routeLine(r) {
    let idx = Math.max(0, ROUTE_STEPS.indexOf(r.status));
    const off = ['returned', 'rejected'].includes(r.status);
    if (r.status === 'returned') idx = 1; if (r.status === 'rejected') idx = 2;
    const n = ROUTE_STEPS.length;
    const wrap = h('ol', { class: 'route', 'aria-label': 'שלבי הבקשה', style: { '--n': n, '--p': Math.round(idx / (n - 1) * 88) + '%' } }, h('span', { class: 'bar', 'aria-hidden': 'true' }));
    ROUTE_STEPS.forEach((s, i) => {
      const cls = i < idx ? 'done' : i === idx ? (off ? 'off' : 'now') : '';
      const label = i === idx && off ? ST(r.status) : ST(s);
      wrap.append(h('li', { class: 'station ' + cls, 'aria-current': i === idx ? 'step' : null }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', null, label, i < idx ? h('span', { class: 'sr-only' }, ' (הושלם)') : null)));
    });
    return h('div', { class: 'route-box' }, wrap);
  }
  async function viewRequest(main, q, id) {
    const d = await api('GET', `/api/requests/${id}`);
    const r = d.request;
    const reload = () => viewRequest(main, q, id);
    const actions = [];
    const TR_LABEL = { submitted: 'הגשה', review: 'העברה לבדיקה', coordination: 'החזרה לתיאום גורמים', pending_admin: 'העברה לאישור מנהל המערכת', returned: 'החזרה לתיקון', approved: 'אישור סופי והפקת מסמך', rejected: 'דחייה', closed: 'סגירת הבקשה' };
    for (const to of d.transitions) {
      actions.push(h('button', { class: 'btn ' + (to === 'approved' ? 'primary' : to === 'rejected' || to === 'returned' ? 'danger' : ''), type: 'button',
        onclick: () => statusDialog(r, to, TR_LABEL[to] || ST(to), reload, d.approvals) }, TR_LABEL[to] || ST(to)));
    }
    if (d.can.edit) actions.push(h('a', { class: 'btn', href: `#/requests/${id}/edit` }, icon('edit'), 'עריכה'));
    if (can('requests.edit_all')) actions.push(h('button', { class: 'btn', type: 'button', onclick: () => {
      const err = errBox(); const form = h('form', { novalidate: true }, err, field('מספר בקשה', inp('number', { value: r.number, maxlength: 40, dir: 'ltr' }), { required: true, hint: 'אותיות, ספרות, מקף, נקודה או לוכסן. חייב להיות ייחודי.' }));
      const m = modal('שינוי מספר בקשה', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
      form.addEventListener('submit', async (e) => { e.preventDefault(); if (!validate(form, err)) return;
        try { await api('POST', `/api/requests/${id}/number`, { number: form.number.value }); m.close(); toast('מספר הבקשה עודכן'); reload(); } catch (ex) { showErr(err, ex.message); } });
    } }, 'שינוי מספר'));
    if (d.can.delete) actions.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (await confirmDlg('מחיקת בקשה', `למחוק את בקשה ${r.number} עם כל המסמכים שלה? הפעולה אינה הפיכה.`, 'מחיקה', true)) {
        try { await api('DELETE', `/api/requests/${id}`); toast('הבקשה נמחקה'); location.hash = '#/requests?scope=all'; } catch (ex) { toast(ex.message, true); }
      } } }, icon('trash'), 'מחיקה'));

    const info = h('dl', { class: 'dl' },
      h('dt', null, 'סוג'), h('dd', null, r.type_name || T(r.type)),
      h('dt', null, 'מגיש'), h('dd', null, r.applicant_name, d.applicant && d.applicant.kind ? h('span', { class: 'chip plain', style: { 'margin-inline-start': '8px' } }, d.applicant.kind === 'entrepreneur' ? 'יזם' : 'תושב/ת') : null),
      d.applicant && (d.applicant.phone || d.applicant.email) ? [h('dt', null, 'פרטי קשר'), h('dd', null, d.applicant.phone ? h('a', { href: 'tel:' + d.applicant.phone, class: 'ltr' }, d.applicant.phone) : null, d.applicant.phone && d.applicant.email ? ' · ' : '', d.applicant.email ? h('a', { href: 'mailto:' + d.applicant.email, class: 'ltr' }, d.applicant.email) : null)] : null,
      d.applicant && d.applicant.address ? [h('dt', null, d.applicant.kind === 'entrepreneur' ? 'כתובת' : 'כתובת מגורים'), h('dd', null, d.applicant.address)] : null,
      h('dt', null, 'גורם מטפל'), h('dd', null, r.assignee_name || 'טרם הוקצה', d.can.assign ? [' ', h('button', { class: 'btn sm', type: 'button', onclick: () => assignDialog(r, reload) }, r.assignee_name ? 'שינוי' : 'הקצאה')] : null),
      h('dt', null, 'פרויקט'), h('dd', null, r.project_name || '—'),
      h('dt', null, 'משתמשים משויכים'), h('dd', null, d.members.length ? d.members.map(m => m.full_name).join(', ') : '—'),
      h('dt', null, 'הוגשה'), h('dd', null, fmtDateTime(r.submitted_at)),
      h('dt', null, 'זמן עבודה'), h('dd', null, r.work_time || '—'),
      h('dt', null, 'שעות עבודה'), h('dd', null, r.work_hours ? h('span', { dir: 'ltr' }, r.work_hours) : '—'));

    // גורמי תשתית
    const active = ['review', 'coordination'].includes(r.status);
    const appr = h('section', { class: 'panel', 'aria-labelledby': 'ap-h' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'ap-h' }, 'גורמי תשתית – לפי סדר טיפול'), d.can.mapInfra && !['approved', 'rejected', 'closed'].includes(r.status) ? h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => infraDialog(r, d.approvals, reload) }, 'בחירת גורמים וסדר')) : null),
      d.approvals.length ? h('ol', { class: 'approvals ordered' }, d.approvals.map((a, i) => {
        const isTurn = active && a.id === d.turn_id;
        const canDecide = d.can.decide && isTurn && (S.me.infra_body_id === a.infra_body_id || S.me.is_sysadmin);
        const lbl = { pending: isTurn ? 'בטיפול עכשיו' : 'ממתין לתורו', approved: 'אישר', rejected: 'דחה', conditions: 'אישר בתנאים' }[a.decision];
        return h('li', { class: 'approval' + (isTurn ? ' turn' : '') + (a.decision !== 'pending' ? ' done' : ''), 'aria-current': isTurn ? 'step' : null },
          h('span', { class: 'seq', 'aria-hidden': 'true' }, a.decision === 'approved' || a.decision === 'conditions' ? icon('check') : String(i + 1)),
          h('div', null, h('div', { class: 'who' }, h('span', { class: 'sr-only' }, `שלב ${i + 1}: `), a.body_name, isTurn ? h('span', { class: 'chip turn-chip' }, 'התור הנוכחי') : null,
            r.fix_auto_approval === a.id ? h('span', { class: 'chip fix-chip' }, 'תיקון – אישור אוטומטי בסיום') : null), h('div', { class: 'note' }, h('span', { class: 'dec-' + a.decision }, lbl),
            a.decided_by_name ? ` · ${a.decided_by_name}, ${fmtDateTime(a.decided_at)}` : ''), a.comment ? h('div', { class: 'note' }, a.comment) : null),
          canDecide ? h('button', { class: 'btn sm', type: 'button', onclick: () => decideDialog(a, reload) }, a.decision === 'pending' ? 'מתן חוות דעת' : 'עדכון') : h('span'));
      })) : h('p', { class: 'muted' }, d.can.mapInfra ? 'עדיין לא נבחרו גורמי תשתית לבקשה.' : 'גורמי התשתית ייקבעו על ידי הגורם המטפל.'),
      d.approvals.length ? h('p', { class: 'small muted' }, 'כל גורם מקבל הודעה ואימייל כשמגיע תורו. כשכל הגורמים מאשרים, הבקשה עוברת לאישור מנהל המערכת.') : null);

    // מיקום העבודה: מפה עם סמן לצד פרטי הבקשה (בכל שלב ולכל גורם)
    const L0 = d.location;
    const editLoc = d.can.editLocation && !['approved', 'rejected', 'closed'].includes(r.status) ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      let hasMap = false; try { hasMap = !!(await api('GET', '/api/public/map-config')).token; } catch { /* */ }
      locationDialog(L0, hasMap, async (v0) => { await api('PUT', `/api/requests/${id}/location`, { location: v0 }); toast('המיקום עודכן'); reload(); });
    } }, icon('pin'), L0 ? 'עדכון מיקום' : 'סימון מיקום') : null;
    const locFigure = h('figure', { class: 'loc-figure' + (L0 ? '' : ' empty') },
      L0 ? (L0.map
        ? h('iframe', { class: 'loc-view', src: `/map.html?mode=view&x=${L0.x}&y=${L0.y}&z=${L0.z}`, title: `מפת מיקום העבודה – בקשה ${r.number}`, loading: 'lazy' })
        : h('a', { class: 'loc-static', href: L0.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'פתיחת המיקום ב-GovMap' },
          h('span', { class: 'loc-grid', 'aria-hidden': 'true' }), h('span', { class: 'loc-pin', 'aria-hidden': 'true' }, icon('pin')), h('span', { class: 'loc-open' }, 'פתיחה במפה')))
        : h('div', { class: 'loc-none' }, icon('pin'), h('span', null, 'לא סומן מיקום')),
      h('figcaption', null,
        L0 ? [h('strong', null, L0.label || 'מיקום העבודה'), h('span', { class: 'small muted ltr' }, `נ.צ. ${Math.round(L0.x)}, ${Math.round(L0.y)}`)] : null,
        h('span', { class: 'loc-actions' }, L0 ? h('a', { class: 'btn sm', href: L0.link, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'פתיחה ב-GovMap') : null, editLoc)));

    // מסמך האישור
    const okDoc = d.approvalDoc ? h('section', { class: 'panel approval-doc', 'aria-labelledby': 'ok-h' },
      h('span', { class: 'ok-ic', 'aria-hidden': 'true' }, icon('check')),
      h('div', null, h('h2', { id: 'ok-h' }, 'אישור לביצוע עבודה'), h('p', { class: 'small muted' }, `הופק ${fmtDateTime(d.approvalDoc.created_at)} · נשלח גם לאימייל של המגיש`)),
      h('span', { class: 'ok-actions' }, viewBtn(d.approvalDoc, { label: 'צפייה באישור', cls: 'btn' }), h('a', { class: 'btn primary', href: `/api/documents/${d.approvalDoc.id}/download` }, icon('download'), 'הורדת האישור (PDF)'))) : null;

    // בקשה שנדחתה: הסיבה והנחיה להגשת בקשה חדשה
    const rejH = r.status === 'rejected' ? d.history.find(x => x.action === `סטטוס: ${ST('rejected')}`) : null;
    const rejNote = r.status === 'rejected' ? h('section', { class: 'panel reject-note', role: 'note', 'aria-labelledby': 'rj-h' },
      h('span', { class: 'rj-ic', 'aria-hidden': 'true' }, icon('x')),
      h('div', null, h('h2', { id: 'rj-h' }, 'הבקשה נדחתה'),
        rejH && rejH.details ? h('p', null, h('strong', null, 'סיבת הדחייה: '), rejH.details) : null,
        h('p', null, 'לא ניתן להמשיך בטיפול בבקשה זו. יש להגיש בקשה חדשה עם השלמת הפרטים.'),
        isPublicUser() && r.applicant_id === S.me.id ? h('p', null, h('a', { class: 'btn primary', href: `#/apply?kind=${S.me.applicant_kind}&existing=1` }, icon('send'), 'הגשת בקשה חדשה')) : null)) : null;

    // מסמכים
    const docs = docsPanel(d.documents, { request_id: id }, d.can.upload, reload, d.docsOwnOnly);

    // היסטוריה + הערה
    const cErr = errBox();
    const cForm = h('form', { novalidate: true }, cErr, field('הוספת הערה', area('text', { rows: 3, maxlength: 2000 }), { required: true }), h('button', { class: 'btn', type: 'submit' }, 'הוספת הערה'));
    cForm.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(cForm, cErr)) return;
      try { await submitting(e.submitter, () => api('POST', `/api/requests/${id}/comment`, formData(cForm))); toast('ההערה נוספה'); reload(); } catch (ex) { showErr(cErr, ex.message); }
    });
    const hist = h('section', { class: 'panel', 'aria-labelledby': 'hi-h' }, h('h2', { id: 'hi-h' }, 'היסטוריה והערות'), cForm,
      h('ol', { class: 'timeline' }, d.history.map(x => h('li', null, h('div', { class: 't' }, x.action), h('div', { class: 'd' }, `${x.user_name || 'מערכת'} · ${fmtDateTime(x.created_at)}`), x.details ? h('div', { class: 'c' }, x.details) : null))));

    main.replaceChildren(
      h('div', { class: 'req-head' }, h('div', { class: 'req-number' }, r.number),
        h('div', null, h('h1', { class: 'req-title' }, r.title), h('div', null, statusChip(r.status), r.overdue ? h('span', { class: 'chip late' }, 'חרגה מזמן הטיפול') : null)),
        h('div', { class: 'actions', style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } }, actions)),
      h('section', { class: 'panel', 'aria-label': 'שלבי הבקשה' }, routeLine(r)), ...(okDoc ? [okDoc] : []), ...(rejNote ? [rejNote] : []),
      h('div', { class: 'grid side' },
        h('div', null, h('section', { class: 'panel' }, h('h2', null, 'פרטי הבקשה'), h('div', { class: 'details-with-map' }, info, locFigure), r.description ? [h('h3', { style: { 'margin-top': '16px' } }, 'תיאור'), h('p', { style: { 'white-space': 'pre-wrap' } }, r.description)] : null), appr, hist),
        h('div', null, docs, d.tasks.length ? h('section', { class: 'panel' }, h('h2', null, 'משימות קשורות'), h('ul', { class: 'files' }, d.tasks.map(t => h('li', null, h('span', { class: 'fname' }, t.title), h('span', { class: 'small muted' }, t.assignee_name || ''), h('span', { class: 'chip plain st-draft' }, t.status))))) : null)));
  }
  function statusDialog(r, to, label, reload, approvals = []) {
    const err = errBox();
    const needComment = ['returned', 'rejected'].includes(to);
    // החזרה לתיקון: בוחרים למי מחזירים – למגיש או לגורם תשתית מסוים. מי שנבחר מקבל התראה ואימייל עם הסיבה וקישור
    const returnTo = to === 'returned' ? h('fieldset', null, h('legend', null, 'למי מחזירים לתיקון?'),
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'return_to', value: 'applicant', checked: true }), `למגיש הבקשה – ${r.applicant_name}`),
      approvals.map(a => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'return_to', value: String(a.id) }), `לגורם התשתית – ${a.body_name}`,
        a.decision !== 'pending' ? h('span', { class: 'small muted' }, ` (${({ approved: 'אישר', conditions: 'אישר בתנאים', rejected: 'דחה' })[a.decision]})`) : null)),
      h('p', { class: 'small muted', style: { margin: '6px 0 0' } }, 'מי שנבחר מקבל התראה במערכת ואימייל עם סיבת ההחזרה וקישור לכניסה לבקשה.')) : null;
    // החזרה לגורם מהשלב האחרון: אחרי התיקון הבקשה מאושרת אוטומטית (בלי בדיקה חוזרת)
    const autoBox = to === 'returned' && r.status === 'pending_admin' && S.me.is_sysadmin ? h('label', { class: 'check auto-fix', hidden: true },
      h('input', { type: 'checkbox', name: 'auto_approve', checked: true }),
      h('span', null, h('strong', null, 'בלי בדיקה חוזרת'), h('span', { class: 'small muted', style: { display: 'block' } }, 'כשהגורם יתקן ויאשר – הבקשה תאושר אוטומטית ומסמך האישור יישלח למגיש.'))) : null;
    if (autoBox && returnTo) returnTo.addEventListener('change', () => { const v0 = returnTo.querySelector('[name=return_to]:checked').value; autoBox.hidden = v0 === 'applicant'; });
    const rejectNote = to === 'rejected' ? h('p', { class: 'small muted', style: { margin: '0 0 8px' } }, `${r.applicant_name || 'מגיש הבקשה'} יקבל אימייל עם סיבת הדחייה והנחיה להגיש בקשה חדשה עם השלמת הפרטים.`) : null;
    const form = h('form', { novalidate: true }, err, h('p', null, `בקשה ${r.number}: ${label}.`), returnTo, autoBox, rejectNote,
      field(needComment ? (to === 'returned' ? 'סיבת ההחזרה (תישלח באימייל)' : to === 'rejected' ? 'סיבת הדחייה (תישלח באימייל למגיש)' : 'נימוק (יוצג למגיש)') : 'הערה (לא חובה)', area('comment', { rows: 3, maxlength: 2000 }), { required: needComment }));
    const m = modal(label, form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, label), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const rt = form.querySelector('[name=return_to]:checked');
      try {
        const res = await api('POST', `/api/requests/${r.id}/status`, { status: to, comment: formData(form).comment, ...(rt ? { return_to: rt.value } : {}), ...(autoBox ? { auto_approve: form.auto_approve.checked } : {}) });
        m.close(); toast(res.returned_to ? `הבקשה הוחזרה ל${res.returned_to} – נשלח אימייל עם הסיבה${res.auto_approve ? '. אחרי התיקון היא תאושר אוטומטית' : ''}` : to === 'returned' ? 'הבקשה הוחזרה למגיש – נשלח אימייל עם הסיבה' : to === 'rejected' ? 'הבקשה נדחתה – נשלח אימייל למגיש עם הסיבה והנחיה להגיש בקשה חדשה' : `הבקשה עודכנה: ${ST(to)}`); reload();
      } catch (ex) { showErr(err, ex.message); }
    });
  }
  async function assignDialog(r, reload) {
    // רק משתמשים בעלי הרשאה (לא יזם / תושב/ת)
    const { items } = await api('GET', '/api/users/lookup?staff=1');
    const err = errBox();
    const form = h('form', { novalidate: true }, err, field('גורם מטפל', sel('assignee_id', [['', 'בחרו משתמש בעל הרשאה'], ...items.map(u => [u.id, `${u.full_name} (${u.role_name})`])], r.assignee_id), { required: true }));
    const m = modal('הקצאת גורם מטפל', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'הקצאה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { await api('POST', `/api/requests/${r.id}/assign`, formData(form)); m.close(); toast('הבקשה הוקצתה'); reload(); } catch (ex) { showErr(err, ex.message); }
    });
  }

  // רשימה מסודרת: בחירה + שינוי סדר עם כפתורי למעלה/למטה (נגיש למקלדת)
  function orderedPicker(items, selectedIds, legend) {
    let order = selectedIds.filter(id => items.some(b => b.id === id));
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const chosen = h('ol', { class: 'order-list' }); const rest = h('div', { class: 'order-rest' });
    const name = (id) => (items.find(b => b.id === id) || {}).name || '';
    function draw(focusSel) {
      chosen.replaceChildren(...order.map((id, i) => h('li', null, h('span', { class: 'seq', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'grow' }, name(id)),
        h('button', { class: 'btn ghost icon-btn sm', type: 'button', 'aria-label': `העלאה של ${name(id)}`, disabled: i === 0, 'data-k': `u${id}`, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; live.textContent = `${name(id)} במקום ${i}`; draw(`[data-k=u${id}]`); } }, '▲'),
        h('button', { class: 'btn ghost icon-btn sm', type: 'button', 'aria-label': `הורדה של ${name(id)}`, disabled: i === order.length - 1, 'data-k': `d${id}`, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; live.textContent = `${name(id)} במקום ${i + 2}`; draw(`[data-k=d${id}]`); } }, '▼'),
        h('button', { class: 'btn ghost icon-btn sm', type: 'button', 'aria-label': `הסרת ${name(id)}`, onclick: () => { order = order.filter(x => x !== id); live.textContent = `${name(id)} הוסר`; draw(); } }, icon('x')))));
      if (!order.length) chosen.append(h('li', { class: 'muted empty' }, 'לא נבחרו גורמים'));
      rest.replaceChildren(...items.filter(b => !order.includes(b.id)).map(b => h('button', { class: 'btn sm', type: 'button', 'data-k': `a${b.id}`, onclick: () => { order.push(b.id); live.textContent = `${b.name} נוסף במקום ${order.length}`; draw(); } }, icon('plus'), b.name)));
      if (focusSel) { const el = chosen.querySelector(focusSel); if (el && !el.disabled) el.focus(); }
    }
    draw();
    return { el: h('fieldset', { class: 'ordered-pick' }, h('legend', null, legend), chosen, h('p', { class: 'small muted' }, 'הוספה:'), rest, live), get: () => order.slice() };
  }
  async function infraDialog(r, current, reload) {
    const { items } = await api('GET', '/api/infra');
    const have = current.map(a => a.infra_body_id);
    const pick = orderedPicker(items.filter(b => b.active || have.includes(b.id)), have, 'גורמים שנדרשת חוות דעתם, לפי סדר הטיפול');
    const form = h('form', null, h('p', { class: 'small muted' }, 'הגורם הראשון מקבל את הבקשה, וכל גורם הבא מקבל הודעה ואימייל רק כשהקודם סיים.'), pick.el);
    const m = modal('גורמי תשתית לבקשה', form, [h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const ids = pick.get();
      try { await api('POST', `/api/requests/${r.id}/approvals`, { infra_body_ids: ids }); m.close(); toast('גורמי התשתית עודכנו'); reload(); } catch (ex) { toast(ex.message, true); }
    } }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
  }
  function decideDialog(a, reload) {
    const err = errBox();
    const form = h('form', { novalidate: true }, err,
      h('fieldset', null, h('legend', null, `חוות דעת: ${a.body_name}`),
        [['approved', 'מאשר'], ['conditions', 'מאשר בתנאים'], ['rejected', 'לא מאשר']].map(([v, l]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'decision', value: v, checked: a.decision === v }), l))),
      field('הערות / תנאים', area('comment', { rows: 3, maxlength: 2000, value: a.comment || '' }), { hint: 'חובה באישור בתנאים או בדחייה.' }));
    const m = modal('מתן חוות דעת', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dec = form.querySelector('[name=decision]:checked'); if (!dec) return showErr(err, 'יש לבחור החלטה.');
      if (dec.value !== 'approved' && !form.comment.value.trim()) { form.comment.setAttribute('aria-invalid', 'true'); form.comment.focus(); return showErr(err, 'יש לפרט תנאים או סיבת דחייה.'); }
      try { const res = await api('POST', `/api/approvals/${a.id}/decide`, { decision: dec.value, comment: form.comment.value }); m.close(); toast(res.approved ? 'התיקון נשמר – הבקשה אושרה ומסמך האישור נשלח למגיש' : 'חוות הדעת נשמרה'); reload(); } catch (ex) { showErr(err, ex.message); }
    });
  }

  // ---------- מסמכים ----------
  function docsPanel(docs, target, canUpload, reload, ownOnly) {
    const list = h('ul', { class: 'files' }, docs.map(f => h('li', null,
      h('span', { class: 'fname' }, f.original_name, f.visibility === 'restricted' ? h('span', { class: 'chip lock-chip', title: 'גלוי רק למנהל המערכת ולאחראי מיפוי בקשות' }, icon('lock'), 'מוגבל') : null, f.visibility === 'shared' ? h('span', { class: 'chip ok-chip' }, 'מסמך רשמי') : null),
      h('span', { class: 'small muted' }, `${fmtSize(f.size)} · ${f.uploaded_by_name} · ${fmtDate(f.created_at)}`),
      viewBtn(f), can('files.download') ? h('a', { class: 'btn sm', href: `/api/documents/${f.id}/download`, 'aria-label': `הורדת ${f.original_name}` }, icon('download'), 'הורדה') : null,
      (can('files.delete_all') || (can('files.delete_own') && f.uploaded_by === S.me.id)) ? h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `מחיקת ${f.original_name}`, onclick: async () => {
        if (!(await confirmDlg('מחיקת קובץ', `למחוק את "${f.original_name}"?`, 'מחיקה', true))) return;
        try { await api('DELETE', `/api/documents/${f.id}`); toast('הקובץ נמחק'); reload(); } catch (ex) { toast(ex.message, true); }
      } }, icon('trash')) : null)));
    const panel = h('section', { class: 'panel', 'aria-labelledby': 'docs-h' }, h('h2', { id: 'docs-h' }, 'מסמכים'),
      ownOnly ? h('p', { class: 'small muted' }, 'מוצגים רק המסמכים שהעלית. מנהל המערכת רואה את כל המסמכים.') : null,
      docs.length ? list : h('p', { class: 'muted' }, ownOnly ? 'לא העלית מסמכים לבקשה זו.' : 'לא צורפו מסמכים.'));
    if (canUpload) panel.append(uploader(target, reload));
    return panel;
  }
  function uploader(target, done) {
    const allowed = S.meta.files.allowed;
    const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const input = h('input', { type: 'file', id: 'up-' + (++fid), accept: allowed.map(e => '.' + e).join(','), class: 'sr-only' });
    const zone = h('div', { class: 'dropzone' },
      h('label', { for: input.id, class: 'btn' }, icon('upload'), 'בחירת קובץ להעלאה'), input,
      h('p', { class: 'small', style: { margin: '8px 0 0' } }, `סוגים מותרים: ${allowed.join(', ')} · עד ${S.meta.files.maxMb}MB`), status);
    input.addEventListener('focus', () => zone.querySelector('label').classList.add('focus'));
    async function send(file) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!allowed.includes(ext)) { status.textContent = `סוג הקובץ .${ext} אינו מורשה.`; status.className = 'small sev-critical'; return; }
      if (file.size > S.meta.files.maxMb * 1048576) { status.textContent = `הקובץ גדול מ-${S.meta.files.maxMb}MB.`; status.className = 'small sev-critical'; return; }
      const fd = new FormData();
      for (const [k, v] of Object.entries(target)) if (v) fd.append(k, v);
      fd.append('file', file);
      status.className = 'small'; status.textContent = `מעלה את ${file.name}…`;
      try { await api('POST', '/api/documents', fd); toast('הקובץ הועלה ונשמר'); done(); }
      catch (ex) { status.textContent = ex.message; status.className = 'small sev-critical'; }
    }
    input.addEventListener('change', () => { if (input.files[0]) send(input.files[0]); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); });
    return zone;
  }
  async function viewDocuments(main, q) {
    const { items, ownOnly } = await api('GET', '/api/documents');
    const st = { tab: q.tab === 'done' ? 'done' : 'open', q: '' };
    const openSet = new Set(); // תיקיות פתוחות בתצוגה הנוכחית
    // מיון לפי מספר בקשה (החדשה למעלה, השוואה מספרית לפי הספרות במספר)
    const numKey = (n) => (String(n || '').match(/\d+/g) || []).map(x => x.padStart(10, '0')).join('-');
    const groupsOf = (rows) => {
      const map = new Map();
      for (const d of rows) {
        if (!map.has(d.request_id)) map.set(d.request_id, { request_id: d.request_id, number: d.request_number, title: d.request_title, status: d.request_status, docs: [] });
        map.get(d.request_id).docs.push(d);
      }
      return [...map.values()].sort((a, b) => numKey(b.number).localeCompare(numKey(a.number)) || String(b.number).localeCompare(String(a.number)));
    };
    const docRow = (d) => h('li', null,
      h('span', { class: 'fname' }, d.original_name, d.visibility === 'restricted' ? h('span', { class: 'chip lock-chip' }, icon('lock'), 'מוגבל') : null, d.visibility === 'shared' ? h('span', { class: 'chip ok-chip' }, 'מסמך רשמי') : null),
      h('span', { class: 'small muted' }, `${fmtSize(d.size)} · ${d.uploaded_by_name} · ${fmtDate(d.created_at)}`),
      h('span', { class: 'file-actions' }, viewBtn(d), can('files.download') ? h('a', { class: 'btn sm', href: `/api/documents/${d.id}/download`, 'aria-label': `הורדת ${d.original_name}` }, icon('download'), 'הורדה') : null));
    const box = h('div', { class: 'doc-groups', id: 'tabpanel', role: 'tabpanel' });
    const live = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
    const tabs = tabBar('מצב הבקשות', [['open', 'בקשות פתוחות'], ['done', 'בקשות שטופלו']], st.tab, (k) => { st.tab = k; openSet.clear(); draw(); });
    function folder(g) {
      const det = h('details', { class: 'doc-folder' + (isHandled(g.status) ? ' handled' : '') });
      det.open = openSet.has(g.request_id) || !!st.q; // בחיפוש – התיקיות שנמצאו נפתחות
      det.addEventListener('toggle', () => { if (det.open) openSet.add(g.request_id); else openSet.delete(g.request_id); });
      det.append(
        h('summary', null,
          h('span', { class: 'df-ic', 'aria-hidden': 'true' }, icon('folder')), h('span', { class: 'df-ic open', 'aria-hidden': 'true' }, icon('folderOpen')),
          h('span', { class: 'df-num ltr' }, g.number), h('span', { class: 'df-title' }, g.title || ''),
          statusChip(g.status), h('span', { class: 'df-count' }, `${g.docs.length} ${g.docs.length === 1 ? 'מסמך' : 'מסמכים'}`)),
        h('div', { class: 'df-body' }, h('ul', { class: 'files' }, g.docs.map(docRow)),
          h('a', { class: 'small', href: `#/requests/${g.request_id}` }, 'מעבר לבקשה ', h('span', { class: 'ltr' }, g.number))));
      return det;
    }
    function draw() {
      const t = st.q.toLowerCase();
      const rows = items.filter(d => !t || d.original_name.toLowerCase().includes(t) || (d.request_number || '').toLowerCase().includes(t) || (d.request_title || '').toLowerCase().includes(t));
      const all = groupsOf(rows);
      const open = all.filter(g => !isHandled(g.status)); const done = all.filter(g => isHandled(g.status));
      tabs.setCount('open', open.length); tabs.setCount('done', done.length);
      const groups = st.tab === 'done' ? done : open;
      box.setAttribute('aria-labelledby', 'tab-' + st.tab);
      live.textContent = `${groups.length} תיקיות, ${groups.reduce((a, g) => a + g.docs.length, 0)} מסמכים`;
      box.replaceChildren(...(groups.length ? groups.map(folder) : [h('p', { class: 'empty' }, st.q ? 'לא נמצאו מסמכים לפי החיפוש.' : st.tab === 'done' ? 'אין מסמכים של בקשות שטופלו.' : 'אין מסמכים של בקשות פתוחות. מסמכים מצורפים מתוך עמוד הבקשה.')]));
      try { history.replaceState(null, '', '#/documents?tab=' + st.tab); } catch { /* */ }
    }
    const search = h('input', { type: 'search', id: 'dsearch', maxlength: 100, autocomplete: 'off' });
    fitPlaceholder(search, ['שם קובץ, מספר בקשה או נושא', 'קובץ, מספר בקשה או נושא', 'קובץ או מספר בקשה', 'חיפוש']);
    let tmr = 0;
    search.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = search.value.trim(); draw(); }, 150); });
    const toggleAll = (open) => { for (const d of box.querySelectorAll('details')) d.open = open; };
    draw();
    main.replaceChildren(pageHead('מסמכים', (ownOnly ? 'המסמכים שהעלית. ' : '') + 'כל בקשה היא תיקייה. לחיצה על התיקייה פותחת או סוגרת אותה.', null,
      h('button', { class: 'btn', type: 'button', onclick: () => toggleAll(true) }, icon('folderOpen'), 'פתיחת הכל'),
      h('button', { class: 'btn', type: 'button', onclick: () => toggleAll(false) }, icon('folder'), 'סגירת הכל')),
      tabs, h('div', { class: 'toolbar' }, h('div', { class: 'field grow' }, h('label', { for: 'dsearch' }, 'חיפוש'), search)), live, box);
  }

  // ---------- משימות ----------
  // רק מנהל המערכת ורכז תיאום מקצים משימות; האחראי הוא גורם תשתית, והמשימה מגיעה לאיש הקשר שלו
  const canAssignTasks = () => !!(S.me && S.me.can_assign_tasks);
  function tasksTable(items, reload, defaults = {}) {
    const wrap = h('div');
    if (canAssignTasks()) wrap.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => taskDialog(defaults, reload) }, icon('plus'), 'משימה חדשה')));
    wrap.append(tableOf([
      { label: 'משימה', render: t => h('span', null, t.title, t.request_number ? h('div', { class: 'small muted ltr' }, t.request_number) : null) },
      { label: 'אחראי', render: t => t.infra_name ? h('span', null, t.infra_name, t.assignee_name ? h('div', { class: 'small muted' }, 'איש קשר: ' + t.assignee_name) : null) : (t.assignee_name || '—') },
      { label: 'עדיפות', render: t => t.priority === 'דחופה' || t.priority === 'גבוהה' ? h('span', { class: 'chip ' + (t.priority === 'דחופה' ? 'late' : 'st-coordination') }, t.priority) : t.priority },
      { label: 'יעד', render: t => { const late = t.due_date && t.due_date < today() && t.status !== 'הושלמה'; return h('span', { class: late ? 'sev-critical' : '' }, fmtDate(t.due_date), late ? ' (באיחור)' : ''); } },
      { label: 'סטטוס', render: t => {
        if (!(canAssignTasks() || t.assignee_id === S.me.id)) return t.status;
        const s = sel('status', ['פתוחה', 'בביצוע', 'ממתינה', 'הושלמה'].map(x => [x, x]), t.status, { 'aria-label': 'סטטוס משימה ' + t.title, style: { 'min-height': '36px', width: 'auto' } });
        s.addEventListener('change', async () => { try { await api('PUT', `/api/tasks/${t.id}`, { status: s.value }); toast('הסטטוס עודכן'); } catch (ex) { toast(ex.message, true); s.value = t.status; } });
        return s;
      } },
      { label: '', render: t => canAssignTasks() ? h('span', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn sm', type: 'button', 'aria-label': 'עריכת ' + t.title, onclick: () => taskDialog(t, reload) }, icon('edit')),
        h('button', { class: 'btn sm danger', type: 'button', 'aria-label': 'מחיקת ' + t.title, onclick: async () => { if (await confirmDlg('מחיקת משימה', `למחוק את "${t.title}"?`, 'מחיקה', true)) { try { await api('DELETE', `/api/tasks/${t.id}`); reload(); } catch (ex) { toast(ex.message, true); } } } }, icon('trash'))) : '' },
    ], items, { caption: 'משימות', empty: h('p', { class: 'empty' }, 'אין משימות.') }));
    return wrap;
  }
  async function taskDialog(t, done) {
    const { items: bodies } = await api('GET', '/api/tasks/assignees');
    const err = errBox();
    const assignee = sel('infra_body_id', [['', 'בחרו גורם תשתית'], ...bodies.map(b => [b.id, b.contact_name ? `${b.name} – ${b.contact_name}` : `${b.name} (לא הוגדר איש קשר)`])], t.infra_body_id || '');
    for (const o of assignee.options) { const b = bodies.find(x => String(x.id) === o.value); if (b && !b.contact_name) o.disabled = true; }
    const noContacts = bodies.length && !bodies.some(b => b.contact_name);
    const form = h('form', { novalidate: true }, err,
      field('כותרת', inp('title', { value: t.title || '', maxlength: 200 }), { required: true }),
      field('אחראי (גורם תשתית)', assignee, { required: true, hint: 'המשימה נשלחת לאיש הקשר של הגורם, בהודעה ובאימייל.' }),
      noContacts || !bodies.length ? h('p', { class: 'form-error', role: 'alert' }, 'עדיין לא הוגדר איש קשר לאף גורם תשתית. מגדירים אותו בתפקידים והרשאות ← גורמי תשתית.') : null,
      h('div', { class: 'row' }, field('עדיפות', sel('priority', ['נמוכה', 'רגילה', 'גבוהה', 'דחופה'].map(x => [x, x]), t.priority || 'רגילה')),
        field('סטטוס', sel('status', ['פתוחה', 'בביצוע', 'ממתינה', 'הושלמה'].map(x => [x, x]), t.status || 'פתוחה'))),
      h('div', { class: 'row' }, field('התחלה', inp('start_date', { type: 'date', value: t.start_date || '' })), field('תאריך יעד', inp('due_date', { type: 'date', value: t.due_date || '' }))),
      field('תיאור', area('description', { value: t.description || '', maxlength: 3000, rows: 3 })));
    const m = modal(t.id ? 'עריכת משימה' : 'משימה חדשה', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const data = { ...formData(form), request_id: t.request_id || null };
      try { await api(t.id ? 'PUT' : 'POST', t.id ? `/api/tasks/${t.id}` : '/api/tasks', data); m.close(); toast('המשימה נשמרה ונשלחה לאיש הקשר'); done(); } catch (ex) { showErr(err, ex.message); }
    });
  }
  async function viewTasks(main, q) {
    const mine = q.mine === '1';
    const { items } = await api('GET', '/api/tasks' + (mine ? '?mine=1' : ''));
    main.replaceChildren(pageHead('משימות', canAssignTasks() ? (mine ? 'המשימות שלי' : 'כל המשימות') : 'המשימות שהוקצו לך',
      canAssignTasks() ? h('a', { class: 'btn', href: mine ? '#/tasks' : '#/tasks?mine=1' }, mine ? 'הצגת כל המשימות' : 'רק המשימות שלי') : null), tasksTable(items, () => viewTasks(main, q)));
  }

  // ---------- עיצוב ותצוגה ----------
  const THEMES = [['drafting', 'שרטוט', '#F2F4F1', '#A61E5E'], ['concrete', 'בטון', '#ECECEA', '#2F5D50'], ['sand', 'חול', '#F1EEE6', '#1E5A8C'], ['ocean', 'אוקיינוס', '#EEF3F7', '#0B62B8'],
    ['aurora', 'זוהר', '#F4F2FC', '#6A3BD3'], ['night', 'לילה תכנוני', '#0B1620', '#5CC8FF'], ['graphite', 'גרפיט', '#111213', '#8AB4FF']];
  const PRESETS = [
    ['classic', 'קלאסי', ['#F2F4F1', '#FFFFFF', '#A61E5E'], { theme: 'drafting', mode: 'light', shape: 'soft', style: 'flat', bg: 'plain', width: 'regular', sidebar: 'full', header: 'blur', density: 'regular' }],
    ['modern', 'מודרני', ['#E9E3FB', '#FFFFFF', '#6A3BD3'], { theme: 'aurora', mode: 'light', shape: 'round', style: 'glass', bg: 'aurora', width: 'wide', sidebar: 'floating', header: 'blur', density: 'regular' }],
    ['ocean', 'אוקיינוס', ['#DCE8F3', '#FFFFFF', '#0B62B8'], { theme: 'ocean', mode: 'light', shape: 'soft', style: 'raised', bg: 'gradient', width: 'wide', sidebar: 'full', header: 'blur', density: 'regular' }],
    ['minimal', 'מינימליסטי', ['#ECECEA', '#ECECEA', '#2F5D50'], { theme: 'concrete', mode: 'light', shape: 'sharp', style: 'outline', bg: 'plain', width: 'regular', sidebar: 'compact', header: 'solid', density: 'compact' }],
    ['night', 'לילה', ['#0B1620', '#10222F', '#5CC8FF'], { theme: 'night', shape: 'soft', style: 'glass', bg: 'grid', width: 'wide', sidebar: 'floating', header: 'blur', density: 'regular' }],
    ['graphite', 'גרפיט', ['#111213', '#1A1C1E', '#8AB4FF'], { theme: 'graphite', shape: 'round', style: 'raised', bg: 'gradient', width: 'wide', sidebar: 'floating', header: 'blur', density: 'regular' }],
    ['access', 'נגיש במיוחד', ['#FFFFFF', '#FFFFFF', '#7A0038'], { theme: 'drafting', mode: 'light', contrast: 'high', fontSize: '20', motion: 'reduced', chartTexture: 'on', chartAnim: 'off', style: 'outline', density: 'comfortable', bg: 'plain', sidebar: 'full' }],
  ];
  function viewAppearance(main) {
    const draft = { ...PREF_DEFAULTS, ...S.prefs };
    const groups = [];
    let section = null;
    const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
    let previewCharts = h('div');
    const refresh = () => {
      const fix = applyPrefs(draft);
      status.textContent = fix && fix.adjusted ? `הצבע שבחרת הוכהה מעט אוטומטית (${fix.accent}) כדי שטקסט בצבע הזה יהיה קריא.` : '';
      const next = h('div', { class: 'charts' }, previewChartsBuild()); previewCharts.replaceWith(next); previewCharts = next;
      for (const el of main.querySelectorAll('[data-pref]')) el.setAttribute('aria-pressed', String(draft[el.dataset.pref] === el.dataset.val));
      for (const el of main.querySelectorAll('.preset')) el.setAttribute('aria-pressed', 'false');
    };
    const sectionHead = (t) => { section = h('div'); groups.push(h('h2', { class: 'pref-section' }, t), section); };
    function seg(key, label, opts) {
      const id = 'pref-' + key;
      const group = h('div', { class: 'seg', role: 'group', 'aria-labelledby': id },
        opts.map(([v, l]) => h('button', { type: 'button', 'data-pref': key, 'data-val': v, 'aria-pressed': String(draft[key] === v), onclick: () => { draft[key] = v; refresh(); } }, l)));
      section.append(h('div', { class: 'pref-row' }, h('span', { id, style: { 'font-weight': '600' } }, label), group));
    }
    // ערכות מוכנות
    const presetBox = h('div', { class: 'presets', role: 'group', 'aria-label': 'ערכות עיצוב מוכנות' }, PRESETS.map(([key, label, [bg, side, acc], vals]) => {
      const pv = h('span', { class: 'pv', 'aria-hidden': 'true' }, h('i'), h('b'));
      pv.style.background = bg; pv.querySelector('i').style.background = side; pv.querySelector('b').style.background = side === bg ? '#ffffff' : side; pv.querySelector('b').style.setProperty('--pa', acc);
      if (side === bg) pv.querySelector('i').style.border = `1px solid ${acc}`;
      return h('button', { class: 'preset', type: 'button', 'aria-pressed': 'false', onclick: (e) => {
        Object.assign(draft, PREF_DEFAULTS, { fontSize: draft.fontSize, font: draft.font }, vals, { accent: '' }); refresh(); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, pv, h('span', null, label));
    }));
    sectionHead('ערכות מוכנות'); section.append(h('p', { class: 'small muted' }, 'נקודת התחלה מהירה. אחרי הבחירה אפשר לשנות כל פרט למטה.'), presetBox);
    // צבעים
    sectionHead('צבעים');
    section.append(h('div', { class: 'pref-row' }, h('span', { id: 'pref-theme', style: { 'font-weight': '600' } }, 'ערכת צבעים'),
      h('div', { class: 'swatches', role: 'group', 'aria-labelledby': 'pref-theme' }, THEMES.map(([v, l, c1, c2]) => {
        const i = h('i'); i.style.background = `linear-gradient(135deg, ${c1} 50%, ${c2} 50%)`;
        return h('button', { class: 'swatch', type: 'button', 'data-pref': 'theme', 'data-val': v, 'aria-pressed': String(draft.theme === v), onclick: () => { draft.theme = v; draft.accent = ''; refresh(); } }, i, l);
      }))));
    const picker = h('input', { type: 'color', id: 'accent-pick', value: /^#[0-9a-f]{6}$/i.test(draft.accent) ? draft.accent : '#A61E5E' });
    picker.addEventListener('input', () => { draft.accent = picker.value; refresh(); });
    section.append(h('div', { class: 'pref-row' }, h('span', { id: 'pref-acc', style: { 'font-weight': '600' } }, 'צבע הדגשה'),
      h('div', null, h('div', { class: 'swatches', role: 'group', 'aria-labelledby': 'pref-acc' },
        [['', 'של הערכה'], ['#A61E5E', 'מגנטה'], ['#1E5AA8', 'כחול'], ['#B3261E', 'אדום'], ['#2E7D32', 'ירוק'], ['#6A3FA0', 'סגול'], ['#9A4A00', 'כתום'], ['#00796B', 'טורקיז']].map(([v, l]) => {
          const i = h('i'); i.style.background = v || 'var(--accent)';
          return h('button', { class: 'swatch', type: 'button', 'data-pref': 'accent', 'data-val': v, 'aria-pressed': String((draft.accent || '') === v), onclick: () => { draft.accent = v; refresh(); } }, i, l);
        }), h('label', { class: 'color-pick', for: 'accent-pick' }, picker, 'צבע משלך')), status)));
    seg('mode', 'מצב תאורה', [['auto', 'לפי המכשיר'], ['light', 'בהיר'], ['dark', 'כהה']]);
    seg('contrast', 'ניגודיות', [['normal', 'רגילה'], ['high', 'גבוהה']]);
    // רקע ומשטחים
    sectionHead('רקע ומשטחים');
    seg('bg', 'רקע', [['plain', 'חלק'], ['gradient', 'גרדיאנט'], ['aurora', 'זוהר נע'], ['grid', 'נייר שרטוט'], ['dots', 'נקודות']]);
    seg('style', 'כרטיסים', [['flat', 'שטוח'], ['raised', 'מוגבה'], ['glass', 'זכוכית'], ['outline', 'קו מתאר']]);
    seg('shape', 'פינות', [['sharp', 'חדות'], ['soft', 'מעוגלות'], ['round', 'עגולות']]);
    // פריסה
    sectionHead('פריסה');
    seg('width', 'רוחב תוכן', [['regular', 'רגיל'], ['wide', 'רחב'], ['full', 'מסך מלא']]);
    seg('sidebar', 'תפריט צד', [['full', 'מלא'], ['floating', 'צף'], ['compact', 'סמלים בלבד']]);
    seg('header', 'פס עליון', [['blur', 'שקוף מטושטש'], ['solid', 'אטום']]);
    seg('density', 'צפיפות', [['compact', 'צפופה'], ['regular', 'רגילה'], ['comfortable', 'מרווחת']]);
    // טקסט
    sectionHead('טקסט');
    seg('font', 'גופן', [['sans', 'נקי'], ['serif', 'קלאסי'], ['rounded', 'מעוגל'], ['mono', 'קבוע רוחב']]);
    seg('fontSize', 'גודל טקסט', [['14', 'קטן'], ['16', 'רגיל'], ['18', 'גדול'], ['20', 'גדול מאוד']]);
    // תנועה וגרפים
    sectionHead('תנועה וגרפים');
    seg('motion', 'אנימציות בממשק', [['full', 'פעילות'], ['reduced', 'מופחתות']]);
    seg('chartAnim', 'הנפשת גרפים', [['on', 'פעילה'], ['off', 'כבויה']]);
    seg('chartGrid', 'קווי רשת', [['on', 'מוצגים'], ['off', 'מוסתרים']]);
    seg('chartTexture', 'מרקם בגרפים', [['off', 'ללא'], ['on', 'קווים אלכסוניים']]);
    section.append(h('p', { class: 'small muted' }, 'מרקם מוסיף הבחנה שלא תלויה בצבע – מומלץ לעיוורי צבעים ולהדפסה בשחור-לבן.'));

    const sample = { months: 6, sla: { onTime: 18, late: 4, open: 9, openOverdue: 2, avgDays: 6.4 },
      trend: { labels: (() => { const out = []; const d = new Date(); for (let i = 5; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)); } return out; })(),
        submitted: [6, 9, 7, 12, 10, 14], approved: [3, 6, 8, 7, 11, 10] }, byType: { planning: 14, execution: 11, completion: 6, infra: 4 } };
    function previewChartsBuild() { const c = reportCharts(sample, { compact: true }); return [c[0], c[2]]; }
    previewCharts = h('div', { class: 'charts' }, previewChartsBuild());
    const preview = h('section', { class: 'panel preview', 'aria-label': 'תצוגה מקדימה' }, h('h2', null, 'תצוגה מקדימה'),
      h('div', { class: 'req-head' }, h('div', { class: 'req-number' }, 'TH-2026-0042'), h('div', null, h('div', { class: 'req-title' }, 'הנחת קו מים ברחוב הדוגמה'), h('div', null, statusChip('coordination')))),
      routeLine({ status: 'coordination' }),
      h('div', { class: 'approvals', style: { margin: '12px 0' } }, [['מים וביוב (תאגיד)', 'approved', 'אישר'], ['חברת החשמל', 'pending', 'ממתין']].map(([n, dd, l]) => h('div', { class: 'approval' }, h('span', { class: 'mark ' + markClass(n) }), h('div', null, h('div', { class: 'who' }, n), h('div', { class: 'note dec-' + dd }, l)), h('span')))),
      previewCharts,
      h('div', { style: { display: 'flex', gap: '8px', 'margin-top': '12px', 'flex-wrap': 'wrap' } }, h('button', { class: 'btn primary', type: 'button' }, 'כפתור ראשי'), h('button', { class: 'btn', type: 'button' }, 'כפתור משני'), h('a', { href: '#/appearance' }, 'קישור לדוגמה')));
    const save = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try { const r = await api('PUT', '/api/me/prefs', { prefs: draft }); S.prefs = r.prefs; applyPrefs(S.prefs); toast('העיצוב נשמר בחשבון שלך'); } catch (ex) { toast(ex.message, true); }
    } }, 'שמירת העיצוב');
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => { applyPrefs(S.prefs); viewAppearance(main); } }, 'ביטול השינויים');
    const reset = h('button', { class: 'btn ghost', type: 'button', onclick: () => { Object.assign(draft, PREF_DEFAULTS); refresh(); } }, 'איפוס לברירת מחדל');
    main.replaceChildren(pageHead('עיצוב ותצוגה', 'השינויים מוצגים מיד, ונשמרים בחשבון שלך (בכל מכשיר) רק אחרי "שמירת העיצוב".', save, cancel, reset),
      h('div', { class: 'grid side' }, h('section', { class: 'panel', 'aria-label': 'אפשרויות עיצוב' }, groups), h('div', { class: 'sticky-preview' }, preview)));
  }

  // ---------- חשבון ----------
  function viewAccount(main) {
    const err = errBox(); const ok = h('div', { class: 'form-ok', role: 'status', hidden: true });
    const form = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'החלפת סיסמה'), err, ok,
      field('סיסמה נוכחית', inp('current', { type: 'password', autocomplete: 'current-password', dir: 'ltr' }), { required: true }),
      field('סיסמה חדשה', inp('next', { type: 'password', autocomplete: 'new-password', minlength: 12, maxlength: 128, dir: 'ltr' }), { required: true, hint: 'לפחות 12 תווים, אותיות וספרות. כל ההתחברויות האחרות ינותקו.' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'עדכון סיסמה'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { const r = await submitting(e.submitter, () => api('POST', '/api/auth/change-password', formData(form))); S.csrf = r.csrf; form.reset(); ok.textContent = 'הסיסמה עודכנה.'; ok.hidden = false; } catch (ex) { showErr(err, ex.message); }
    });
    const u = S.me;
    main.replaceChildren(pageHead('החשבון שלי'), h('div', { class: 'grid two' },
      h('section', { class: 'panel' }, h('h2', null, 'פרטים'), h('dl', { class: 'dl' }, h('dt', null, 'שם'), h('dd', null, u.full_name), h('dt', null, 'שם משתמש'), h('dd', { class: 'ltr' }, u.username),
        h('dt', null, 'תפקיד'), h('dd', null, u.role_name || '—'), h('dt', null, 'גורם תשתית'), h('dd', null, u.infra_name || 'לא משויך'),
        h('dt', null, 'דוא"ל'), h('dd', { class: 'ltr' }, u.email || '—'), h('dt', null, 'מחלקה'), h('dd', null, u.department || '—'), h('dt', null, 'כניסה אחרונה'), h('dd', null, fmtDateTime(u.last_login))),
        h('h3', { style: { 'margin-top': '16px' } }, 'ההרשאות שלך'), h('p', { class: 'small muted' }, `${S.perms.size} הרשאות פעילות. לשינוי פנו למנהל המערכת.`)), form));
  }

  // ---------- ניהול: משתמשים ----------
  // תפקידים: סמל וצבע קבועים לכל תפקיד, כדי שיהיה קל לזהות במבט
  const PUBLIC_ROLES = ['יזם', 'תושב/ת'];
  const isPublicRole = (name) => PUBLIC_ROLES.includes(name);
  function roleLook(name, id) {
    const n = String(name || '');
    if (/מנהל/.test(n)) return { icon: 'shield', tone: 1 };
    if (/רכז/.test(n)) return { icon: 'clipboard', tone: 2 };
    if (/מהנדס|מאשר/.test(n)) return { icon: 'ruler', tone: 3 };
    if (/גורם תשתית/.test(n)) return { icon: 'building', tone: 4 };
    if (n === 'יזם') return { icon: 'badge', tone: 5 };
    if (/תושב/.test(n)) return { icon: 'home2', tone: 6 };
    if (/מבקש/.test(n)) return { icon: 'user', tone: 7 };
    return { icon: 'user', tone: 8 + ((Number(id) || 0) % 3) };
  }
  const roleChip = (name, id) => { const l = roleLook(name, id); return h('span', { class: `role-chip tone-${l.tone}` }, h('span', { class: 'role-ic', 'aria-hidden': 'true' }, icon(l.icon)), name || '—'); };
  // תפריט פעולות שנפתח מסמל (⋮): נגיש למקלדת – חצים, Escape סוגר ומחזיר את הפוקוס
  function actionMenu(label, items) {
    const wrap = h('div', { class: 'act-menu' });
    const btn = h('button', { class: 'btn ghost icon-btn act-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title: label }, icon('more'));
    const list = h('div', { class: 'act-list', role: 'menu', hidden: true });
    // כשהתפריט פתוח הוא עובר לשורש העמוד: כך שום מסגרת (טבלה עם גלילה, אפקט זכוכית) לא חותכת או מזיזה אותו
    const close = (focusBtn) => { list.hidden = true; if (list.parentNode !== wrap) wrap.append(list); window.removeEventListener('hashchange', onHash); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); if (focusBtn) btn.focus(); };
    // מיקום קבוע ביחס למסך, כדי שהתפריט לא ייחתך בתוך טבלה עם גלילה; בגלילה הוא נע יחד עם הכפתור
    const place = () => {
      const r0 = btn.getBoundingClientRect(); const lh = list.offsetHeight || 200; const lw = list.offsetWidth || 220;
      if (r0.bottom < 0 || r0.top > window.innerHeight) return close(false);
      const top = window.innerHeight - r0.bottom < lh + 12 ? Math.max(8, r0.top - lh - 4) : r0.bottom + 4;
      list.style.setProperty('top', top + 'px'); list.style.setProperty('left', Math.min(Math.max(8, r0.left), window.innerWidth - lw - 8) + 'px');
    };
    const onHash = () => close(false);
    const onScroll = (e) => { if (e && e.target && e.target.nodeType === 1 && list.contains(e.target)) return; place(); };
    const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
    for (const it of items.filter(Boolean)) list.append(h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', tabindex: '-1', onclick: () => { close(false); it.run(); } }, icon(it.icon), it.label));
    btn.addEventListener('click', () => {
      if (!list.hidden) return close(true);
      document.querySelectorAll('body > .act-list:not([hidden])').forEach(x => x.dispatchEvent(new Event('act-close')));
      document.body.append(list); list.hidden = false; btn.setAttribute('aria-expanded', 'true'); window.addEventListener('hashchange', onHash);
      place();
      window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', onScroll);
      list.querySelector('[role=menuitem]').focus();
      setTimeout(() => document.addEventListener('click', outside, true));
    });
    list.addEventListener('keydown', (e) => {
      const its = [...list.querySelectorAll('[role=menuitem]')]; const i = its.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); its[(i + 1) % its.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); its[0].focus(); } else if (e.key === 'End') { e.preventDefault(); its[its.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
    });
    list.addEventListener('act-close', () => close(false));
    wrap.append(btn, list);
    return wrap;
  }

  async function viewAdminUsers(main) {
    const [{ items, roles, requests }, infra] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/infra')]);
    const roleName = Object.fromEntries(roles.map(r => [r.id, r.name]));
    const reload = () => viewAdminUsers(main);
    // כלליים: תפקיד יזם / תושב/ת, או מי שנרשם דרך "הגשת בקשה". כל השאר – בעלי הרשאה
    const isGeneral = (u) => isPublicRole(roleName[u.role_id]) || !!u.applicant_kind;
    const staff = items.filter(u => !isGeneral(u));
    const general = items.filter(isGeneral);
    const cols = (withInfra) => [
      { label: 'שם', render: u => { const l = roleLook(roleName[u.role_id], u.role_id); return h('span', { class: 'user-cell' },
        h('span', { class: `user-av tone-${l.tone}`, 'aria-hidden': 'true' }, icon(l.icon)),
        h('span', null, h('strong', { class: 'user-name' }, u.full_name), h('span', { class: 'small muted ltr user-login' }, u.username))); } },
      { label: 'תפקיד', render: u => h('span', null, roleChip(roleName[u.role_id], u.role_id), u.perm_grant.length || u.perm_deny.length ? h('span', { class: 'small muted' }, ' +התאמות') : null) },
      withInfra ? { label: 'גורם תשתית', render: u => (infra.items.find(b => b.id === u.infra_body_id) || {}).name || '—' } : { label: 'אימייל', render: u => u.email ? h('span', { class: 'ltr small' }, u.email) : '—' },
      { label: 'בקשות', render: u => u.requests.length ? h('span', { class: 'ltr small' }, u.requests.slice(0, 3).map(x => x.number).join(', ') + (u.requests.length > 3 ? ` +${u.requests.length - 3}` : '')) : '—' },
      { label: 'מצב', render: u => !u.active ? h('span', { class: 'chip st-rejected' }, 'מושבת') : u.locked ? h('span', { class: 'chip st-returned' }, 'נעול') : h('span', { class: 'chip st-approved' }, 'פעיל') },
      { label: 'כניסה אחרונה', render: u => fmtDateTime(u.last_login) },
      { label: 'פעולות', cls: 'act-col', render: u => actionMenu(`פעולות עבור ${u.full_name}`, [
        { icon: 'edit', label: 'עריכת משתמש', run: () => userDialog(u, roles, infra.items, reload, requests) },
        { icon: 'key', label: 'שינוי סיסמה', run: () => passwordDialog(u) },
        u.locked ? { icon: 'lock', label: 'שחרור נעילה', run: async () => { await api('POST', `/api/admin/users/${u.id}/unlock`, {}); toast('החשבון שוחרר'); reload(); } } : null,
        { icon: 'out', label: 'ניתוק כל ההתחברויות', run: async () => { await api('POST', `/api/admin/users/${u.id}/logout`, {}); toast('כל ההתחברויות של המשתמש נותקו'); } },
      ]) },
    ];
    // שתי תיקיות שנפתחות ונסגרות (המצב נזכר בדפדפן)
    const folder = (key, title, sub, list, withInfra, defOpen) => {
      let open = defOpen; try { const v0 = localStorage.getItem('users-folder:' + key); if (v0 !== null) open = v0 === '1'; } catch { /* */ }
      const det = h('details', { class: 'doc-folder user-folder' }); det.open = open;
      det.addEventListener('toggle', () => { try { localStorage.setItem('users-folder:' + key, det.open ? '1' : '0'); } catch { /* */ } });
      det.append(h('summary', null,
        h('span', { class: 'df-ic', 'aria-hidden': 'true' }, icon('folder')), h('span', { class: 'df-ic open', 'aria-hidden': 'true' }, icon('folderOpen')),
        h('span', { class: 'df-num' }, title), h('span', { class: 'df-title' }, sub), h('span', { class: 'df-count' }, `${list.length} משתמשים`)),
        h('div', { class: 'df-body' }, list.length ? tableOf(cols(withInfra), list, { caption: title }) : h('p', { class: 'muted' }, 'אין משתמשים בתיקייה הזו.')));
      return det;
    };
    main.replaceChildren(pageHead('משתמשים', `${items.length} משתמשים. משתמש חדש יתבקש להחליף סיסמה בכניסה הראשונה.`, h('button', { class: 'btn primary', type: 'button', onclick: () => userDialog(null, roles, infra.items, reload, requests) }, icon('plus'), 'משתמש חדש')),
      h('div', { class: 'doc-groups' },
        folder('staff', 'משתמשים בעלי הרשאה', 'כל התפקידים פרט ליזם ותושב/ת', staff, true, true),
        folder('general', 'משתמשים כלליים', 'יזמים ותושבים שנרשמו בהגשת בקשה', general, false, false)));
  }
  function passwordDialog(u) {
    const err = errBox();
    const pw1 = inp('password', { type: 'password', minlength: 12, maxlength: 128, autocomplete: 'new-password', dir: 'ltr' });
    const pw2 = inp('confirm', { type: 'password', minlength: 12, maxlength: 128, autocomplete: 'new-password', dir: 'ltr' });
    const show = h('input', { type: 'checkbox', onchange: (e) => { pw1.type = pw2.type = e.target.checked ? 'text' : 'password'; } });
    const form = h('form', { novalidate: true }, err,
      field('סיסמה חדשה', pw1, { required: true, hint: 'לפחות 12 תווים, אותיות וספרות.' }), field('אימות סיסמה', pw2, { required: true }),
      h('label', { class: 'check' }, show, 'הצגת הסיסמה'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'must_change', checked: true }), 'לחייב את המשתמש להחליף אותה בכניסה הבאה'),
      h('p', { class: 'small muted' }, 'כל ההתחברויות הפעילות של המשתמש ינותקו.'));
    const m = modal(`שינוי סיסמה – ${u.full_name}`, form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירת סיסמה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      if (pw1.value !== pw2.value) { pw2.setAttribute('aria-invalid', 'true'); pw2.focus(); return showErr(err, 'הסיסמאות אינן זהות.'); }
      try { await api('POST', `/api/admin/users/${u.id}/password`, { password: pw1.value, must_change: form.must_change.checked }); m.close(); toast(`הסיסמה של ${u.full_name} עודכנה`); } catch (ex) { showErr(err, ex.message); }
    });
  }
  async function userDialog(u, roles, infra, done, requests = []) {
    const perms = can('admin.roles') ? (await api('GET', '/api/admin/permissions')).items : [];
    u = u || { perm_grant: [], perm_deny: [], active: true, requests: [] };
    // שיוך לבקשות: רק בעריכת משתמש קיים, ולא חובה (במשתמש חדש האפשרות לא מוצגת)
    const linked = new Set((u.requests || []).map(x => x.id));
    const noneBox = h('input', { type: 'checkbox', id: 'no-req', checked: !!u.id && !linked.size });
    const reqSearch = h('input', { type: 'search', id: 'req-search', placeholder: 'חיפוש לפי מספר או נושא', maxlength: 60 });
    const reqList = h('div', { class: 'req-pick-list', role: 'group', 'aria-label': 'בקשות לשיוך' }, requests.map(r => h('label', { class: 'check', 'data-q': `${r.number} ${r.title}`.toLowerCase() },
      h('input', { type: 'checkbox', name: 'rq', value: r.id, checked: linked.has(r.id), onchange: () => { if (reqList.querySelector('input:checked')) noneBox.checked = false; } }), h('span', { class: 'ltr' }, r.number), ' ', r.title)));
    noneBox.addEventListener('change', () => { if (noneBox.checked) reqList.querySelectorAll('input').forEach(i => { i.checked = false; }); });
    reqSearch.addEventListener('input', () => { const q = reqSearch.value.trim().toLowerCase(); for (const l of reqList.children) l.hidden = !!q && !l.dataset.q.includes(q); });
    const reqPicker = h('fieldset', { id: 'req-fs' }, h('legend', null, 'שיוך לבקשה (לא חובה)'),
      h('p', { class: 'small muted', style: { margin: '0 0 6px' } }, 'המשתמש יראה גם את הבקשות שמסמנים כאן.'),
      h('label', { class: 'check' }, noneBox, 'ללא שיוך לבקשה'),
      requests.length ? [h('label', { for: 'req-search', class: 'sr-only' }, 'חיפוש בקשה'), reqSearch, reqList] : h('p', { class: 'small muted' }, 'אין עדיין בקשות במערכת.'));
    const mapCb = h('input', { type: 'checkbox', id: 'map-cb', checked: (u.perm_grant || []).includes('requests.mapping'), onchange: () => { const s0 = form.querySelector('[data-perm="requests.mapping"]'); if (s0) s0.value = mapCb.checked ? 'grant' : ''; } });
    const mapBox = h('div', { class: 'map-box' }, h('label', { class: 'check' }, mapCb, h('span', null, h('strong', null, 'אחראי מיפוי בקשות'),
      h('span', { class: 'small muted', style: { display: 'block' } }, 'מקבל הודעה ואימייל על כל בקשה חדשה מהציבור, רואה את טופס המשטרה ובוחר את גורמי התשתית ואת סדר הטיפול.'))));
    const err = errBox();
    const form = h('form', { novalidate: true }, err,
      h('div', { class: 'row' }, field('שם מלא', inp('full_name', { value: u.full_name || '', maxlength: 100 }), { required: true }),
        field('שם משתמש', inp('username', { value: u.username || '', maxlength: 60, dir: 'auto', pattern: '[A-Za-z0-9\u05D0-\u05EA][A-Za-z0-9\u05D0-\u05EA._ \\-]{1,58}[A-Za-z0-9\u05D0-\u05EA]', autocomplete: 'off' }), { required: true, hint: 'עברית או אנגלית, ספרות, רווח, נקודה, מקף.' })),
      h('div', { class: 'row' }, field('דוא"ל', inp('email', { type: 'email', value: u.email || '', maxlength: 200, dir: 'ltr' })), field('טלפון', inp('phone', { type: 'tel', value: u.phone || '', maxlength: 30, dir: 'ltr' }))),
      h('div', { class: 'row' }, field('מחלקה', inp('department', { value: u.department || '', maxlength: 100 })),
        field('תפקיד', sel('role_id', [['', 'בחרו'], ...roles.map(r => [r.id, r.name])], u.role_id, { disabled: u.id && !can('admin.roles') }), { required: true })),
      field('שיוך לגורם תשתית', sel('infra_choice', [['', 'בחרו גורם'], ['none', 'לא משויך לגורם (עובד המינהל / מבקש)'], ...infra.filter(b => b.active || b.id === u.infra_body_id).map(b => [b.id, b.name])],
        u.id ? (u.infra_body_id || 'none') : ''), { required: true, hint: 'משתמש משויך יוכל לתת חוות דעת בשם הגורם.' }),
      u.id ? reqPicker : null,
      u.id ? null : field('סיסמה ראשונית', inp('password', { type: 'password', minlength: 12, maxlength: 128, autocomplete: 'new-password', dir: 'ltr' }), { required: true, hint: 'לפחות 12 תווים. המשתמש יחליף אותה בכניסה הראשונה.' }),
      u.id ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: u.active }), 'משתמש פעיל') : null,
      perms.length ? mapBox : null,
      perms.length ? h('details', null, h('summary', { style: { cursor: 'pointer', 'font-weight': '650', padding: '8px 0' } }, 'התאמת הרשאות פרטנית למשתמש'),
        h('p', { class: 'small muted' }, 'ברירת המחדל היא הרשאות התפקיד. אפשר להעניק או לחסום הרשאה מסוימת למשתמש זה בלבד.'),
        h('div', null, perms.map(p => h('div', { class: 'perm-tri' }, h('label', { for: 'pt-' + p.key }, p.label, h('span', { class: 'small muted' }, ' · ' + p.group)),
          sel('pt-' + p.key, [['', 'לפי התפקיד'], ['grant', 'הענקה'], ['deny', 'חסימה']], u.perm_grant.includes(p.key) ? 'grant' : u.perm_deny.includes(p.key) ? 'deny' : '', { id: 'pt-' + p.key, 'data-perm': p.key }))))) : null);
    const m = modal(u.id ? `עריכת ${u.full_name}` : 'משתמש חדש', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const data = {};
      for (const el of form.elements) if (el.name && !el.name.startsWith('pt-') && !['rq', 'infra_choice'].includes(el.name) && !el.disabled) data[el.name] = el.type === 'checkbox' ? el.checked : (el.value.trim() || null);
      const ic = form.infra_choice.value;
      if (ic === 'none') data.no_infra = true; else data.infra_body_id = Number(ic);
      const rq = [...form.querySelectorAll('input[name=rq]:checked')].map(i => Number(i.value));
      if (u.id) { if (rq.length) data.request_ids = rq; else data.no_request = true; }
      if (perms.length) { data.perm_grant = []; data.perm_deny = []; for (const s of form.querySelectorAll('[data-perm]')) { if (s.value === 'grant') data.perm_grant.push(s.dataset.perm); if (s.value === 'deny') data.perm_deny.push(s.dataset.perm); } }
      try { await api(u.id ? 'PUT' : 'POST', u.id ? `/api/admin/users/${u.id}` : '/api/admin/users', data); m.close(); toast('המשתמש נשמר'); done(); } catch (ex) { showErr(err, ex.message); }
    });
  }

  // ---------- ניהול: תפקידים והרשאות ----------
  async function rolesTab(main, box) {
    const [{ items: roles }, { items: perms }] = await Promise.all([api('GET', '/api/admin/roles'), api('GET', '/api/admin/permissions')]);
    const reload = () => viewAdminRoles(main, { tab: 'roles' });
    const groups = [...new Set(perms.map(p => p.group))];
    let current = roles[0];
    const editor = h('section', { class: 'panel' });
    const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'תפקידים' });
    function draw() {
      for (const b of list.children) b.setAttribute('aria-selected', String(Number(b.dataset.id) === current.id));
      const err = errBox();
      const form = h('form', { novalidate: true }, err,
        field('שם התפקיד', inp('name', { value: current.name, maxlength: 60 }), { required: true }),
        current.system ? h('p', { class: 'small muted' }, 'תפקיד מערכת: הרשאות ניהול המשתמשים והתפקידים נשמרות בו תמיד, כדי שלא תינעלו מחוץ למערכת.') : null,
        h('p', { class: 'small muted' }, `${current.users} משתמשים בתפקיד. שינוי הרשאות מנתק אותם כדי שההרשאות החדשות יחולו מיד.`),
        groups.map(g => h('fieldset', null, h('legend', null, g), h('div', { class: 'perm-grid' }, perms.filter(p => p.group === g).map(p =>
          h('label', { class: 'check' }, h('input', { type: 'checkbox', name: p.key, checked: current.perms.includes(p.key) }), p.label))))),
        h('div', { style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } }, h('button', { class: 'btn primary', type: 'submit' }, 'שמירת הרשאות'),
          !current.system ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!(await confirmDlg('מחיקת תפקיד', `למחוק את התפקיד "${current.name}"?`, 'מחיקה', true))) return;
            try { await api('DELETE', `/api/admin/roles/${current.id}`); toast('התפקיד נמחק'); reload(); } catch (ex) { toast(ex.message, true); }
          } }, 'מחיקת תפקיד') : null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); if (!validate(form, err)) return;
        const sel2 = perms.filter(p => form.elements[p.key].checked).map(p => p.key);
        try { await api('PUT', `/api/admin/roles/${current.id}`, { name: form.elements.name.value, perms: sel2 }); toast('ההרשאות נשמרו'); reload(); } catch (ex) { showErr(err, ex.message); }
      });
      editor.replaceChildren(form);
    }
    for (const r of roles) list.append(h('button', { type: 'button', role: 'tab', 'data-id': r.id, onclick: () => { current = r; draw(); } }, r.name));
    draw();
    box.replaceChildren(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const err = errBox(); const form = h('form', { novalidate: true }, err, field('שם התפקיד החדש', inp('name', { maxlength: 60 }), { required: true }));
        const m = modal('תפקיד חדש', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'יצירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
        form.addEventListener('submit', async (e) => { e.preventDefault(); if (!validate(form, err)) return; try { await api('POST', '/api/admin/roles', { name: form.elements.name.value, perms: ['requests.view_own'] }); m.close(); reload(); } catch (ex) { showErr(err, ex.message); } });
      } }, icon('plus'), 'תפקיד חדש')), list, editor);
  }

  // ---------- ניהול: הגדרות, סוגי קבצים, גורמי תשתית ----------

  async function infraTab(main, box) {
    // רק משתמשים בעלי הרשאה (לא יזם / תושב/ת) – לאיש קשר ולשיוך לגורם
    const [{ items }, users] = await Promise.all([api('GET', '/api/admin/infra'), api('GET', '/api/users/lookup?staff=1')]);
    const reload = () => viewAdminRoles(main, { tab: 'infra' });
    const err = errBox();
    const add = h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => editDialog(null) }, icon('plus'), 'הוספת גורם תשתית'));
    // אותו חלון להוספה ולעריכה
    function editDialog(b) {
      const isNew = !b; b = b || { name: '', contact: '', contact_user_id: null, active: 1, members: [] };
      const dErr = errBox();
      const memberSearch = h('input', { type: 'search', id: 'mem-search', placeholder: 'חיפוש משתמש', maxlength: 60, autocomplete: 'off' });
      const memberList = h('div', { class: 'req-pick-list', role: 'group', 'aria-label': 'משתמשים בעלי הרשאה' }, users.items.map(u => h('label', { class: 'check', 'data-q': `${u.full_name} ${u.role_name}`.toLowerCase() },
        h('input', { type: 'checkbox', name: 'm' + u.id, value: u.id, checked: b.members.some(x => x.id === u.id) }),
        u.full_name, h('span', { class: 'small muted' }, ` · ${u.role_name}${u.infra_body_id && u.infra_body_id !== b.id ? ' (משויך כעת לגורם אחר)' : ''}`))));
      memberSearch.addEventListener('input', () => { const q = memberSearch.value.trim().toLowerCase(); for (const l of memberList.children) l.hidden = !!q && !l.dataset.q.includes(q); });
      const form = h('form', { novalidate: true }, dErr,
        field('שם הגורם', inp('name', { value: b.name, maxlength: 100 }), { required: true }),
        field('איש קשר למשימות', sel('contact_user_id', [['', 'לא הוגדר'], ...users.items.map(u => [u.id, `${u.full_name} (${u.role_name})`])], b.contact_user_id || ''),
          { hint: 'רק משתמשים בעלי הרשאה. משימה שמוקצית לגורם נשלחת לאיש הקשר, בהודעה במערכת ובאימייל.' }),
        field('פרטי קשר נוספים (טלפון וכו׳)', inp('contact', { value: b.contact || '', maxlength: 200 })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: !!b.active }), 'גורם פעיל (מופיע בבחירת גורמים לבקשה)'),
        h('fieldset', null, h('legend', null, 'משתמשים שמשויכים לגורם'),
          h('p', { class: 'small muted' }, 'רק משתמשים בעלי הרשאה. משתמש משויך רואה את הבקשות שהגורם נדרש להן ונותן חוות דעת בשמו. משתמש יכול להיות משויך לגורם אחד.'),
          users.items.length > 8 ? [h('label', { for: 'mem-search', class: 'sr-only' }, 'חיפוש משתמש'), memberSearch] : null,
          users.items.length ? memberList : h('p', { class: 'muted' }, 'אין עדיין משתמשים בעלי הרשאה.')));
      const m = modal(isNew ? 'הוספת גורם תשתית' : `עריכת ${b.name}`, form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, isNew ? 'הוספה' : 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); if (!validate(form, dErr)) return;
        const member_ids = [...form.querySelectorAll('input[name^="m"]:checked')].map(i => Number(i.value));
        const data = { name: form.elements.name.value, contact: form.contact.value, contact_user_id: form.contact_user_id.value ? Number(form.contact_user_id.value) : null, active: form.active.checked, member_ids };
        try { await api(isNew ? 'POST' : 'PUT', isNew ? '/api/admin/infra' : `/api/admin/infra/${b.id}`, data); m.close(); toast(isNew ? 'הגורם נוסף' : 'הגורם עודכן'); reload(); } catch (ex) { showErr(dErr, ex.message); }
      });
    }
    box.replaceChildren(h('p', { class: 'muted' }, 'הגופים שנותנים חוות דעת על בקשות (מים, חשמל, תקשורת…). כאן מוסיפים, עורכים ומשייכים אליהם משתמשים.'), err, add,
      h('div', { class: 'approvals' }, items.map(b => h('div', { class: 'approval' }, h('span', { class: 'mark ' + markClass(b.name), 'aria-hidden': 'true' }),
        h('div', null, h('div', { class: 'who' }, b.name, b.active ? null : h('span', { class: 'chip st-closed', style: { 'margin-inline-start': '8px' } }, 'מושבת')),
          h('div', { class: 'note' }, b.contact_user_name ? `איש קשר: ${b.contact_user_name}` : 'לא הוגדר איש קשר', b.contact ? ` (${b.contact})` : '', ` · ${b.members.length ? 'משויכים: ' + b.members.map(m => m.full_name).join(', ') : 'אין משתמשים משויכים'} · ${b.requests} בקשות`)),
        h('span', { style: { display: 'flex', gap: '6px', 'flex-wrap': 'wrap' } },
          h('button', { class: 'btn sm', type: 'button', onclick: () => editDialog(b) }, icon('edit'), 'עריכה'),
          h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `מחיקת ${b.name}`, onclick: async () => {
            if (!(await confirmDlg('מחיקת גורם', `למחוק את "${b.name}"? אם כבר נתן חוות דעת בבקשות – אפשר רק להשבית אותו.`, 'מחיקה', true))) return;
            try { await api('DELETE', `/api/admin/infra/${b.id}`); toast('הגורם נמחק'); reload(); } catch (ex) { toast(ex.message, true); }
          } }, icon('trash')))))));
  }
  async function viewAdminRoles(main, q = {}) {
    const tab = q.tab === 'infra' ? 'infra' : 'roles';
    const box = h('div', { role: 'tabpanel', id: 'roles-panel', 'aria-labelledby': 'rt-' + tab });
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'ניהול הרשאות' },
      [['roles', 'תפקידים והרשאות'], ['infra', 'גורמי תשתית']].map(([k, l]) => h('button', { type: 'button', role: 'tab', id: 'rt-' + k, 'aria-controls': 'roles-panel', 'aria-selected': String(k === tab), tabindex: k === tab ? 0 : -1,
        onclick: () => { location.hash = '#/admin/roles' + (k === 'infra' ? '?tab=infra' : ''); } }, l)));
    tabs.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); location.hash = '#/admin/roles' + (tab === 'infra' ? '' : '?tab=infra'); } });
    main.replaceChildren(pageHead('תפקידים והרשאות', 'קבעו לכל תפקיד אילו פעולות מותרות, ונהלו את גורמי התשתית. כל הרשאה נאכפת בשרת.'), tabs, box);
    if (tab === 'infra') await infraTab(main, box); else await rolesTab(main, box);
    main.querySelector('#rt-' + tab).focus({ preventScroll: true });
  }

  // ---------- ניהול: סוגי בקשות ----------
  async function viewAdminTypes(main) {
    const [{ items, roles }, { items: infra }] = await Promise.all([api('GET', '/api/admin/request-types'), api('GET', '/api/infra')]);
    const reload = () => viewAdminTypes(main);
    const bName = (id) => (infra.find(b => b.id === id) || {}).name || '—';
    const rName = (id) => (roles.find(r => r.id === id) || {}).name || 'ברירת מחדל';
    const card = (t) => h('article', { class: 'panel type-card' + (t.active ? '' : ' off') },
      h('div', { class: 'panel-head' }, h('h2', null, t.name), h('div', { class: 'actions' },
        t.active ? null : h('span', { class: 'chip plain' }, 'לא פעיל'), t.active && t.public ? h('span', { class: 'chip ok-chip' }, 'פתוח לציבור') : null,
        h('button', { class: 'btn sm', type: 'button', onclick: () => typeDialog(t) }, icon('edit'), 'עריכה'),
        t.requests ? null : h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `מחיקת ${t.name}`, onclick: async () => {
          if (!(await confirmDlg('מחיקת סוג בקשה', `למחוק את "${t.name}"?`, 'מחיקה', true))) return;
          try { await api('DELETE', `/api/admin/request-types/${t.id}`); toast('נמחק'); reload(); } catch (ex) { toast(ex.message, true); } } }, icon('trash')))),
      t.description ? h('p', { class: 'muted' }, t.description) : null,
      h('dl', { class: 'dl' },
        h('dt', null, 'גורמי תשתית'), h('dd', null, t.infra_chain.length
          ? h('ol', { class: 'chain-steps', 'aria-label': 'גורמי התשתית לפי סדר הטיפול' }, t.infra_chain.map((id, i) => h('li', null, h('span', { class: 'seq', 'aria-hidden': 'true' }, String(i + 1)), bName(id))))
          : h('span', { class: 'muted' }, 'לא נבחרו גורמים')),
        h('dt', null, 'תפקיד לתושב/ת'), h('dd', null, rName(t.role_resident)),
        h('dt', null, 'תפקיד ליזם'), h('dd', null, rName(t.role_entrepreneur)),
        h('dt', null, 'בקשות מסוג זה'), h('dd', null, String(t.requests))));
    function typeDialog(t) {
      t = t || { active: 1, public: 1, infra_chain: [] };
      const err = errBox();
      const pick = orderedPicker(infra.filter(b => b.active || t.infra_chain.includes(b.id)), t.infra_chain, 'גורמי תשתית קבועים, לפי סדר הטיפול');
      const roleSel = (name, val) => sel(name, [['', 'ברירת מחדל (תושב/ת או יזם)'], ...roles.map(r => [r.id, r.name])], val || '');
      const form = h('form', { novalidate: true }, err,
        field('שם סוג הבקשה', inp('name', { value: t.name || '', maxlength: 100 }), { required: true }),
        field('תיאור (מוצג למגישים)', area('description', { value: t.description || '', maxlength: 500, rows: 2 })),
        h('div', { class: 'row' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: !!t.active }), 'פעיל'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'public', checked: !!t.public }), 'זמין בהגשה מהציבור')),
        pick.el,
        h('fieldset', null, h('legend', null, 'הרשאות לנרשמים מהציבור'), h('p', { class: 'small muted' }, 'קבוצת ההרשאות שמקבל מי שנרשם עם סוג בקשה זה. אפשר להגדיר קבוצות נוספות ב"תפקידים והרשאות".'),
          h('div', { class: 'row' }, field('תושב/ת', roleSel('role_resident', t.role_resident)), field('יזם', roleSel('role_entrepreneur', t.role_entrepreneur)))));
      const m = modal(t.id ? `עריכת ${t.name}` : 'סוג בקשה חדש', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); if (!validate(form, err)) return;
        const data = { name: form.name.value.trim(), description: form.description.value.trim(), active: form.active.checked, public: form.public.checked,
          infra_chain: pick.get(),
          role_resident: form.role_resident.value ? Number(form.role_resident.value) : null, role_entrepreneur: form.role_entrepreneur.value ? Number(form.role_entrepreneur.value) : null };
        try { await api(t.id ? 'PUT' : 'POST', t.id ? `/api/admin/request-types/${t.id}` : '/api/admin/request-types', data); m.close(); toast('סוג הבקשה נשמר'); await refreshMe(); reload(); } catch (ex) { showErr(err, ex.message); }
      });
    }
    main.replaceChildren(pageHead('סוגי בקשות', 'לכל סוג: גורמי תשתית בסדר קבוע, וקבוצת הרשאות לתושבים וליזמים.',
      h('button', { class: 'btn primary', type: 'button', onclick: () => typeDialog() }, icon('plus'), 'סוג בקשה חדש')), h('div', { class: 'grid two' }, items.map(card)));
  }

  async function viewAdminSettings(main) {
    const s = await api('GET', '/api/admin/settings');
    const reload = () => viewAdminSettings(main);
    let ext = [...s.allowed_ext];
    const tags = h('div', { class: 'tag-list', 'aria-live': 'polite' });
    const drawTags = () => tags.replaceChildren(...ext.map(e => h('span', { class: 'tag' }, '.' + e, h('button', { type: 'button', 'aria-label': `הסרת הסיומת ${e}`, onclick: () => { ext = ext.filter(x => x !== e); drawTags(); } }, '×'))));
    drawTags();
    const addErr = errBox();
    const addInput = h('input', { type: 'text', id: 'addext', maxlength: 8, dir: 'ltr', list: 'known-ext', placeholder: 'למשל: pptx', style: { 'max-width': '180px' } });
    const datalist = h('datalist', { id: 'known-ext' }, s.known_ext.map(e => h('option', { value: e })));
    const addBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
      const v = addInput.value.trim().toLowerCase().replace(/^\./, '');
      addErr.hidden = true;
      if (!/^[a-z0-9]{1,8}$/.test(v)) return showErr(addErr, 'סיומת לא תקינה.');
      if (s.forbidden_ext.includes(v)) return showErr(addErr, `הסיומת .${v} חסומה מטעמי אבטחה (קבצי הרצה, סקריפטים, HTML/SVG).`);
      if (!ext.includes(v)) ext.push(v); addInput.value = ''; drawTags();
    } }, 'הוספה');
    const fErr = errBox();
    const files = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'קבצים מותרים להעלאה'), fErr,
      h('p', { class: 'muted' }, 'סוגי הקבצים שמשתמשים רשאים להעלות. כל קובץ נבדק גם לפי התוכן שלו, לא רק לפי הסיומת.'),
      tags, h('div', { class: 'toolbar', style: { 'margin-top': '12px' } }, h('div', { class: 'field' }, h('label', { for: 'addext' }, 'הוספת סיומת'), addInput, datalist), addBtn), addErr,
      field('גודל קובץ מרבי (MB)', inp('max_mb', { type: 'number', min: 1, max: s.hard_max_mb, value: s.max_mb }), { required: true, hint: `תקרה קשיחה בשרת: ${s.hard_max_mb}MB.` }),
      h('details', null, h('summary', { style: { cursor: 'pointer' } }, 'סיומות שתמיד חסומות'), h('p', { class: 'small muted ltr' }, s.forbidden_ext.join(', '))),
      h('fieldset', { style: { 'margin-top': '14px' } }, h('legend', null, 'מי רואה מסמכים'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'docs_visibility', value: 'own', checked: s.docs_visibility === 'own' }), 'כל משתמש רואה רק את המסמכים שהעלה. מנהל המערכת רואה הכל.'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'docs_visibility', value: 'request', checked: s.docs_visibility === 'request' }), 'כל מי שרשאי לראות בקשה רואה את כל המסמכים שלה.')),
      h('button', { class: 'btn primary', type: 'submit', style: { 'margin-top': '12px' } }, 'שמירת הגדרות קבצים'));
    files.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(files, fErr)) return;
      try { await api('PUT', '/api/admin/settings', { allowed_ext: ext, max_mb: files.max_mb.value, docs_visibility: files.querySelector('[name=docs_visibility]:checked').value }); toast('הגדרות הקבצים נשמרו'); await refreshMe(); reload(); } catch (ex) { showErr(fErr, ex.message); }
    });
    const gErr = errBox();
    const general = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'כללי וזמני טיפול'), gErr,
      h('div', { class: 'row' }, field('שם המערכת', inp('system_title', { value: s.system_title, maxlength: 100 }), { required: true }), field('שם הארגון', inp('org_name', { value: s.org_name, maxlength: 100 }), { required: true })),
      field('ימי טיפול לבקשה', inp('sla_regular_days', { type: 'number', min: 1, max: 365, value: s.sla_regular_days }), { required: true, hint: 'מועד היעד לטיפול נקבע לפי מספר הימים מההגשה.' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'public_apply', checked: s.public_apply }), 'כפתור "הגשת בקשה" פתוח לתושבים וליזמים במסך הכניסה'),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירה'));
    general.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(general, gErr)) return;
      try { await api('PUT', '/api/admin/settings', formData(general)); toast('ההגדרות נשמרו'); await refreshMe(); renderShell(); route(); } catch (ex) { showErr(gErr, ex.message); }
    });
    // מסך הכניסה: הכותרת והתיאור בצד
    const lgErr = errBox();
    const loginForm = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'מסך הכניסה'), lgErr,
      h('p', { class: 'muted' }, 'הטקסט שמופיע בצד מסך הכניסה, מעל הרקע הכחול.'),
      field('כותרת', inp('login_heading', { value: s.login_heading || '', maxlength: 120, placeholder: s.system_title }), { hint: 'ריק = שם המערכת.' }),
      field('תיאור', area('login_text', { rows: 3, maxlength: 600, value: s.login_text || '' }), { hint: 'ריק = בלי תיאור.' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירת מסך הכניסה'));
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(loginForm, lgErr)) return;
      try { await api('PUT', '/api/admin/settings', { login_heading: loginForm.login_heading.value, login_text: loginForm.login_text.value }); await refreshMe(); toast('מסך הכניסה עודכן'); } catch (ex) { showErr(lgErr, ex.message); }
    });
    // כפתור נגישות: אפשרויות, עיצוב, צורה, גודל, צד
    const A11Y_LABELS = { font: 'הגדלת טקסט', contrast: 'ניגודיות גבוהה', dark: 'ניגודיות הפוכה', gray: 'גווני אפור', links: 'הדגשת קישורים', headings: 'הדגשת כותרות', readable: 'גופן קריא', spacing: 'ריווח טקסט', motion: 'עצירת אנימציות', cursor: 'סמן גדול', guide: 'סרגל קריאה' };
    const ac = s.a11y || {};
    const axErr = errBox();
    const axPreview = h('span', { class: 'a11y-fab a11y-preview', 'aria-hidden': 'true' }, (() => { const v0 = svg('svg', { viewBox: '0 0 24 24' }, svg('path', { d: 'M12 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 8.5l8 1.5 8-1.5M12 10v5M12 15l-3.5 6.5M12 15l3.5 6.5' })); return v0; })());
    const axForm = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'כפתור נגישות'), axErr,
      h('p', { class: 'muted' }, 'כפתור צף במסך הכניסה ובתוך המערכת. כל משתמש יכול לגרור אותו למקום אחר במסך, והבחירות שלו נשמרות בדפדפן שלו.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'a11y_enabled', checked: ac.enabled !== false }), 'הצגת כפתור הנגישות'),
      h('fieldset', null, h('legend', null, 'האפשרויות בתפריט'),
        h('div', { class: 'a11y-feat-grid' }, (s.a11y_features || Object.keys(A11Y_LABELS)).map(f => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'af', value: f, checked: (ac.features || []).includes(f) }), A11Y_LABELS[f] || f)))),
      h('div', { class: 'row' },
        field('צבע', inp('a11y_color', { type: 'color', value: ac.color || '#0B62B8' })),
        field('צורה', sel('a11y_shape', [['circle', 'עיגול'], ['rounded', 'ריבוע מעוגל'], ['square', 'ריבוע']], ac.shape || 'circle')),
        field('גודל', sel('a11y_size', [['sm', 'קטן'], ['md', 'בינוני'], ['lg', 'גדול']], ac.size || 'md'))),
      h('div', { class: 'row' },
        field('צד במסך (ברירת מחדל)', sel('a11y_side', [['left', 'שמאל למטה'], ['right', 'ימין למטה']], ac.side || 'left')),
        field('כיתוב (לקוראי מסך)', inp('a11y_label', { value: ac.label || 'נגישות', maxlength: 30 }))),
      h('div', { class: 'a11y-preview-row' }, h('span', { class: 'small muted' }, 'תצוגה מקדימה:'), axPreview),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירה'));
    const axData = () => ({ enabled: axForm.a11y_enabled.checked, features: [...axForm.querySelectorAll('input[name=af]:checked')].map(i => i.value),
      color: axForm.a11y_color.value, shape: axForm.a11y_shape.value, size: axForm.a11y_size.value, side: axForm.a11y_side.value, label: axForm.a11y_label.value.trim() || 'נגישות' });
    const axPrev = () => { const d0 = axData(); axPreview.className = `a11y-fab a11y-preview shape-${d0.shape} size-${d0.size}`; axPreview.style.setProperty('--a11y-color', d0.color); };
    axForm.addEventListener('input', axPrev); axForm.addEventListener('change', axPrev); axPrev();
    axForm.addEventListener('submit', async (e) => {
      e.preventDefault(); axErr.hidden = true;
      const d0 = axData();
      if (d0.enabled && !d0.features.length) return showErr(axErr, 'יש לבחור לפחות אפשרות אחת, או לכבות את הכפתור.');
      try { await api('PUT', '/api/admin/settings', { a11y: d0 }); S.a11y = d0; a11yWidget.mount(d0); toast('הגדרות כפתור הנגישות נשמרו'); } catch (ex) { showErr(axErr, ex.message); }
    });
    // דוא"ל: מצב ההגדרה ואימייל בדיקה
    const ml = s.mail || {};
    const mlResult = h('div', { class: 'mail-result', role: 'status', 'aria-live': 'polite' });
    const mlTo = inp('test_to', { type: 'email', value: S.me.email || '', maxlength: 200, dir: 'ltr', autocomplete: 'email' });
    const tName = { smtp: 'SMTP', brevo: 'Brevo API' };
    const mlErr = errBox();
    const mlForm = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'דוא"ל'), mlErr,
      h('dl', { class: 'dl' },
        h('dt', null, 'מצב'), h('dd', null, ml.transport ? h('span', { class: 'chip ok-chip' }, `מוגדר – ${tName[ml.transport]}`) : h('span', { class: 'chip late' }, 'לא מוגדר')),
        h('dt', null, 'כתובת השולח'), h('dd', { dir: 'ltr', style: { 'text-align': 'right' } }, ml.from || '—'),
        ml.transport === 'smtp' ? [h('dt', null, 'שרת SMTP'), h('dd', { dir: 'ltr', style: { 'text-align': 'right' } }, ml.smtp)] : null),
      field('שליחת אימייל בדיקה אל', mlTo, { required: true }),
      h('button', { class: 'btn primary', type: 'submit' }, icon('send'), 'שליחת אימייל בדיקה'), mlResult,
      h('details', { class: 'mail-help' }, h('summary', null, 'איך מגדירים? (Render + Brevo)'),
        h('p', { class: 'small' }, 'מוסיפים את המשתנים ב-Render: השירות ← Environment. השרת החינמי של Render חוסם את פורטי הדואר הרגילים, ולכן הדרך המומלצת היא Brevo API:'),
        h('table', { class: 'env-table' }, h('tbody', null,
          [['BREVO_API_KEY', 'מפתח API מ-Brevo (SMTP & API ← API Keys)'], ['MAIL_FROM', 'כתובת השולח שאומתה ב-Brevo']].map(([k, d0]) =>
            h('tr', null, h('th', { scope: 'row' }, h('code', { dir: 'ltr' }, k)), h('td', null, d0))))),
        h('p', { class: 'small' }, 'או, במקום ה-API, SMTP של Brevo בפורט 2525:'),
        h('table', { class: 'env-table' }, h('tbody', null,
          [['SMTP_HOST', 'smtp-relay.brevo.com'], ['SMTP_PORT', '2525'], ['SMTP_USER', 'ה-Login מ-Brevo'], ['SMTP_PASS', 'מפתח SMTP מ-Brevo']].map(([k, d0]) =>
            h('tr', null, h('th', { scope: 'row' }, h('code', { dir: 'ltr' }, k)), h('td', { dir: /^[\w.-]+$/.test(d0) ? 'ltr' : null }, d0))))),
        h('p', { class: 'small muted' }, 'המפתחות נשמרים רק בשרת ולא מוצגים כאן. אחרי השמירה ב-Render, השירות עולה מחדש ואפשר לשלוח אימייל בדיקה.')));
    mlForm.addEventListener('submit', async (e) => {
      e.preventDefault(); mlResult.replaceChildren();
      if (!validate(mlForm, mlErr)) return;
      const btn = mlForm.querySelector('[type=submit]');
      try {
        const r = await submitting(btn, () => api('POST', '/api/admin/mail/test', { to: mlTo.value.trim() }));
        mlResult.replaceChildren(h('p', { class: 'mail-ok' }, icon('check'), ` נשלח בהצלחה דרך ${tName[r.transport]} אל ${r.to}. בדקו את תיבת הדואר (וגם את תיקיית הספאם).`));
      } catch (ex) {
        if (/לא מוגדר/.test(ex.message)) mlForm.querySelector('.mail-help').open = true;
        mlResult.replaceChildren(h('div', { class: 'form-error', role: 'alert' }, h('strong', null, 'השליחה נכשלה: '), h('span', { dir: 'auto' }, ex.message),
          /timeout|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|אין חיבור/i.test(ex.message) && (!ml.transport || ml.transport === 'smtp') ? h('p', { style: { margin: '6px 0 0' } }, 'נראה שהחיבור לשרת ה-SMTP חסום (כך ב-Render החינמי). הגדירו BREVO_API_KEY כדי לשלוח דרך Brevo API.') : null));
      }
    });
    // תזכורות לגורמי תשתית
    const rmErr = errBox();
    const rmForm = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'תזכורות לגורמי תשתית'), rmErr,
      h('p', { class: 'muted' }, 'גורם שהגיע תורו ולא טיפל בבקשה מקבל אימייל והתראה עם מספר הבקשה וקישור אליה.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'reminder_enabled', checked: s.reminder_enabled }), 'שליחת תזכורות פעילה'),
      h('div', { class: 'row' },
        field('תזכורת ראשונה אחרי (ימים)', inp('reminder_days', { type: 'number', min: 1, max: 365, value: s.reminder_days }), { required: true, hint: 'מהרגע שהגיע תורו של הגורם.' }),
        field('תזכורת חוזרת כל (ימים)', inp('reminder_repeat_days', { type: 'number', min: 0, max: 365, value: s.reminder_repeat_days }), { required: true, hint: '0 = תזכורת אחת בלבד.' })),
      h('div', { class: 'actions', style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
        h('button', { class: 'btn primary', type: 'submit' }, 'שמירה'),
        h('button', { class: 'btn', type: 'button', onclick: async (e) => {
          try { const r = await submitting(e.currentTarget, () => api('POST', '/api/admin/reminders/run')); toast(r.sent ? `נשלחו ${r.sent} תזכורות` : 'אין כרגע גורמים שצריך להזכיר להם'); } catch (ex) { showErr(rmErr, ex.message); }
        } }, 'בדיקה ושליחה עכשיו')),
      h('p', { class: 'small muted' }, 'המערכת בודקת כל שעה. בשרת חינמי שנכנס למצב שינה, הבדיקה מתבצעת כשהשרת מתעורר.'));
    rmForm.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(rmForm, rmErr)) return;
      try { await api('PUT', '/api/admin/settings', { reminder_enabled: rmForm.reminder_enabled.checked, reminder_days: Number(rmForm.reminder_days.value), reminder_repeat_days: Number(rmForm.reminder_repeat_days.value) }); toast('הגדרות התזכורות נשמרו'); } catch (ex) { showErr(rmErr, ex.message); }
    });
    // מפת GovMap
    const gmErr = errBox();
    const gmForm = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'מפת GovMap'), gmErr,
      h('p', { class: 'muted' }, 'המפה שבה המגישים מסמנים את מיקום העבודה, ושמוצגת בכל בקשה. היא דורשת מפתח (טוקן) של GovMap שמונפק לכתובת האתר.'),
      s.govmap_env ? h('p', { class: 'small' }, 'המפתח מוגדר כבר בשרת (GOVMAP_TOKEN), והוא גובר על השדה כאן.') : null,
      field('מפתח GovMap', inp('govmap_token', { value: s.govmap_token || '', maxlength: 400, dir: 'ltr', autocomplete: 'off', spellcheck: 'false' }),
        { hint: 'בלי מפתח המגישים פותחים את GovMap בלשונית נפרדת ומדביקים קישור למיקום.' }),
      h('p', { class: 'small' }, h('a', { href: 'https://www.gov.il/he/service/token', target: '_blank', rel: 'noopener noreferrer' }, 'בקשה לקבלת מפתח GovMap באתר gov.il'), ' – בבקשה מציינים את כתובת האתר של המערכת.'),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירת מפתח'));
    gmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('PUT', '/api/admin/settings', { govmap_token: gmForm.govmap_token.value.trim() }); toast(gmForm.govmap_token.value.trim() ? 'מפתח GovMap נשמר – המפה פעילה' : 'המפתח הוסר'); } catch (ex) { showErr(gmErr, ex.message); }
    });
    // הנחיות במסמך האישור
    const gdErr = errBox();
    const guide = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'מסמך האישור'), gdErr,
      h('p', { class: 'muted' }, 'כשמנהל המערכת מאשר בקשה, נוצר אוטומטית מסמך "אישור לביצוע עבודה" עם הלוגו ופרטי הבקשה, ונשלח למגיש באימייל.'),
      field('הנחיות ותנאים כלליים', area('guidelines', { rows: 9, maxlength: 8000, value: s.guidelines || '' }), { hint: 'שורה לכל סעיף. יופיעו בסוף מסמך האישור.' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירת הנחיות'));
    guide.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(guide, gdErr)) return;
      try { await api('PUT', '/api/admin/settings', { guidelines: guide.guidelines.value }); toast('ההנחיות נשמרו'); } catch (ex) { showErr(gdErr, ex.message); }
    });
    // מספור בקשות
    const nErr = errBox();
    const preview = h('strong', { class: 'ltr', 'aria-live': 'polite' }, s.req_next_preview);
    const numbering = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'מספור בקשות'), nErr,
      h('p', { class: 'muted' }, 'כך נקבע המספר של כל בקשה חדשה. בקשות קיימות שומרות על המספר שלהן.'),
      h('div', { class: 'row' }, field('קידומת', inp('req_prefix', { value: s.req_prefix || '', maxlength: 10, dir: 'ltr', pattern: '[A-Za-z0-9֐-׿]*' }), { hint: 'אותיות וספרות, למשל TH או תה. אפשר להשאיר ריק.' }),
        field('מספר ספרות', inp('req_pad', { type: 'number', min: 1, max: 8, value: s.req_pad }), { required: true, hint: '4 → 0001' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'req_with_year', checked: s.req_with_year }), 'לכלול את השנה במספר'),
      field('המספר הבא שיינתן', inp('req_next', { type: 'number', min: 1, max: 99999999, placeholder: 'אוטומטי' }), { hint: 'למשל כדי להמשיך מהמספור במערכת הקודמת. ריק = ממשיך אוטומטית מהמספר הגבוה הקיים.' }),
      h('p', null, 'הבקשה הבאה תקבל את המספר: ', preview),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירת מספור'));
    numbering.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(numbering, nErr)) return;
      try { await api('PUT', '/api/admin/settings', formData(numbering)); toast('הגדרות המספור נשמרו'); reload(); } catch (ex) { showErr(nErr, ex.message); }
    });
    // לוגו
    const lStatus = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const lInput = h('input', { type: 'file', id: 'logo-file', accept: '.png,.jpg,.jpeg,.webp', class: 'sr-only' });
    const lImg = h('img', { src: logoUrl(), alt: s.logo ? 'הלוגו הנוכחי' : 'לוגו ברירת המחדל', class: 'logo-preview' });
    lInput.addEventListener('change', async () => {
      const f = lInput.files[0]; if (!f) return;
      if (!/\.(png|jpe?g|webp)$/i.test(f.name)) { lStatus.className = 'small sev-critical'; lStatus.textContent = 'הלוגו חייב להיות PNG, JPG או WebP.'; return; }
      if (f.size > 1048576) { lStatus.className = 'small sev-critical'; lStatus.textContent = 'הקובץ גדול מ-1MB.'; return; }
      const fd = new FormData(); fd.append('file', f);
      lStatus.className = 'small'; lStatus.textContent = 'מעלה…';
      try { await api('POST', '/api/admin/logo', fd); await refreshMe(); toast('הלוגו הוחלף – הוא מופיע עכשיו במסך הכניסה ובמערכת'); renderShell(); route(); }
      catch (ex) { lStatus.className = 'small sev-critical'; lStatus.textContent = ex.message; }
    });
    const logoPanel = h('section', { class: 'panel', 'aria-labelledby': 'logo-h' }, h('h2', { id: 'logo-h' }, 'לוגו'),
      h('p', { class: 'muted' }, s.logo ? 'לוגו שהועלה. מופיע במסך הכניסה ובראש תפריט הצד.' : 'מוצג לוגו ברירת המחדל של הארגון. אפשר להחליף אותו: PNG, JPG או WebP עד 1MB, מומלץ רקע שקוף.'),
      h('div', { class: 'logo-box' }, lImg),
      h('div', { style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'margin-top': '12px' } },
        h('label', { class: 'btn primary', for: 'logo-file' }, icon('upload'), s.logo ? 'החלפת לוגו' : 'העלאת לוגו'), lInput,
        s.logo ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!(await confirmDlg('חזרה ללוגו ברירת המחדל', 'להסיר את הלוגו שהועלה ולחזור ללוגו ברירת המחדל?', 'חזרה לברירת המחדל', true))) return;
          try { await api('DELETE', '/api/admin/logo'); await refreshMe(); toast('חזרנו ללוגו ברירת המחדל'); renderShell(); route(); } catch (ex) { toast(ex.message, true); }
        } }, 'חזרה ללוגו ברירת המחדל') : null), lStatus);
    main.replaceChildren(pageHead('הגדרות וקבצים', 'גורמי התשתית עברו למסך "תפקידים והרשאות", בלשונית משלהם.'), h('div', { class: 'grid two' }, h('div', null, logoPanel, files), h('div', null, general, axForm, mlForm, rmForm, loginForm, gmForm, numbering, guide)));
  }
  async function refreshMe() {
    const me = await api('GET', '/api/auth/me');
    S.me = me.user; S.perms = new Set(me.perms); S.meta = me.meta; S.title = me.title; S.org = me.org; S.csrf = me.csrf; S.logo = me.logo; S.login = me.login || S.login;
  }

  // ---------- ניהול: יומן אבטחה ----------
  async function viewAdminAudit(main, q) {
    const p = new URLSearchParams(); if (q.suspicious) p.set('suspicious', '1'); if (q.q) p.set('q', q.q);
    const { items, summary } = await api('GET', '/api/admin/audit?' + p);
    const kpi = (v, l) => h('div', { class: 'kpi' + (v ? ' alert' : '') }, h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l));
    const f = h('form', { class: 'toolbar', role: 'search' }, h('div', { class: 'field grow' }, h('label', { for: 'aq' }, 'חיפוש לפי פעולה, משתמש או IP'), h('input', { id: 'aq', name: 'q', type: 'search', value: q.q || '', maxlength: 100 })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'suspicious', checked: !!q.suspicious }), 'רק פעילות חשודה'), h('button', { class: 'btn', type: 'submit' }, 'סינון'));
    f.addEventListener('submit', (e) => { e.preventDefault(); const pp = new URLSearchParams(); if (f.q.value) pp.set('q', f.q.value); if (f.suspicious.checked) pp.set('suspicious', '1'); location.hash = '#/admin/audit?' + pp; });
    main.replaceChildren(pageHead('יומן פעילות ואבטחה', 'כל פעולה רגישה נרשמת. אירועים חשודים נשמרים גם בקובץ יומן נפרד בשרת.'),
      h('h2', null, '24 השעות האחרונות'),
      h('div', { class: 'kpis' }, kpi(summary.failedLogins, 'כניסות כושלות'), kpi(summary.lockouts, 'חשבונות ננעלו'), kpi(summary.rateLimited, 'חסימות עומס'),
        kpi(summary.csrf, 'בקשות זדוניות (CSRF)'), kpi(summary.denied, 'ניסיונות ללא הרשאה'), kpi(summary.uploadsRejected, 'קבצים שנחסמו')),
      summary.topIps.length ? h('p', { class: 'small' }, 'כתובות עם הכי הרבה אירועים חשודים: ', summary.topIps.map(x => `${x.ip} (${x.c})`).join(', ')) : null,
      f, tableOf([{ label: 'זמן', render: a => fmtDateTime(a.created_at) }, { label: 'חומרה', render: a => h('span', { class: 'sev-' + a.severity }, a.severity) },
        { label: 'פעולה', key: 'action' }, { label: 'משתמש', render: a => a.username || '—' }, { label: 'IP', render: a => h('span', { class: 'ltr' }, a.ip || '') },
        { label: 'פרטים', render: a => h('span', { class: 'small ltr', style: { 'word-break': 'break-all' } }, a.details || '') }], items, { caption: 'יומן פעילות' }));
  }
  function cloudPanel(c) {
    if (!c || !c.enabled) return h('div', { class: 'form-error', role: 'alert' }, 'השמירה בענן לא מוגדרת. בשרת שהדיסק שלו נמחק (כמו Render בחינם) כל הנתונים יימחקו בהפעלה הבאה. הגדירו SUPABASE_URL ו-SUPABASE_SERVICE_KEY.');
    const when = (x) => x ? new Date(x).toLocaleString('he-IL') : '—';
    if (c.blocked || (c.lastError && !c.lastSync)) return h('div', { class: 'form-error', role: 'alert' }, `השמירה בענן לא פועלת: ${(c.lastError || {}).message || 'שגיאה'}. אחרי התיקון בהגדרות השרת – הפעילו אותו מחדש.`);
    const rest = { restored: 'שוחזר מהענן בהפעלה', empty: 'הפעלה ראשונה – עדיין לא היה עותק בענן' }[c.restore && c.restore.status] || '';
    return h('div', { class: 'form-ok', role: 'status' }, `השמירה בענן פעילה (דלי ${c.bucket}). ${rest}. שמירה אחרונה: ${when(c.lastSync && c.lastSync.at)}${c.pending ? ' · יש שינויים שממתינים לשמירה' : ''}${c.lastError ? ` · שגיאה אחרונה: ${c.lastError.message}` : ''}`);
  }
  async function viewAdminBackups(main) {
    const { status, items, cloud } = await api('GET', '/api/admin/backups');
    main.replaceChildren(pageHead('גיבויים', `גיבוי אוטומטי כל ${status.intervalMinutes} דקות, 24 שעות ביממה. גיבויים נשמרים ${status.retentionDays} יום.`,
      h('button', { class: 'btn primary', type: 'button', onclick: async (e) => { try { await submitting(e.currentTarget, () => api('POST', '/api/admin/backups', {})); toast('הגיבוי הושלם'); viewAdminBackups(main); } catch (ex) { toast(ex.message, true); } } }, 'גיבוי עכשיו')),
      cloudPanel(cloud),
      status.lastError ? h('div', { class: 'form-error', role: 'alert' }, `הגיבוי האחרון נכשל (${fmtDateTime(status.lastError.at.replace('T', ' ').slice(0, 19))}): ${status.lastError.message}`) : null,
      h('section', { class: 'panel' }, h('p', null, status.lastBackup ? `גיבוי אחרון: ${new Date(status.lastBackup.at).toLocaleString('he-IL')} (${fmtSize(status.lastBackup.size)}).` : 'עדיין לא בוצע גיבוי מאז הפעלת השרת.'),
        h('p', { class: 'small muted' }, 'כל פעולה במערכת נשמרת מיד במסד הנתונים בשרת. לגיבוי מחוץ לשרת, הגדירו תיקיית גיבוי על דיסק ענן (BACKUP_DIR).')),
      tableOf([{ label: 'קובץ', render: b => h('span', { class: 'ltr small' }, b.file) }, { label: 'מועד', render: b => new Date(b.at).toLocaleString('he-IL') }, { label: 'גודל', render: b => h('span', { class: 'num' }, fmtSize(b.size)) }], items, { caption: 'גיבויים' }));
  }

  // ---------- אתחול ----------
  // ---------- כפתור נגישות צף (במסך הכניסה ובתוך המערכת) ----------
  // ההגדרות (אפשרויות, צבע, צורה, גודל, צד) מנוהלות בהגדרות וקבצים. הבחירות של כל משתמש נשמרות בדפדפן שלו.
  const a11yWidget = (() => {
    const FEATS = {
      font: { label: 'הגדלת טקסט', icon: 'M4 18L9 6l5 12M5.6 14h6.8M16 10h6M19 7v6' },
      contrast: { label: 'ניגודיות גבוהה', icon: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18' },
      dark: { label: 'ניגודיות הפוכה', icon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z' },
      gray: { label: 'גווני אפור', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M3 12h9' },
      links: { label: 'הדגשת קישורים', icon: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
      headings: { label: 'הדגשת כותרות', icon: 'M5 4v16M13 4v16M5 12h8M17 8l3-2v14' },
      readable: { label: 'גופן קריא', icon: 'M6 20h12M12 4v16M7 4h10' },
      spacing: { label: 'ריווח טקסט', icon: 'M4 6h16M4 12h16M4 18h16M2 3v18M22 3v18' },
      motion: { label: 'עצירת אנימציות', icon: 'M8 5h3v14H8zM13 5h3v14h-3z' },
      cursor: { label: 'סמן גדול', icon: 'M5 3l14 8-6 2-3 6z' },
      guide: { label: 'סרגל קריאה', icon: 'M3 10h18v4H3zM3 6h18M3 18h18' },
    };
    const KEY = 'a11y-prefs', POS = 'a11y-pos';
    let cfg = null, prefs = {}, btn = null, panel = null, guideEl = null;
    const load = () => { try { prefs = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { prefs = {}; } };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* */ } };
    const ic = (d) => { const s0 = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, svg('path', { d })); return s0; };
    function apply() {
      const el = document.documentElement; const on = (f) => !!(cfg && cfg.enabled && cfg.features.includes(f) && prefs[f]);
      const scale = on('font') ? Math.min(1.6, Math.max(1, Number(prefs.font) || 1)) : 1;
      if (scale > 1) { el.dataset.a11yFont = ''; el.style.setProperty('--a11y-scale', String(scale)); } else { delete el.dataset.a11yFont; el.style.removeProperty('--a11y-scale'); }
      for (const f of ['contrast', 'dark', 'gray', 'links', 'headings', 'readable', 'spacing', 'motion', 'cursor']) { const k = 'a11y' + f[0].toUpperCase() + f.slice(1); if (on(f)) el.dataset[k] = ''; else delete el.dataset[k]; }
      // סרגל קריאה: פס שעוקב אחרי העכבר
      if (on('guide') && !guideEl) { guideEl = h('div', { class: 'a11y-guide', 'aria-hidden': 'true' }); document.body.append(guideEl); document.addEventListener('pointermove', moveGuide); }
      if (!on('guide') && guideEl) { guideEl.remove(); guideEl = null; document.removeEventListener('pointermove', moveGuide); }
      if (panel) for (const b of panel.querySelectorAll('[data-f]')) { const f = b.dataset.f; b.setAttribute('aria-pressed', String(f === 'font' ? scale > 1 : on(f))); }
      if (panel) { const fl = panel.querySelector('.a11y-font-level'); if (fl) fl.textContent = Math.round(scale * 100) + '%'; }
    }
    const moveGuide = (e) => { if (guideEl) guideEl.style.setProperty('top', (e.clientY - 18) + 'px'); };
    // מיקום שנשמר (אחרי גרירה), אחרת לפי הצד שהוגדר
    function place() {
      if (!btn) return;
      let p = null; try { p = JSON.parse(localStorage.getItem(POS) || 'null'); } catch { /* */ }
      for (const k of ['left', 'right', 'top', 'bottom']) btn.style.removeProperty(k);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        const w = btn.offsetWidth || 56, hh = btn.offsetHeight || 56;
        btn.style.setProperty('left', Math.min(Math.max(4, p.x * window.innerWidth), window.innerWidth - w - 4) + 'px');
        btn.style.setProperty('top', Math.min(Math.max(4, p.y * window.innerHeight), window.innerHeight - hh - 4) + 'px');
      } else { btn.style.setProperty(cfg.side === 'right' ? 'right' : 'left', '16px'); btn.style.setProperty('bottom', '16px'); }
    }
    function openPanel() {
      if (panel) return closePanel();
      const feats = cfg.features.filter(f => FEATS[f]);
      const toggle = (f) => h('button', { type: 'button', class: 'a11y-opt', 'data-f': f, 'aria-pressed': 'false', onclick: () => { prefs[f] = !prefs[f]; if (f === 'contrast' && prefs[f]) prefs.dark = false; if (f === 'dark' && prefs[f]) prefs.contrast = false; save(); apply(); } }, ic(FEATS[f].icon), h('span', null, FEATS[f].label));
      const fontRow = feats.includes('font') ? h('div', { class: 'a11y-font', role: 'group', 'aria-label': 'גודל טקסט' },
        h('button', { type: 'button', class: 'a11y-step', 'aria-label': 'הקטנת טקסט', onclick: () => { prefs.font = Math.max(1, Math.round(((Number(prefs.font) || 1) - 0.1) * 10) / 10); save(); apply(); } }, 'א-'),
        h('span', { class: 'a11y-font-level', 'aria-live': 'polite' }, '100%'),
        h('button', { type: 'button', class: 'a11y-step', 'aria-label': 'הגדלת טקסט', onclick: () => { prefs.font = Math.min(1.6, Math.round(((Number(prefs.font) || 1) + 0.1) * 10) / 10); save(); apply(); } }, 'א+'),
        h('span', { class: 'a11y-font-lbl' }, 'גודל טקסט')) : null;
      panel = h('div', { class: 'a11y-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'a11y-title', tabindex: '-1' },
        h('div', { class: 'a11y-head' }, h('h2', { id: 'a11y-title' }, 'אפשרויות נגישות'), h('button', { type: 'button', class: 'a11y-x', 'aria-label': 'סגירת תפריט הנגישות', onclick: () => closePanel(true) }, icon('x'))),
        fontRow,
        h('div', { class: 'a11y-grid' }, feats.filter(f => f !== 'font').map(toggle)),
        h('div', { class: 'a11y-foot' },
          h('button', { type: 'button', class: 'a11y-reset', onclick: () => { prefs = {}; save(); apply(); } }, 'איפוס הגדרות'),
          h('button', { type: 'button', class: 'a11y-reset', onclick: () => { try { localStorage.removeItem(POS); } catch { /* */ } place(); } }, 'החזרת הכפתור למקום'),
          h('a', { href: '/accessibility.html', target: '_blank', rel: 'noopener' }, 'הצהרת נגישות')));
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closePanel(true); } });
      document.body.append(panel); positionPanel(); apply();
      btn.setAttribute('aria-expanded', 'true');
      (panel.querySelector('button') || panel).focus();
      setTimeout(() => document.addEventListener('pointerdown', outside, true));
    }
    const outside = (e) => { if (panel && !panel.contains(e.target) && !btn.contains(e.target)) closePanel(false); };
    function positionPanel() {
      if (!panel) return;
      const r = btn.getBoundingClientRect(); const pw = panel.offsetWidth, ph = panel.offsetHeight;
      let left = r.left + r.width / 2 > window.innerWidth / 2 ? r.right - pw : r.left;
      let top = r.top - ph - 10; if (top < 8) top = Math.min(r.bottom + 10, window.innerHeight - ph - 8);
      panel.style.setProperty('left', Math.min(Math.max(8, left), window.innerWidth - pw - 8) + 'px'); panel.style.setProperty('top', Math.max(8, top) + 'px');
    }
    function closePanel(focusBtn) {
      if (!panel) return; panel.remove(); panel = null; btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true); if (focusBtn) btn.focus();
    }
    // גרירה: מזיזים בלחיצה ארוכה/גרירה; לחיצה רגילה פותחת. מקלדת: Alt+חצים מזיזים
    function draggable() {
      let start = null, moved = false;
      btn.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; start = { x: e.clientX, y: e.clientY, r: btn.getBoundingClientRect() }; moved = false; btn.setPointerCapture(e.pointerId); });
      const moveTo = (e) => {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return; moved = true; btn.classList.add('dragging');
        const x = Math.min(Math.max(4, start.r.left + dx), window.innerWidth - start.r.width - 4), y = Math.min(Math.max(4, start.r.top + dy), window.innerHeight - start.r.height - 4);
        for (const k of ['right', 'bottom']) btn.style.removeProperty(k);
        btn.style.setProperty('left', x + 'px'); btn.style.setProperty('top', y + 'px'); positionPanel();
      };
      btn.addEventListener('pointermove', (e) => { if (start) moveTo(e); });
      const end = (e) => {
        if (!start) return; if (e && e.type === 'pointerup') moveTo(e); // המיקום הסופי, גם אם תנועה אחרונה אוחדה
        start = null; btn.classList.remove('dragging');
        if (moved) { const r = btn.getBoundingClientRect(); try { localStorage.setItem(POS, JSON.stringify({ x: r.left / window.innerWidth, y: r.top / window.innerHeight })); } catch { /* */ } }
      };
      btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end);
      btn.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; return; } openPanel(); });
      btn.addEventListener('keydown', (e) => {
        if (!e.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault(); const r = btn.getBoundingClientRect(); const d = 24;
        const x = r.left + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0), y = r.top + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
        try { localStorage.setItem(POS, JSON.stringify({ x: x / window.innerWidth, y: y / window.innerHeight })); } catch { /* */ } place(); positionPanel();
      });
    }
    function mount(c) {
      cfg = c || null; load();
      if (btn) { btn.remove(); btn = null; } closePanel(false);
      apply();
      if (!cfg || !cfg.enabled || !cfg.features.length) return;
      btn = h('button', { type: 'button', class: `a11y-fab shape-${cfg.shape} size-${cfg.size}`, 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
        'aria-label': `${cfg.label || 'נגישות'} – אפשרויות נגישות (אפשר לגרור, או Alt+חצים להזזה)`, title: cfg.label || 'נגישות' },
        ic('M12 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 8.5l8 1.5 8-1.5M12 10v5M12 15l-3.5 6.5M12 15l3.5 6.5'));
      btn.style.setProperty('--a11y-color', cfg.color || '#0B62B8');
      document.body.append(btn); place(); draggable();
      if (!a11yWidget.rz) { a11yWidget.rz = true; window.addEventListener('resize', () => { place(); positionPanel(); }); }
    }
    return { mount, apply };
  })();

  async function boot() {
    try {
      const me = await api('GET', '/api/auth/me');
      S.me = me.user; S.csrf = me.csrf; S.perms = new Set(me.perms); S.meta = me.meta; S.prefs = me.prefs || {}; S.title = me.title; S.org = me.org; S.unread = me.unread; S.logo = me.logo; S.login = me.login || S.login; S.a11y = me.a11y;
      applyPrefs(S.prefs);
    } catch (ex) {
      S.me = null;
      try { const r = await fetch('/api/auth/me', { headers: { 'X-Requested-With': 'fetch' } }); const j = await r.json(); if (j.title) { S.title = j.title; S.org = j.org; S.logo = j.logo; S.login = j.login || S.login; S.a11y = j.a11y; } } catch { /* */ }
    }
    shell = null;
    a11yWidget.mount(S.a11y);
    await route();
  }
  window.addEventListener('hashchange', route);
  applyPrefs({});
  boot();
})();
