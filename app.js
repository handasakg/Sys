'use strict';
/* מערכת תיאום הנדסי – צד לקוח.
   כלל אבטחה: כל טקסט שמגיע מהשרת נכנס ל-DOM רק דרך textContent (פונקציית h). אין innerHTML עם נתונים. */
(() => {
  const S = { me: null, csrf: null, perms: new Set(), meta: null, prefs: {}, title: 'מערכת תיאום הנדסי', org: 'מינהל הנדסה' };
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
    check: 'M4 12l5 5L20 6',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
    coins: 'M4 7c0-2 16-2 16 0s-16 2-16 0zM4 7v5c0 2 16 2 16 0V7M4 12v5c0 2 16 2 16 0v-5',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 20c0-3-2-5-4-5',
    key: 'M15 8a4 4 0 1 1-3.5 6L4 21H2v-3l7.5-7.5A4 4 0 0 1 15 8zM16 7h.01',
    sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
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
  const PREF_DEFAULTS = { theme: 'drafting', mode: 'auto', shape: 'soft', style: 'flat', density: 'regular', font: 'sans', fontSize: '16', accent: '', motion: 'full', sidebar: 'full', contrast: 'normal', bg: 'plain',
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
  function trackChip(r) {
    if (r.track === 'fast' && r.track_status === 'approved') return h('span', { class: 'chip fast' }, 'מזורז');
    if (r.track_status === 'pending') return h('span', { class: 'chip st-coordination' }, 'ממתין למסלול מזורז');
    return null;
  }
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

  // ---------- מסך כניסה ----------
  function authShell(formContent) {
    const art = h('section', { class: 'auth-art', 'aria-label': 'אודות המערכת' },
      h('div', null, h('img', { src: '/favicon.svg', alt: '', width: 44, height: 44 })),
      h('div', null,
        h('h1', null, S.title || 'מערכת תיאום הנדסי'),
        h('p', null, 'בקשות לתיאום תכנון, אישורי ביצוע וגמר עבודה – כל גורמי התשתית על אותו מסלול, וכל אחד רואה מה ממתין לו.'),
        h('div', { class: 'auth-lines', 'aria-hidden': 'true' },
          [['m-water', 'מים וביוב'], ['m-power', 'חשמל'], ['m-telecom', 'תקשורת'], ['m-gas', 'גז'], ['m-sewer', 'ניקוז ונוף']].map(([c, l]) => h('span', null, h('i', { class: 'mark ' + c }), l)))),
      h('div', { class: 'small' }, S.org || ''));
    root.replaceChildren(h('div', { class: 'auth' }, art, h('main', { class: 'auth-form', id: 'main' }, h('div', { class: 'box' }, formContent))));
  }
  function authLinks() {
    return h('div', { class: 'links' }, h('a', { href: '/accessibility.html' }, 'הצהרת נגישות'), h('a', { href: '/privacy.html' }, 'מדיניות פרטיות'));
  }
  function renderLogin(message) {
    document.title = 'כניסה – ' + (S.title || 'מערכת תיאום הנדסי');
    const err = errBox();
    const form = h('form', { novalidate: true },
      h('h2', null, 'כניסה למערכת'),
      message ? h('div', { class: 'form-ok', role: 'status' }, message) : null, err,
      field('שם משתמש', inp('username', { autocomplete: 'username', maxlength: 60, dir: 'ltr' }), { required: true }),
      field('סיסמה', inp('password', { type: 'password', autocomplete: 'current-password', maxlength: 256, dir: 'ltr' }), { required: true }),
      h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'כניסה'),
      h('p', { class: 'small', style: { 'margin-top': '14px' } }, h('a', { href: '#/forgot' }, 'שכחתי סיסמה')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const btn = form.querySelector('button[type=submit]');
      try {
        await submitting(btn, async () => {
          const r = await api('POST', '/api/auth/login', formData(form));
          S.csrf = r.csrf; await boot(); if (!location.hash || location.hash === '#/forgot') location.hash = '#/';
        });
      } catch (ex) { showErr(err, ex.message); form.password.value = ''; form.password.focus(); }
    });
    authShell([form, authLinks()]);
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
  const NAV = [
    { g: null, items: [['#/', 'לוח בקרה', 'home', null]] },
    { g: 'בקשות תיאום', items: [
      ['#/requests?scope=pending_me', 'ממתין לטיפולי', 'inbox', ['requests.view_own', 'requests.view_all', 'approvals.decide']],
      ['#/requests?scope=mine', 'הבקשות שלי', 'file', ['requests.create', 'requests.view_own']],
      ['#/requests?scope=all', 'כל הבקשות', 'layers', ['requests.view_all']],
      ['#/requests/new', 'בקשה חדשה', 'plus', ['requests.create']]] },
    { g: 'ניהול עבודה', items: [
      ['#/projects', 'פרויקטים', 'folder', ['projects.view']],
      ['#/tasks', 'משימות', 'task', ['tasks.view']],
      ['#/reports', 'דוחות וגרפים', 'chart', null],
      ['#/schedule', 'לוח זמנים', 'calendar', null],
      ['#/budget', 'תקציב', 'coins', ['budget.view']],
      ['#/documents', 'מסמכים', 'file', null]] },
    { g: 'ניהול מערכת', items: [
      ['#/admin/users', 'משתמשים', 'users', ['admin.users']],
      ['#/admin/roles', 'תפקידים והרשאות', 'key', ['admin.roles']],
      ['#/admin/settings', 'הגדרות וקבצים', 'sliders', ['admin.settings']],
      ['#/admin/audit', 'יומן אבטחה', 'shield', ['admin.audit']],
      ['#/admin/backups', 'גיבויים', 'db', ['admin.backup']]] },
    { g: 'אישי', items: [['#/appearance', 'עיצוב ותצוגה', 'palette', null], ['#/account', 'החשבון שלי', 'user', null]] },
  ];
  let shell = null;
  function renderShell() {
    const nav = h('nav', { class: 'nav', 'aria-label': 'ניווט ראשי' });
    for (const grp of NAV) {
      const items = grp.items.filter(([, , , perms]) => !perms || perms.some(can));
      if (!items.length) continue;
      if (grp.g) nav.append(h('div', { class: 'nav-group', role: 'presentation' }, grp.g));
      for (const [href, label, ic] of items) nav.append(h('a', { href, 'data-href': href, title: label }, icon(ic), h('span', { class: 'lbl' }, label)));
    }
    const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'תפריט' },
      h('div', { class: 'brand' }, h('img', { class: 'brand-mark', src: '/favicon.svg', alt: '' }),
        h('div', { class: 'brand-text' }, h('div', { class: 'brand-title' }, S.title), h('div', { class: 'brand-org' }, S.org))),
      nav, h('div', { class: 'side-foot' }, h('a', { href: '/accessibility.html' }, 'הצהרת נגישות'), h('a', { href: '/privacy.html' }, 'פרטיות')));
    const bellCount = h('span', { class: 'badge-dot', hidden: !S.unread }, String(S.unread || ''));
    const bell = h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'התראות', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => toggleNotifs(bell, bellCount) }, icon('bell'), bellCount);
    const menuBtn = h('button', { class: 'btn ghost icon-btn menu-btn', type: 'button', 'aria-label': 'פתיחת תפריט', 'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: () => toggleSidebar(true) }, icon('menu'));
    const top = h('header', { class: 'topbar' }, menuBtn,
      h('form', { role: 'search', class: 'grow', onsubmit: (e) => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = '#/requests?scope=' + (can('requests.view_all') ? 'all' : 'mine') + (q ? '&q=' + encodeURIComponent(q) : ''); } },
        h('label', { for: 'gsearch', class: 'sr-only' }, 'חיפוש בקשה'),
        h('input', { id: 'gsearch', name: 'q', type: 'search', placeholder: 'חיפוש לפי מספר, נושא או כתובת', maxlength: 100, style: { 'max-width': '420px' } })),
      h('div', { class: 'spacer' }), bell,
      h('span', { class: 'small muted', 'aria-label': 'משתמש מחובר' }, S.me.full_name),
      h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'יציאה מהמערכת', title: 'יציאה', onclick: logout }, icon('out')));
    const main = h('main', { class: 'content', id: 'main', tabindex: '-1' });
    const footer = h('footer', { class: 'footer' }, h('span', null, `© ${new Date().getFullYear()} ${S.org}`),
      h('a', { href: '/accessibility.html' }, 'הצהרת נגישות'), h('a', { href: '/privacy.html' }, 'מדיניות פרטיות'));
    root.replaceChildren(h('div', { class: 'app' }, sidebar, h('div', { class: 'main' }, top, main, footer)));
    shell = { main, nav, sidebar, menuBtn };
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
    [/^\/$/, viewDashboard], [/^\/requests$/, viewRequests], [/^\/requests\/new$/, viewRequestForm], [/^\/requests\/(\d+)$/, viewRequest],
    [/^\/requests\/(\d+)\/edit$/, viewRequestForm], [/^\/projects$/, viewProjects], [/^\/projects\/(\d+)$/, viewProject], [/^\/tasks$/, viewTasks],
    [/^\/schedule$/, viewSchedule], [/^\/reports$/, viewReports], [/^\/budget$/, viewBudget], [/^\/documents$/, viewDocuments], [/^\/appearance$/, viewAppearance],
    [/^\/account$/, viewAccount], [/^\/admin\/users$/, viewAdminUsers], [/^\/admin\/roles$/, viewAdminRoles], [/^\/admin\/settings$/, viewAdminSettings],
    [/^\/admin\/audit$/, viewAdminAudit], [/^\/admin\/backups$/, viewAdminBackups],
  ];
  async function route() {
    const { path, q } = parseHash();
    if (path === '/reset') return renderReset(q.token || '');
    if (!S.me) return path === '/forgot' ? renderForgot() : renderLogin();
    if (S.me.must_change_pw) return renderMustChange();
    if (!shell || !document.body.contains(shell.main)) renderShell();
    toggleSidebar(false);
    const full = location.hash || '#/';
    for (const a of shell.nav.querySelectorAll('a')) {
      const href = a.dataset.href;
      const active = href === full || (href !== '#/' && full.startsWith(href) && !/^#\/requests\?/.test(href)) || (href === '#/' && full === '#/');
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    const main = shell.main;
    main.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'טוען…'));
    for (const [re, fn] of ROUTES) {
      const m = path.match(re);
      if (m) {
        try { await fn(main, q, m[1] ? Number(m[1]) : undefined, path); }
        catch (ex) { if (ex.message !== 'נדרשת התחברות') main.replaceChildren(pageHead('שגיאה'), h('div', { class: 'form-error', role: 'alert' }, ex.message), h('a', { class: 'btn', href: '#/' }, 'חזרה ללוח הבקרה')); }
        const h1 = main.querySelector('h1');
        document.title = (h1 ? h1.textContent + ' – ' : '') + S.title;
        main.focus({ preventScroll: true }); window.scrollTo(0, 0);
        return;
      }
    }
    main.replaceChildren(pageHead('העמוד לא נמצא', 'הכתובת אינה קיימת במערכת.'), h('a', { class: 'btn primary', href: '#/' }, 'חזרה ללוח הבקרה'));
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

  // ---- תקציב: מסגרת מול ביצוע (bullet) ----
  function budgetChart(opts, rows) {
    if (!rows || !rows.length) return emptyChart(opts, 'אין עדיין פרויקטים עם תקציב.');
    const max = Math.max(...rows.map(r => Math.max(r.budget, r.spent))) || 1;
    const draw = (W) => {
      const row = 50, lw = Math.min(170, W * 0.34), H = rows.length * row + 4;
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${opts.title}: ${rows.map(r => `${r.name} נוצל ${pct(r.spent, r.budget)}%`).join(', ')}` });
      const xr = W - lw - 8; const span = xr - 4;
      rows.forEach((r, i) => {
        const y = i * row + 4; const bw = r.budget / max * span; const sw = r.spent / max * span; const over = r.spent > r.budget;
        root.append(txt(W - 2, y + 15, 'right', clip(r.name, Math.floor(lw / 7.5))));
        root.append(svg('rect', { x: xr - bw, y: y + 4, width: bw, height: 16, rx: 4, fill: 'var(--surface-2)', stroke: 'var(--rule)' }));
        root.append(svg('path', { class: 'mark grow h', d: hbarPath(xr, Math.max(sw, r.spent ? 3 : 0), y + 8, 8, 4), fill: over ? 'var(--st-crit)' : 'var(--s1)' }));
        if (r.planned) { const px = xr - r.planned / max * span; root.append(svg('line', { x1: px, x2: px, y1: y + 1, y2: y + 23, stroke: 'var(--ink)', 'stroke-width': 2 })); }
        root.append(txt(xr, y + 38, 'right', `נוצלו ${pct(r.spent, r.budget)}% · ${compactMoney(r.spent)} מתוך ${compactMoney(r.budget)}${over ? ' · חריגה' : ''}`, over ? 'v' : null));
        root.append(svg('rect', { class: 'hit', x: 0, y, width: W, height: row - 4, tabindex: 0,
          'data-tip': `${r.name}\nמסגרת: ${fmtMoney(r.budget)}\nבוצע: ${fmtMoney(r.spent)} (${pct(r.spent, r.budget)}%)\nמתוכנן: ${fmtMoney(r.planned)}`, 'aria-label': `${r.name}: נוצלו ${pct(r.spent, r.budget)}%` }));
      });
      return root;
    };
    const legend = legendList([{ label: 'בוצע בפועל', color: 'var(--s1)' }, { label: 'חריגה ממסגרת', color: 'var(--st-crit)' }, { label: 'מסגרת', color: 'var(--rule-strong)' }, { label: 'קו = מתוכנן', color: 'var(--ink)' }]);
    return chartFrame({ ...opts, table: { head: ['פרויקט', 'מסגרת', 'בוצע', 'מתוכנן', 'ניצול'], rows: rows.map(r => [r.name, fmtMoney(r.budget), fmtMoney(r.spent), fmtMoney(r.planned), pct(r.spent, r.budget) + '%']) } }, responsive(draw), legend);
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
    if (d.budget) out.push(budgetChart({ title: 'ניצול תקציב לפי פרויקט', sub: 'בוצע בפועל מתוך המסגרת', wide: true, csv: { name: 'budget' } }, d.budget));
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

  // ---------- לוח בקרה ----------
  async function viewDashboard(main) {
    const [d, rep6] = await Promise.all([api('GET', '/api/dashboard'), api('GET', '/api/reports?months=6')]);
    const k = d.kpi;
    const kpi = (v, l, href, alert) => h(href ? 'a' : 'div', { class: 'kpi' + (alert && v ? ' alert' : ''), href }, h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l));
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : 'ערב טוב';
    main.replaceChildren(
      pageHead(`${greet}, ${S.me.full_name.split(' ')[0]}`, 'מה ממתין לך היום, ומה מתעכב.', can('requests.create') ? h('a', { class: 'btn primary', href: '#/requests/new' }, icon('plus'), 'בקשה חדשה') : null),
      h('div', { class: 'kpis' },
        kpi(k.assignedToMe + d.pendingApprovals.length, 'ממתינות לטיפולי', '#/requests?scope=pending_me'),
        kpi(k.open, 'בקשות פתוחות', can('requests.view_all') ? '#/requests?scope=all' : '#/requests?scope=mine'),
        kpi(k.overdue, 'חרגו מזמן הטיפול', null, true),
        kpi(k.fast, 'במסלול מזורז'),
        kpi(k.trackPending, 'ממתינות לאישור מסלול'),
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
            empty: h('div', { class: 'empty' }, h('p', null, 'עדיין אין בקשות.'), can('requests.create') ? h('a', { class: 'btn primary', href: '#/requests/new' }, 'הגשת בקשה ראשונה') : null) })),
        h('div', null,
          d.pendingApprovals.length ? h('section', { class: 'panel' }, h('h2', null, 'ממתינות לחוות דעתך'),
            h('ul', { class: 'files' }, d.pendingApprovals.map(a => h('li', null, h('a', { class: 'fname', href: `#/requests/${a.request_id}` }, h('span', { class: 'ltr' }, a.number), ' – ', a.title))))) : null,
          d.myTasks.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'המשימות שלי'), h('div', { class: 'actions' }, h('a', { href: '#/tasks', class: 'small' }, 'לכל המשימות'))),
            h('ul', { class: 'files' }, d.myTasks.map(t => h('li', null, h('span', { class: 'fname' }, t.title), h('span', { class: 'small muted' }, t.due_date ? 'עד ' + fmtDate(t.due_date) : ''), t.priority === 'דחופה' ? h('span', { class: 'chip late' }, 'דחופה') : null)))) : null,
          d.projects.length ? h('section', { class: 'panel' }, h('h2', null, 'פרויקטים פעילים'),
            h('ul', { class: 'files' }, d.projects.map(p => {
              const pct = p.tasks_total ? Math.round(p.tasks_done / p.tasks_total * 100) : 0;
              return h('li', null, h('a', { class: 'fname', href: `#/projects/${p.id}` }, p.name), h('div', { class: 'meter', style: { width: '120px' }, role: 'img', 'aria-label': `התקדמות ${pct}%` }, h('i', { style: { '--w': pct + '%' } })), h('span', { class: 'small num' }, pct + '%'));
            }))) : null)));
  }

  // ---------- רשימת בקשות ----------
  async function viewRequests(main, q) {
    const scope = q.scope || 'mine';
    const titles = { mine: 'הבקשות שלי', assigned: 'מוקצות אליי', all: 'כל הבקשות', pending_me: 'ממתין לטיפולי' };
    const params = new URLSearchParams({ scope });
    for (const k of ['status', 'type', 'track', 'q']) if (q[k]) params.set(k, q[k]);
    const { items } = await api('GET', '/api/requests?' + params);
    const filters = h('form', { class: 'toolbar', role: 'search', 'aria-label': 'סינון בקשות' },
      h('div', { class: 'field grow' }, h('label', { for: 'fq' }, 'חיפוש'), h('input', { id: 'fq', name: 'q', type: 'search', value: q.q || '', maxlength: 100, placeholder: 'מספר, נושא או כתובת' })),
      h('div', { class: 'field' }, h('label', { for: 'fs' }, 'סטטוס'), sel('status', [['', 'הכל'], ...Object.entries(S.meta.statuses)], q.status, { id: 'fs' })),
      h('div', { class: 'field' }, h('label', { for: 'ft' }, 'סוג'), sel('type', [['', 'הכל'], ...Object.entries(S.meta.types)], q.type, { id: 'ft' })),
      h('div', { class: 'field' }, h('label', { for: 'fk' }, 'מסלול'), sel('track', [['', 'הכל'], ...Object.entries(S.meta.tracks)], q.track, { id: 'fk' })),
      h('button', { class: 'btn', type: 'submit' }, 'סינון'));
    filters.addEventListener('submit', (e) => {
      e.preventDefault(); const f = formData(filters); const p = new URLSearchParams({ scope });
      for (const [k2, v2] of Object.entries(f)) if (v2) p.set(k2, v2);
      location.hash = '#/requests?' + p;
    });
    main.replaceChildren(
      pageHead(titles[scope] || 'בקשות', `${items.length} בקשות`, can('requests.create') ? h('a', { class: 'btn primary', href: '#/requests/new' }, icon('plus'), 'בקשה חדשה') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => exportCsv(items) }, icon('download'), 'ייצוא ל-Excel')),
      filters,
      tableOf([
        { label: 'מספר', cls: 'reqno', render: r => h('a', { class: 'rowlink ltr', href: `#/requests/${r.id}` }, r.number) },
        { label: 'נושא', render: r => h('span', null, r.title, r.address ? h('div', { class: 'small muted' }, r.address) : null) },
        { label: 'סוג', render: r => T(r.type) },
        { label: 'מגיש', key: 'applicant_name' }, { label: 'מטפל', render: r => r.assignee_name || '—' },
        { label: 'גורמים', render: r => r.approvals_total ? h('span', { class: 'num' }, `${r.approvals_done}/${r.approvals_total}`) : '—' },
        { label: 'יעד', render: r => r.due_at ? h('span', { class: r.overdue ? 'sev-critical' : '' }, fmtDate(r.due_at)) : '—' },
        { label: 'סטטוס', render: r => h('span', null, statusChip(r.status), ' ', trackChip(r), r.overdue ? h('span', { class: 'chip late' }, 'בחריגה') : null) },
      ], items, { onRow: r => { location.hash = `#/requests/${r.id}`; }, caption: titles[scope],
        empty: h('div', { class: 'empty' }, h('p', null, scope === 'pending_me' ? 'אין בקשות שממתינות לך. עבודה טובה.' : 'לא נמצאו בקשות.'), can('requests.create') && scope === 'mine' ? h('a', { class: 'btn primary', href: '#/requests/new' }, 'הגשת בקשה') : null) }));
  }
  function exportCsv(items) {
    const cols = [['number', 'מספר'], ['title', 'נושא'], ['type', 'סוג'], ['address', 'כתובת'], ['applicant_name', 'מגיש'], ['assignee_name', 'מטפל'], ['status', 'סטטוס'], ['track', 'מסלול'], ['submitted_at', 'הוגשה'], ['due_at', 'יעד']];
    const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }; // מניעת הזרקת נוסחאות
    const val = (r, k) => k === 'type' ? T(r[k]) : k === 'status' ? ST(r[k]) : k === 'track' ? S.meta.tracks[r[k]] : r[k];
    const csv = '﻿' + [cols.map(c => esc(c[1])).join(','), ...items.map(r => cols.map(c => esc(val(r, c[0]))).join(','))].join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `requests-${today()}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- טופס בקשה ----------
  async function viewRequestForm(main, q, id) {
    let r = {};
    if (id) r = (await api('GET', `/api/requests/${id}`)).request;
    const projects = (await api('GET', '/api/projects/options')).items;
    const err = errBox();
    const form = h('form', { class: 'panel', novalidate: true }, err,
      h('div', { class: 'row' },
        field('סוג הבקשה', sel('type', [['', 'בחרו סוג'], ...Object.entries(S.meta.types)], r.type), { required: true }),
        field('פרויקט', sel('project_id', [['', 'ללא פרויקט'], ...projects.map(p => [p.id, p.name])], r.project_id))),
      field('נושא הבקשה', inp('title', { value: r.title || '', maxlength: 200 }), { required: true }),
      field('תיאור העבודה', area('description', { value: r.description || '', maxlength: 5000 }), { hint: 'מה מתוכנן, היקף העבודה, תשתיות מושפעות.' }),
      h('div', { class: 'row' },
        field('כתובת / מיקום', inp('address', { value: r.address || '', maxlength: 300 })),
        field('גוש', inp('gush', { value: r.gush || '', maxlength: 20, inputmode: 'numeric', pattern: '[0-9\\s\\-]*' })),
        field('חלקה', inp('helka', { value: r.helka || '', maxlength: 20, inputmode: 'numeric', pattern: '[0-9\\s\\-]*' }))),
      h('div', { class: 'row' },
        field('תחילת עבודה מתוכננת', inp('planned_start', { type: 'date', value: r.planned_start || '' })),
        field('סיום עבודה מתוכנן', inp('planned_end', { type: 'date', value: r.planned_end || '' }))),
      id ? null : h('fieldset', null, h('legend', null, 'מסלול טיפול'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'track', value: 'regular', checked: true }), 'מסלול רגיל'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'track', value: 'fast' }), 'בקשה למסלול מזורז (טעון אישור)'),
        field('נימוק למסלול מזורז', area('fast_reason', { maxlength: 1000, rows: 3 }), { hint: 'חובה כשמבקשים מסלול מזורז.' })),
      h('div', { class: 'actions', style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
        id ? h('button', { class: 'btn primary', type: 'submit', value: 'save' }, 'שמירת שינויים') : [
          h('button', { class: 'btn primary', type: 'submit', value: 'submit' }, 'הגשת הבקשה'),
          h('button', { class: 'btn', type: 'submit', value: 'draft' }, 'שמירה כטיוטה')],
        h('a', { class: 'btn ghost', href: id ? `#/requests/${id}` : '#/requests?scope=mine' }, 'ביטול')));
    const fastReason = form.querySelector('[name=fast_reason]');
    form.addEventListener('change', () => { if (fastReason) fastReason.required = form.querySelector('[name=track]:checked')?.value === 'fast'; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const data = formData(form);
      data.track = form.querySelector('[name=track]:checked')?.value || 'regular';
      if (data.planned_start && data.planned_end && data.planned_end < data.planned_start) return showErr(err, 'תאריך הסיום מוקדם מתאריך ההתחלה.');
      try {
        if (id) { await submitting(e.submitter, () => api('PUT', `/api/requests/${id}`, data)); toast('הבקשה עודכנה'); location.hash = `#/requests/${id}`; }
        else {
          data.submit = e.submitter && e.submitter.value === 'submit';
          const res = await submitting(e.submitter, () => api('POST', '/api/requests', data));
          toast(data.submit ? `הבקשה ${res.number} הוגשה` : `הטיוטה ${res.number} נשמרה`);
          location.hash = `#/requests/${res.id}`;
        }
      } catch (ex) { showErr(err, ex.message); }
    });
    main.replaceChildren(pageHead(id ? `עריכת בקשה ${r.number}` : 'בקשה חדשה לתיאום הנדסי', id ? null : 'אחרי ההגשה הבקשה תוקצה לגורם מטפל ותועבר לגורמי התשתית הרלוונטיים.'), form);
  }

  // ---------- תצוגת בקשה ----------
  const ROUTE_STEPS = ['draft', 'submitted', 'review', 'coordination', 'approved', 'closed'];
  function routeLine(r) {
    let idx = ROUTE_STEPS.indexOf(r.status);
    const off = ['returned', 'rejected'].includes(r.status);
    if (r.status === 'returned') idx = 2; if (r.status === 'rejected') idx = 3;
    const n = ROUTE_STEPS.length;
    const wrap = h('ol', { class: 'route', 'aria-label': 'מסלול הבקשה', style: { '--n': n, '--p': Math.round(idx / (n - 1) * 88) + '%' } }, h('span', { class: 'bar', 'aria-hidden': 'true' }));
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
    const TR_LABEL = { submitted: 'הגשה', review: 'העברה לבדיקה', coordination: 'העברה לתיאום גורמים', returned: 'החזרה לתיקון', approved: 'מתן אישור', rejected: 'דחייה', closed: 'סגירה' };
    for (const to of d.transitions) {
      actions.push(h('button', { class: 'btn ' + (to === 'approved' ? 'primary' : to === 'rejected' || to === 'returned' ? 'danger' : ''), type: 'button',
        onclick: () => statusDialog(r, to, TR_LABEL[to] || ST(to), reload) }, TR_LABEL[to] || ST(to)));
    }
    if (d.can.edit) actions.push(h('a', { class: 'btn', href: `#/requests/${id}/edit` }, icon('edit'), 'עריכה'));
    if (d.can.delete) actions.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (await confirmDlg('מחיקת בקשה', `למחוק את בקשה ${r.number} עם כל המסמכים שלה? הפעולה אינה הפיכה.`, 'מחיקה', true)) {
        try { await api('DELETE', `/api/requests/${id}`); toast('הבקשה נמחקה'); location.hash = '#/requests?scope=all'; } catch (ex) { toast(ex.message, true); }
      } } }, icon('trash'), 'מחיקה'));

    const info = h('dl', { class: 'dl' },
      h('dt', null, 'סוג'), h('dd', null, T(r.type)),
      h('dt', null, 'מגיש'), h('dd', null, r.applicant_name),
      h('dt', null, 'גורם מטפל'), h('dd', null, r.assignee_name || 'טרם הוקצה', d.can.assign ? [' ', h('button', { class: 'btn sm', type: 'button', onclick: () => assignDialog(r, reload) }, r.assignee_name ? 'שינוי' : 'הקצאה')] : null),
      h('dt', null, 'פרויקט'), h('dd', null, r.project_id ? h('a', { href: `#/projects/${r.project_id}` }, r.project_name) : '—'),
      h('dt', null, 'כתובת'), h('dd', null, r.address || '—'),
      h('dt', null, 'גוש / חלקה'), h('dd', null, h('span', { class: 'num' }, [r.gush, r.helka].filter(Boolean).join(' / ') || '—')),
      h('dt', null, 'מועדי עבודה'), h('dd', null, r.planned_start ? `${fmtDate(r.planned_start)} – ${fmtDate(r.planned_end)}` : '—'),
      h('dt', null, 'הוגשה'), h('dd', null, fmtDateTime(r.submitted_at)),
      h('dt', null, 'יעד לטיפול'), h('dd', null, r.due_at ? h('span', { class: r.overdue ? 'sev-critical' : '' }, fmtDate(r.due_at), r.overdue ? ' (בחריגה)' : '') : '—'),
      h('dt', null, 'מסלול'), h('dd', null, S.meta.tracks[r.track], ' · ', S.meta.trackStatus[r.track_status],
        d.can.approveTrack && r.track_status === 'pending' ? [' ', h('button', { class: 'btn sm primary', type: 'button', onclick: () => trackDialog(r, reload) }, 'החלטה על מסלול')] : null));

    // גורמי תשתית
    const appr = h('section', { class: 'panel', 'aria-labelledby': 'ap-h' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'ap-h' }, 'גורמי תשתית'), d.can.assign ? h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => infraDialog(r, d.approvals, reload) }, 'בחירת גורמים')) : null),
      d.approvals.length ? h('div', { class: 'approvals' }, d.approvals.map(a => {
        const canDecide = d.can.decide && (S.me.infra_body_id === a.infra_body_id || can('requests.final_approve')) && ['review', 'coordination'].includes(r.status);
        const lbl = { pending: 'ממתין', approved: 'אישר', rejected: 'דחה', conditions: 'אישר בתנאים' }[a.decision];
        return h('div', { class: 'approval' }, h('span', { class: 'mark ' + markClass(a.body_name), 'aria-hidden': 'true' }),
          h('div', null, h('div', { class: 'who' }, a.body_name), h('div', { class: 'note' }, h('span', { class: 'dec-' + a.decision }, lbl),
            a.decided_by_name ? ` · ${a.decided_by_name}, ${fmtDateTime(a.decided_at)}` : ''), a.comment ? h('div', { class: 'note' }, a.comment) : null),
          canDecide ? h('button', { class: 'btn sm', type: 'button', onclick: () => decideDialog(a, reload) }, a.decision === 'pending' ? 'מתן חוות דעת' : 'עדכון') : h('span'));
      })) : h('p', { class: 'muted' }, d.can.assign ? 'עדיין לא נבחרו גורמי תשתית לבקשה.' : 'גורמי התשתית ייקבעו על ידי הגורם המטפל.'));

    // מסמכים
    const docs = docsPanel(d.documents, { request_id: id }, d.can.upload, reload);

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
        h('div', null, h('h1', { class: 'req-title' }, r.title), h('div', null, statusChip(r.status), ' ', trackChip(r), r.overdue ? h('span', { class: 'chip late' }, 'חרגה מזמן הטיפול') : null)),
        h('div', { class: 'actions', style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } }, actions)),
      h('section', { class: 'panel', 'aria-label': 'מסלול הבקשה' }, routeLine(r)),
      h('div', { class: 'grid side' },
        h('div', null, h('section', { class: 'panel' }, h('h2', null, 'פרטי הבקשה'), info, r.description ? [h('h3', { style: { 'margin-top': '16px' } }, 'תיאור'), h('p', { style: { 'white-space': 'pre-wrap' } }, r.description)] : null), appr, hist),
        h('div', null, docs, d.tasks.length ? h('section', { class: 'panel' }, h('h2', null, 'משימות קשורות'), h('ul', { class: 'files' }, d.tasks.map(t => h('li', null, h('span', { class: 'fname' }, t.title), h('span', { class: 'small muted' }, t.assignee_name || ''), h('span', { class: 'chip plain st-draft' }, t.status))))) : null)));
  }
  function statusDialog(r, to, label, reload) {
    const err = errBox();
    const needComment = ['returned', 'rejected'].includes(to);
    const form = h('form', { novalidate: true }, err, h('p', null, `בקשה ${r.number}: ${label}.`), field(needComment ? 'נימוק (יוצג למגיש)' : 'הערה (לא חובה)', area('comment', { rows: 3, maxlength: 2000 }), { required: needComment }));
    const m = modal(label, form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, label), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { await api('POST', `/api/requests/${r.id}/status`, { status: to, comment: formData(form).comment }); m.close(); toast(`הבקשה עודכנה: ${ST(to)}`); reload(); } catch (ex) { showErr(err, ex.message); }
    });
  }
  async function assignDialog(r, reload) {
    const { items } = await api('GET', '/api/users/lookup');
    const err = errBox();
    const form = h('form', { novalidate: true }, err, field('גורם מטפל', sel('assignee_id', [['', 'בחרו משתמש'], ...items.map(u => [u.id, `${u.full_name} (${u.role_name})`])], r.assignee_id), { required: true }));
    const m = modal('הקצאת גורם מטפל', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'הקצאה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { await api('POST', `/api/requests/${r.id}/assign`, formData(form)); m.close(); toast('הבקשה הוקצתה'); reload(); } catch (ex) { showErr(err, ex.message); }
    });
  }
  function trackDialog(r, reload) {
    const err = errBox();
    const form = h('form', { novalidate: true }, err, h('p', null, 'המגיש ביקש מסלול מזורז. הנימוק מופיע בהיסטוריה של הבקשה.'),
      h('fieldset', null, h('legend', null, 'החלטה'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'decision', value: 'approved', required: true }), 'אישור מסלול מזורז'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'decision', value: 'rejected' }), 'דחייה – המשך במסלול רגיל')),
      field('הערה', area('comment', { rows: 2, maxlength: 1000 })));
    const m = modal('אישור מסלול', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירת החלטה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dec = form.querySelector('[name=decision]:checked'); if (!dec) return showErr(err, 'יש לבחור החלטה.');
      try { await api('POST', `/api/requests/${r.id}/track`, { decision: dec.value, comment: form.comment.value }); m.close(); toast('החלטת המסלול נשמרה'); reload(); } catch (ex) { showErr(err, ex.message); }
    });
  }
  async function infraDialog(r, current, reload) {
    const { items } = await api('GET', '/api/infra');
    const have = new Set(current.map(a => a.infra_body_id));
    const form = h('form', null, h('fieldset', null, h('legend', null, 'גורמים שנדרשת חוות דעתם'),
      items.filter(b => b.active || have.has(b.id)).map(b => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'b' + b.id, value: b.id, checked: have.has(b.id) }), h('span', { class: 'mark ' + markClass(b.name), style: { width: '8px', height: '22px', display: 'inline-block', 'border-radius': '3px' }, 'aria-hidden': 'true' }), b.name))));
    const m = modal('גורמי תשתית לבקשה', form, [h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const ids = [...form.querySelectorAll('input:checked')].map(i => Number(i.value));
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
      try { await api('POST', `/api/approvals/${a.id}/decide`, { decision: dec.value, comment: form.comment.value }); m.close(); toast('חוות הדעת נשמרה'); reload(); } catch (ex) { showErr(err, ex.message); }
    });
  }

  // ---------- מסמכים ----------
  function docsPanel(docs, target, canUpload, reload) {
    const list = h('ul', { class: 'files' }, docs.map(f => h('li', null,
      h('span', { class: 'fname' }, f.original_name), h('span', { class: 'small muted' }, `${fmtSize(f.size)} · ${f.uploaded_by_name} · ${fmtDate(f.created_at)}`),
      can('files.download') ? h('a', { class: 'btn sm', href: `/api/documents/${f.id}/download`, 'aria-label': `הורדת ${f.original_name}` }, icon('download'), 'הורדה') : null,
      (can('files.delete_all') || (can('files.delete_own') && f.uploaded_by === S.me.id)) ? h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `מחיקת ${f.original_name}`, onclick: async () => {
        if (!(await confirmDlg('מחיקת קובץ', `למחוק את "${f.original_name}"?`, 'מחיקה', true))) return;
        try { await api('DELETE', `/api/documents/${f.id}`); toast('הקובץ נמחק'); reload(); } catch (ex) { toast(ex.message, true); }
      } }, icon('trash')) : null)));
    const panel = h('section', { class: 'panel', 'aria-labelledby': 'docs-h' }, h('h2', { id: 'docs-h' }, 'מסמכים'), docs.length ? list : h('p', { class: 'muted' }, 'לא צורפו מסמכים.'));
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
  async function viewDocuments(main) {
    const { items } = await api('GET', '/api/documents');
    let filter = '';
    const box = h('div');
    const draw = () => {
      const rows = items.filter(d => !filter || d.original_name.toLowerCase().includes(filter) || (d.request_number || '').toLowerCase().includes(filter) || (d.project_name || '').toLowerCase().includes(filter));
      box.replaceChildren(tableOf([
        { label: 'קובץ', render: d => h('span', { class: 'fname' }, d.original_name) },
        { label: 'שיוך', render: d => d.request_id ? h('a', { href: `#/requests/${d.request_id}`, class: 'ltr' }, d.request_number) : d.project_id ? h('a', { href: `#/projects/${d.project_id}` }, d.project_name) : '—' },
        { label: 'גודל', render: d => h('span', { class: 'num' }, fmtSize(d.size)) }, { label: 'הועלה ע"י', key: 'uploaded_by_name' },
        { label: 'תאריך', render: d => fmtDate(d.created_at) },
        { label: 'פעולות', render: d => can('files.download') ? h('a', { class: 'btn sm', href: `/api/documents/${d.id}/download`, 'aria-label': `הורדת ${d.original_name}` }, icon('download'), 'הורדה') : '—' },
      ], rows, { caption: 'מסמכים', empty: h('p', { class: 'empty' }, 'אין מסמכים להצגה. מסמכים מצורפים מתוך בקשה או פרויקט.') }));
    };
    const search = h('input', { type: 'search', id: 'dsearch', placeholder: 'שם קובץ, מספר בקשה או פרויקט', maxlength: 100 });
    search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); draw(); });
    draw();
    main.replaceChildren(pageHead('מסמכים', 'כל הקבצים שיש לך הרשאה לראות. הקבצים נשמרים בשרת ומגובים אוטומטית.'), h('div', { class: 'toolbar' }, h('div', { class: 'field grow' }, h('label', { for: 'dsearch' }, 'חיפוש'), search)), box);
  }

  // ---------- פרויקטים ----------
  async function viewProjects(main) {
    const { items } = await api('GET', '/api/projects');
    main.replaceChildren(pageHead('פרויקטים', 'פרויקטים, התקדמות ביצוע וניצול תקציב.', can('projects.manage') ? h('button', { class: 'btn primary', type: 'button', onclick: () => projectDialog(null, () => viewProjects(main)) }, icon('plus'), 'פרויקט חדש') : null),
      tableOf([
        { label: 'פרויקט', render: p => h('a', { class: 'rowlink', href: `#/projects/${p.id}` }, p.name, p.code ? h('span', { class: 'small muted ltr' }, ' ' + p.code) : null) },
        { label: 'סטטוס', render: p => h('span', { class: 'chip plain st-' + (p.status === 'הושלם' ? 'approved' : p.status === 'פעיל' ? 'review' : 'draft') }, p.status) },
        { label: 'מנהל', render: p => p.manager_name || '—' },
        { label: 'לו"ז', render: p => p.start_date ? `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` : '—' },
        { label: 'משימות', render: p => h('span', { class: 'num' }, `${p.tasks_done}/${p.tasks_total}`) },
        { label: 'תקציב', render: p => budgetMeter(p.spent, p.budget) },
      ], items, { onRow: p => { location.hash = `#/projects/${p.id}`; }, caption: 'פרויקטים', empty: h('p', { class: 'empty' }, 'אין פרויקטים עדיין.') }));
  }
  function budgetMeter(spent, budget) {
    const pct = budget ? Math.round(spent / budget * 100) : 0;
    return h('div', { style: { 'min-width': '150px' } }, h('div', { class: 'small num' }, `${fmtMoney(spent)} / ${fmtMoney(budget)}`),
      h('div', { class: 'meter' + (pct > 100 ? ' over' : ''), role: 'img', 'aria-label': `ניצול תקציב ${pct}%` }, h('i', { style: { '--w': Math.min(pct, 100) + '%' } })));
  }
  async function projectDialog(p, done) {
    const users = can('admin.users') || can('projects.manage') ? (await api('GET', '/api/users/lookup')).items : [];
    p = p || {};
    const err = errBox();
    const form = h('form', { novalidate: true }, err,
      field('שם הפרויקט', inp('name', { value: p.name || '', maxlength: 200 }), { required: true }),
      h('div', { class: 'row' }, field('קוד', inp('code', { value: p.code || '', maxlength: 40, dir: 'ltr' })),
        field('סטטוס', sel('status', ['תכנון', 'פעיל', 'מושהה', 'הושלם', 'בוטל'].map(s => [s, s]), p.status || 'פעיל'))),
      field('מנהל פרויקט', sel('manager_id', [['', 'ללא'], ...users.map(u => [u.id, u.full_name])], p.manager_id)),
      h('div', { class: 'row' }, field('התחלה', inp('start_date', { type: 'date', value: p.start_date || '' })), field('סיום', inp('end_date', { type: 'date', value: p.end_date || '' }))),
      field('מסגרת תקציב (₪)', inp('budget', { type: 'number', min: 0, step: '0.01', value: p.budget ?? '', inputmode: 'decimal', disabled: !can('budget.manage') }), { hint: can('budget.manage') ? null : 'רק בעלי הרשאת תקציב יכולים לשנות.' }),
      field('תיאור', area('description', { value: p.description || '', maxlength: 5000 })));
    const m = modal(p.id ? 'עריכת פרויקט' : 'פרויקט חדש', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { await api(p.id ? 'PUT' : 'POST', p.id ? `/api/projects/${p.id}` : '/api/projects', formData(form)); m.close(); toast('הפרויקט נשמר'); done(); } catch (ex) { showErr(err, ex.message); }
    });
  }
  async function viewProject(main, q, id) {
    const d = await api('GET', `/api/projects/${id}`);
    const p = d.project; const reload = () => viewProject(main, q, id);
    const tabsDef = [['ov', 'סקירה'], ['tasks', `משימות (${d.tasks.length})`], ['req', `בקשות (${d.requests.length})`], ['docs', `מסמכים (${d.documents.length})`]];
    if (d.budget) tabsDef.splice(2, 0, ['budget', 'תקציב']);
    const panelBox = h('div', { role: 'tabpanel', tabindex: '0' });
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'חלקי הפרויקט' });
    const show = (key) => {
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.k === key)), b.tabIndex = b.dataset.k === key ? 0 : -1;
      panelBox.setAttribute('aria-labelledby', 'tab-' + key);
      if (key === 'ov') panelBox.replaceChildren(h('div', { class: 'grid two' },
        h('section', { class: 'panel' }, h('dl', { class: 'dl' }, h('dt', null, 'סטטוס'), h('dd', null, p.status), h('dt', null, 'מנהל'), h('dd', null, p.manager_name || '—'),
          h('dt', null, 'לוח זמנים'), h('dd', null, p.start_date ? `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` : '—'), h('dt', null, 'קוד'), h('dd', { class: 'ltr' }, p.code || '—')),
          p.description ? h('p', { style: { 'margin-top': '12px', 'white-space': 'pre-wrap' } }, p.description) : null),
        h('section', { class: 'panel' }, h('h2', null, 'מדדים'), h('p', null, 'ביצוע משימות'), h('div', { class: 'meter', role: 'img', 'aria-label': `${p.tasks_done} מתוך ${p.tasks_total} משימות` }, h('i', { style: { '--w': (p.tasks_total ? Math.round(p.tasks_done / p.tasks_total * 100) : 0) + '%' } })),
          h('p', { class: 'small muted' }, `${p.tasks_done} מתוך ${p.tasks_total} משימות הושלמו`), d.budget ? [h('p', null, 'ניצול תקציב'), budgetMeter(p.spent, p.budget)] : null)));
      if (key === 'tasks') panelBox.replaceChildren(tasksTable(d.tasks, reload, { project_id: id }));
      if (key === 'budget') panelBox.replaceChildren(budgetPanel(p, d.budget, reload));
      if (key === 'req') panelBox.replaceChildren(tableOf([{ label: 'מספר', cls: 'reqno', render: r => h('a', { class: 'rowlink ltr', href: `#/requests/${r.id}` }, r.number) }, { label: 'נושא', key: 'title' }, { label: 'סוג', render: r => T(r.type) }, { label: 'סטטוס', render: r => statusChip(r.status) }], d.requests, { caption: 'בקשות בפרויקט', empty: h('p', { class: 'empty' }, 'אין בקשות משויכות לפרויקט.') }));
      if (key === 'docs') panelBox.replaceChildren(docsPanel(d.documents, { project_id: id }, can('files.upload'), reload));
    };
    for (const [k, l] of tabsDef) tabs.append(h('button', { type: 'button', role: 'tab', id: 'tab-' + k, 'data-k': k, onclick: () => show(k) }, l));
    tabs.addEventListener('keydown', (e) => {
      const btns = [...tabs.children]; const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const n = btns[(i + (e.key === 'ArrowLeft' ? 1 : -1) + btns.length) % btns.length]; n.focus(); show(n.dataset.k); }
    });
    main.replaceChildren(pageHead(p.name, null,
      can('projects.manage') ? h('button', { class: 'btn', type: 'button', onclick: () => projectDialog(p, reload) }, icon('edit'), 'עריכה') : null,
      can('projects.manage') ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (await confirmDlg('מחיקת פרויקט', `למחוק את "${p.name}" עם המשימות, התקציב והמסמכים שלו?`, 'מחיקה', true)) { try { await api('DELETE', `/api/projects/${id}`); toast('הפרויקט נמחק'); location.hash = '#/projects'; } catch (ex) { toast(ex.message, true); } }
      } }, icon('trash'), 'מחיקה') : null), tabs, panelBox);
    show('ov');
  }
  function budgetPanel(p, entries, reload) {
    const planned = entries.filter(e => e.kind === 'planned').reduce((a, e) => a + e.amount, 0);
    const actual = entries.filter(e => e.kind === 'actual').reduce((a, e) => a + e.amount, 0);
    const wrap = h('div', null, h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v num' }, fmtMoney(p.budget)), h('div', { class: 'l' }, 'מסגרת')),
      h('div', { class: 'kpi' }, h('div', { class: 'v num' }, fmtMoney(planned)), h('div', { class: 'l' }, 'מתוכנן')),
      h('div', { class: 'kpi' + (actual > p.budget ? ' alert' : '') }, h('div', { class: 'v num' }, fmtMoney(actual)), h('div', { class: 'l' }, 'בוצע בפועל')),
      h('div', { class: 'kpi' + (p.budget - actual < 0 ? ' alert' : '') }, h('div', { class: 'v num' }, fmtMoney(p.budget - actual)), h('div', { class: 'l' }, 'יתרה'))));
    if (can('budget.manage')) {
      const err = errBox();
      const form = h('form', { class: 'panel', novalidate: true }, h('h3', null, 'הוספת שורת תקציב'), err, h('div', { class: 'row' },
        field('סוג', sel('kind', [['actual', 'הוצאה בפועל'], ['planned', 'תכנון']], 'actual')),
        field('תיאור', inp('description', { maxlength: 300 }), { required: true }),
        field('סכום (₪)', inp('amount', { type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal' }), { required: true }),
        field('תאריך', inp('entry_date', { type: 'date', value: today() }), { required: true })), h('button', { class: 'btn primary', type: 'submit' }, 'הוספה'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); if (!validate(form, err)) return;
        try { await api('POST', `/api/projects/${p.id}/budget`, formData(form)); toast('השורה נוספה'); reload(); } catch (ex) { showErr(err, ex.message); }
      });
      wrap.append(form);
    }
    wrap.append(h('div', { style: { 'margin-top': '16px' } }, tableOf([
      { label: 'תאריך', render: e => fmtDate(e.entry_date) }, { label: 'סוג', render: e => e.kind === 'actual' ? 'בפועל' : 'תכנון' },
      { label: 'תיאור', key: 'description' }, { label: 'סכום', render: e => h('span', { class: 'num' }, fmtMoney(e.amount)) },
      { label: '', render: e => can('budget.manage') ? h('button', { class: 'btn sm danger', type: 'button', 'aria-label': 'מחיקת שורה ' + e.description, onclick: async () => { if (await confirmDlg('מחיקת שורה', 'למחוק את שורת התקציב?', 'מחיקה', true)) { try { await api('DELETE', `/api/budget/${e.id}`); reload(); } catch (ex) { toast(ex.message, true); } } } }, icon('trash')) : '' },
    ], entries, { caption: 'שורות תקציב', empty: h('p', { class: 'empty' }, 'אין שורות תקציב.') })));
    return wrap;
  }
  async function viewBudget(main) {
    const { items } = await api('GET', '/api/projects');
    const totB = items.reduce((a, p) => a + p.budget, 0); const totS = items.reduce((a, p) => a + p.spent, 0);
    main.replaceChildren(pageHead('תקציב', 'ניצול תקציב לפי פרויקט. עדכון שורות נעשה מתוך עמוד הפרויקט.'),
      h('div', { class: 'kpis' }, h('div', { class: 'kpi' }, h('div', { class: 'v num' }, fmtMoney(totB)), h('div', { class: 'l' }, 'סך מסגרות')),
        h('div', { class: 'kpi' }, h('div', { class: 'v num' }, fmtMoney(totS)), h('div', { class: 'l' }, 'בוצע')),
        h('div', { class: 'kpi' }, h('div', { class: 'v num' }, (totB ? Math.round(totS / totB * 100) : 0) + '%'), h('div', { class: 'l' }, 'ניצול כולל'))),
      tableOf([{ label: 'פרויקט', render: p => h('a', { class: 'rowlink', href: `#/projects/${p.id}` }, p.name) }, { label: 'ניצול', render: p => budgetMeter(p.spent, p.budget) },
        { label: 'יתרה', render: p => h('span', { class: 'num ' + (p.budget - p.spent < 0 ? 'sev-critical' : '') }, fmtMoney(p.budget - p.spent)) }], items, { caption: 'תקציב לפי פרויקט' }));
  }

  // ---------- משימות ----------
  function tasksTable(items, reload, defaults = {}) {
    const wrap = h('div');
    if (can('tasks.manage')) wrap.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => taskDialog(defaults, reload) }, icon('plus'), 'משימה חדשה')));
    wrap.append(tableOf([
      { label: 'משימה', render: t => h('span', null, t.title, t.project_name ? h('div', { class: 'small muted' }, t.project_name) : null) },
      { label: 'אחראי', render: t => t.assignee_name || '—' },
      { label: 'עדיפות', render: t => t.priority === 'דחופה' || t.priority === 'גבוהה' ? h('span', { class: 'chip ' + (t.priority === 'דחופה' ? 'late' : 'st-coordination') }, t.priority) : t.priority },
      { label: 'יעד', render: t => { const late = t.due_date && t.due_date < today() && t.status !== 'הושלמה'; return h('span', { class: late ? 'sev-critical' : '' }, fmtDate(t.due_date), late ? ' (באיחור)' : ''); } },
      { label: 'סטטוס', render: t => {
        if (!(can('tasks.manage') || t.assignee_id === S.me.id)) return t.status;
        const s = sel('status', ['פתוחה', 'בביצוע', 'ממתינה', 'הושלמה'].map(x => [x, x]), t.status, { 'aria-label': 'סטטוס משימה ' + t.title, style: { 'min-height': '36px', width: 'auto' } });
        s.addEventListener('change', async () => { try { await api('PUT', `/api/tasks/${t.id}`, { status: s.value }); toast('הסטטוס עודכן'); } catch (ex) { toast(ex.message, true); s.value = t.status; } });
        return s;
      } },
      { label: '', render: t => can('tasks.manage') ? h('span', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn sm', type: 'button', 'aria-label': 'עריכת ' + t.title, onclick: () => taskDialog(t, reload) }, icon('edit')),
        h('button', { class: 'btn sm danger', type: 'button', 'aria-label': 'מחיקת ' + t.title, onclick: async () => { if (await confirmDlg('מחיקת משימה', `למחוק את "${t.title}"?`, 'מחיקה', true)) { try { await api('DELETE', `/api/tasks/${t.id}`); reload(); } catch (ex) { toast(ex.message, true); } } } }, icon('trash'))) : '' },
    ], items, { caption: 'משימות', empty: h('p', { class: 'empty' }, 'אין משימות.') }));
    return wrap;
  }
  async function taskDialog(t, done) {
    const [users, projects] = await Promise.all([api('GET', '/api/users/lookup'), api('GET', '/api/projects/options')]);
    const err = errBox();
    const form = h('form', { novalidate: true }, err,
      field('כותרת', inp('title', { value: t.title || '', maxlength: 200 }), { required: true }),
      h('div', { class: 'row' }, field('פרויקט', sel('project_id', [['', 'ללא'], ...projects.items.map(p => [p.id, p.name])], t.project_id)),
        field('אחראי', sel('assignee_id', [['', 'ללא'], ...users.items.map(u => [u.id, u.full_name])], t.assignee_id))),
      h('div', { class: 'row' }, field('עדיפות', sel('priority', ['נמוכה', 'רגילה', 'גבוהה', 'דחופה'].map(x => [x, x]), t.priority || 'רגילה')),
        field('סטטוס', sel('status', ['פתוחה', 'בביצוע', 'ממתינה', 'הושלמה'].map(x => [x, x]), t.status || 'פתוחה'))),
      h('div', { class: 'row' }, field('התחלה', inp('start_date', { type: 'date', value: t.start_date || '' })), field('תאריך יעד', inp('due_date', { type: 'date', value: t.due_date || '' }))),
      field('תיאור', area('description', { value: t.description || '', maxlength: 3000, rows: 3 })));
    const m = modal(t.id ? 'עריכת משימה' : 'משימה חדשה', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      try { await api(t.id ? 'PUT' : 'POST', t.id ? `/api/tasks/${t.id}` : '/api/tasks', formData(form)); m.close(); toast('המשימה נשמרה'); done(); } catch (ex) { showErr(err, ex.message); }
    });
  }
  async function viewTasks(main, q) {
    const mine = q.mine === '1';
    const { items } = await api('GET', '/api/tasks' + (mine ? '?mine=1' : ''));
    main.replaceChildren(pageHead('משימות', can('tasks.manage') ? (mine ? 'המשימות שלי' : 'כל המשימות') : 'המשימות שהוקצו לך',
      can('tasks.manage') ? h('a', { class: 'btn', href: mine ? '#/tasks' : '#/tasks?mine=1' }, mine ? 'הצגת כל המשימות' : 'רק המשימות שלי') : null), tasksTable(items, () => viewTasks(main, q)));
  }

  // ---------- לוח זמנים ----------
  async function viewSchedule(main) {
    const { items } = await api('GET', '/api/schedule');
    const valid = items.filter(i => i.start_date && i.end_date);
    if (!valid.length) { main.replaceChildren(pageHead('לוח זמנים'), h('div', { class: 'panel empty' }, 'אין עדיין פריטים עם תאריכים. הוסיפו תאריכים לפרויקטים, משימות ובקשות.')); return; }
    const t = (s) => new Date(s + 'T00:00:00').getTime();
    let min = Math.min(...valid.map(i => t(i.start_date))); let max = Math.max(...valid.map(i => t(i.end_date)));
    const d0 = new Date(min); min = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
    const d1 = new Date(max); max = new Date(d1.getFullYear(), d1.getMonth() + 1, 1).getTime();
    const span = max - min; const months = [];
    for (let d = new Date(min); d.getTime() < max; d.setMonth(d.getMonth() + 1)) months.push(d.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' }));
    const pct = (x) => ((x - min) / span * 100).toFixed(2) + '%';
    const nowPct = Date.now() > min && Date.now() < max ? pct(Date.now()) : null;
    const KIND = { project: 'פרויקט', task: 'משימה', request: 'בקשה' };
    const chart = h('div', { class: 'gantt panel', 'aria-hidden': 'true' }, h('div', { class: 'gantt-inner' },
      h('div', { class: 'g-scale' }, h('span'), h('div', { class: 'g-months' }, months.map(m => h('span', null, m)))),
      valid.map(i => h('div', { class: 'g-row' }, h('div', { class: 'g-name' }, i.name),
        h('div', { class: 'g-track' }, nowPct ? h('span', { class: 'g-today', style: { '--t': nowPct } }) : null,
          h('a', { class: 'g-bar ' + i.kind, href: safeHash(i.link), tabindex: '-1', style: { '--s': pct(t(i.start_date)), '--w': ((t(i.end_date) - t(i.start_date) + 86400000) / span * 100).toFixed(2) + '%' } }, KIND[i.kind]))))));
    main.replaceChildren(pageHead('לוח זמנים', 'פרויקטים, משימות ועבודות מתוכננות על ציר זמן. הקו האדום מסמן את היום.'), chart,
      h('h2', { style: { 'margin-top': '20px' } }, 'הפריטים בטבלה'),
      tableOf([{ label: 'סוג', render: i => KIND[i.kind] }, { label: 'שם', render: i => h('a', { href: safeHash(i.link) }, i.name) },
        { label: 'התחלה', render: i => fmtDate(i.start_date) }, { label: 'סיום', render: i => fmtDate(i.end_date) }, { label: 'סטטוס', render: i => i.status || '—' }], valid, { caption: 'לוח זמנים' }));
  }

  // ---------- עיצוב ותצוגה ----------
  const THEMES = [['drafting', 'שרטוט', '#F2F4F1', '#A61E5E'], ['concrete', 'בטון', '#ECECEA', '#2F5D50'], ['sand', 'חול', '#F1EEE6', '#1E5A8C'], ['ocean', 'אוקיינוס', '#EEF3F7', '#0B62B8'],
    ['aurora', 'זוהר', '#F4F2FC', '#6A3BD3'], ['night', 'לילה תכנוני', '#0B1620', '#5CC8FF'], ['graphite', 'גרפיט', '#111213', '#8AB4FF']];
  const PRESETS = [
    ['classic', 'קלאסי', ['#F2F4F1', '#FFFFFF', '#A61E5E'], { theme: 'drafting', mode: 'auto', shape: 'soft', style: 'flat', bg: 'plain', width: 'regular', sidebar: 'full', header: 'blur', density: 'regular' }],
    ['modern', 'מודרני', ['#E9E3FB', '#FFFFFF', '#6A3BD3'], { theme: 'aurora', mode: 'auto', shape: 'round', style: 'glass', bg: 'aurora', width: 'wide', sidebar: 'floating', header: 'blur', density: 'regular' }],
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
      h('div', { class: 'req-head' }, h('div', { class: 'req-number' }, 'TH-2026-0042'), h('div', null, h('div', { class: 'req-title' }, 'הנחת קו מים ברחוב הדוגמה'), h('div', null, statusChip('coordination'), ' ', h('span', { class: 'chip fast' }, 'מזורז')))),
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
        h('dt', null, 'דוא"ל'), h('dd', { class: 'ltr' }, u.email || '—'), h('dt', null, 'מחלקה'), h('dd', null, u.department || '—'), h('dt', null, 'כניסה אחרונה'), h('dd', null, fmtDateTime(u.last_login))),
        h('h3', { style: { 'margin-top': '16px' } }, 'ההרשאות שלך'), h('p', { class: 'small muted' }, `${S.perms.size} הרשאות פעילות. לשינוי פנו למנהל המערכת.`)), form));
  }

  // ---------- ניהול: משתמשים ----------
  async function viewAdminUsers(main) {
    const [{ items, roles }, infra] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/infra')]);
    const roleName = Object.fromEntries(roles.map(r => [r.id, r.name]));
    const reload = () => viewAdminUsers(main);
    main.replaceChildren(pageHead('משתמשים', `${items.length} משתמשים. משתמש חדש יתבקש להחליף סיסמה בכניסה הראשונה.`, h('button', { class: 'btn primary', type: 'button', onclick: () => userDialog(null, roles, infra.items, reload) }, icon('plus'), 'משתמש חדש')),
      tableOf([
        { label: 'שם', render: u => h('span', null, u.full_name, h('div', { class: 'small muted ltr' }, u.username)) },
        { label: 'תפקיד', render: u => roleName[u.role_id] + (u.perm_grant.length || u.perm_deny.length ? ' (+התאמות)' : '') },
        { label: 'גורם תשתית', render: u => (infra.items.find(b => b.id === u.infra_body_id) || {}).name || '—' },
        { label: 'מצב', render: u => !u.active ? h('span', { class: 'chip st-rejected' }, 'מושבת') : u.locked ? h('span', { class: 'chip st-returned' }, 'נעול') : h('span', { class: 'chip st-approved' }, 'פעיל') },
        { label: 'כניסה אחרונה', render: u => fmtDateTime(u.last_login) },
        { label: 'פעולות', render: u => h('span', { style: { display: 'flex', gap: '6px', 'flex-wrap': 'wrap' } },
          h('button', { class: 'btn sm', type: 'button', onclick: () => userDialog(u, roles, infra.items, reload) }, 'עריכה'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => resetLink(u) }, 'קישור איפוס'),
          u.locked ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { await api('POST', `/api/admin/users/${u.id}/unlock`, {}); toast('החשבון שוחרר'); reload(); } }, 'שחרור נעילה') : null,
          h('button', { class: 'btn sm', type: 'button', onclick: async () => { await api('POST', `/api/admin/users/${u.id}/logout`, {}); toast('כל ההתחברויות של המשתמש נותקו'); } }, 'ניתוק')) },
      ], items, { caption: 'משתמשים' }));
  }
  async function resetLink(u) {
    try {
      const r = await api('POST', `/api/admin/users/${u.id}/reset-link`, {});
      const input = h('input', { type: 'text', readonly: true, value: r.link, dir: 'ltr', id: 'rlink' });
      const m = modal('קישור איפוס סיסמה', h('div', null, h('p', null, `שלחו את הקישור ל${u.full_name} בערוץ מאובטח. הקישור חד-פעמי ותקף ${r.expiresMinutes} דקות.`), field('קישור', input)),
        [h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(r.link); toast('הקישור הועתק'); } catch { input.select(); } } }, 'העתקה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'סגירה')]);
    } catch (ex) { toast(ex.message, true); }
  }
  async function userDialog(u, roles, infra, done) {
    const perms = can('admin.roles') ? (await api('GET', '/api/admin/permissions')).items : [];
    u = u || { perm_grant: [], perm_deny: [], active: true };
    const err = errBox();
    const form = h('form', { novalidate: true }, err,
      h('div', { class: 'row' }, field('שם מלא', inp('full_name', { value: u.full_name || '', maxlength: 100 }), { required: true }),
        u.id ? null : field('שם משתמש', inp('username', { maxlength: 60, dir: 'ltr', pattern: '[a-zA-Z0-9._\\-]{3,60}', autocomplete: 'off' }), { required: true, hint: 'אותיות לועזיות, ספרות, נקודה, מקף.' })),
      h('div', { class: 'row' }, field('דוא"ל', inp('email', { type: 'email', value: u.email || '', maxlength: 200, dir: 'ltr' })), field('טלפון', inp('phone', { type: 'tel', value: u.phone || '', maxlength: 30, dir: 'ltr' }))),
      h('div', { class: 'row' }, field('מחלקה', inp('department', { value: u.department || '', maxlength: 100 })),
        field('תפקיד', sel('role_id', [['', 'בחרו'], ...roles.map(r => [r.id, r.name])], u.role_id, { disabled: u.id && !can('admin.roles') }), { required: true })),
      field('שיוך לגורם תשתית', sel('infra_body_id', [['', 'ללא'], ...infra.map(b => [b.id, b.name])], u.infra_body_id), { hint: 'משתמש משויך יוכל לתת חוות דעת בשם הגורם.' }),
      u.id ? null : field('סיסמה ראשונית', inp('password', { type: 'password', minlength: 12, maxlength: 128, autocomplete: 'new-password', dir: 'ltr' }), { required: true, hint: 'לפחות 12 תווים. המשתמש יחליף אותה בכניסה הראשונה.' }),
      u.id ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: u.active }), 'משתמש פעיל') : null,
      perms.length ? h('details', null, h('summary', { style: { cursor: 'pointer', 'font-weight': '650', padding: '8px 0' } }, 'התאמת הרשאות פרטנית למשתמש'),
        h('p', { class: 'small muted' }, 'ברירת המחדל היא הרשאות התפקיד. אפשר להעניק או לחסום הרשאה מסוימת למשתמש זה בלבד.'),
        h('div', null, perms.map(p => h('div', { class: 'perm-tri' }, h('label', { for: 'pt-' + p.key }, p.label, h('span', { class: 'small muted' }, ' · ' + p.group)),
          sel('pt-' + p.key, [['', 'לפי התפקיד'], ['grant', 'הענקה'], ['deny', 'חסימה']], u.perm_grant.includes(p.key) ? 'grant' : u.perm_deny.includes(p.key) ? 'deny' : '', { id: 'pt-' + p.key, 'data-perm': p.key }))))) : null);
    const m = modal(u.id ? `עריכת ${u.full_name}` : 'משתמש חדש', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'שמירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(form, err)) return;
      const data = {};
      for (const el of form.elements) if (el.name && !el.name.startsWith('pt-') && !el.disabled) data[el.name] = el.type === 'checkbox' ? el.checked : (el.value.trim() || null);
      if (perms.length) { data.perm_grant = []; data.perm_deny = []; for (const s of form.querySelectorAll('[data-perm]')) { if (s.value === 'grant') data.perm_grant.push(s.dataset.perm); if (s.value === 'deny') data.perm_deny.push(s.dataset.perm); } }
      try { await api(u.id ? 'PUT' : 'POST', u.id ? `/api/admin/users/${u.id}` : '/api/admin/users', data); m.close(); toast('המשתמש נשמר'); done(); } catch (ex) { showErr(err, ex.message); }
    });
  }

  // ---------- ניהול: תפקידים והרשאות ----------
  async function viewAdminRoles(main) {
    const [{ items: roles }, { items: perms }] = await Promise.all([api('GET', '/api/admin/roles'), api('GET', '/api/admin/permissions')]);
    const reload = () => viewAdminRoles(main);
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
    main.replaceChildren(pageHead('תפקידים והרשאות', 'קבעו לכל תפקיד אילו פעולות מותרות: צפייה, הוספה, עריכה, מחיקה, העלאת קבצים, אישור מסלול ואישורים סופיים. כל הרשאה נאכפת בשרת.',
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const err = errBox(); const form = h('form', { novalidate: true }, err, field('שם התפקיד החדש', inp('name', { maxlength: 60 }), { required: true }));
        const m = modal('תפקיד חדש', form, [h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'יצירה'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ביטול')]);
        form.addEventListener('submit', async (e) => { e.preventDefault(); if (!validate(form, err)) return; try { await api('POST', '/api/admin/roles', { name: form.elements.name.value, perms: ['requests.view_own'] }); m.close(); reload(); } catch (ex) { showErr(err, ex.message); } });
      } }, icon('plus'), 'תפקיד חדש')), list, editor);
  }

  // ---------- ניהול: הגדרות, סוגי קבצים, גורמי תשתית ----------
  async function viewAdminSettings(main) {
    const [s, infra] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/infra')]);
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
      h('button', { class: 'btn primary', type: 'submit', style: { 'margin-top': '12px' } }, 'שמירת הגדרות קבצים'));
    files.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(files, fErr)) return;
      try { await api('PUT', '/api/admin/settings', { allowed_ext: ext, max_mb: files.max_mb.value }); toast('הגדרות הקבצים נשמרו'); await refreshMe(); reload(); } catch (ex) { showErr(fErr, ex.message); }
    });
    const gErr = errBox();
    const general = h('form', { class: 'panel', novalidate: true }, h('h2', null, 'כללי ומסלולי טיפול'), gErr,
      h('div', { class: 'row' }, field('שם המערכת', inp('system_title', { value: s.system_title, maxlength: 100 }), { required: true }), field('שם הארגון', inp('org_name', { value: s.org_name, maxlength: 100 }), { required: true })),
      h('div', { class: 'row' }, field('ימי טיפול – מסלול רגיל', inp('sla_regular_days', { type: 'number', min: 1, max: 365, value: s.sla_regular_days }), { required: true }),
        field('ימי טיפול – מסלול מזורז', inp('sla_fast_days', { type: 'number', min: 1, max: 60, value: s.sla_fast_days }), { required: true })),
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירה'));
    general.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(general, gErr)) return;
      try { await api('PUT', '/api/admin/settings', formData(general)); toast('ההגדרות נשמרו'); await refreshMe(); renderShell(); route(); } catch (ex) { showErr(gErr, ex.message); }
    });
    const iErr = errBox();
    const infraForm = h('form', { class: 'toolbar', novalidate: true }, h('div', { class: 'field grow' }, h('label', { for: 'nib' }, 'גורם חדש'), inp('name', { id: 'nib', maxlength: 100, required: true })),
      h('div', { class: 'field grow' }, h('label', { for: 'nic' }, 'איש קשר'), inp('contact', { id: 'nic', maxlength: 200 })), h('button', { class: 'btn', type: 'submit' }, 'הוספה'));
    infraForm.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!validate(infraForm, iErr)) return;
      try { await api('POST', '/api/admin/infra', formData(infraForm)); toast('הגורם נוסף'); reload(); } catch (ex) { showErr(iErr, ex.message); }
    });
    const infraPanel = h('section', { class: 'panel' }, h('h2', null, 'גורמי תשתית'), iErr, infraForm,
      h('div', { class: 'approvals' }, infra.items.map(b => h('div', { class: 'approval' }, h('span', { class: 'mark ' + markClass(b.name), 'aria-hidden': 'true' }),
        h('div', null, h('div', { class: 'who' }, b.name), h('div', { class: 'note' }, b.contact || 'ללא איש קשר', b.active ? '' : ' · מושבת')),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await api('PUT', `/api/admin/infra/${b.id}`, { active: !b.active }); reload(); } catch (ex) { toast(ex.message, true); } } }, b.active ? 'השבתה' : 'הפעלה')))));
    main.replaceChildren(pageHead('הגדרות וקבצים'), h('div', { class: 'grid two' }, files, h('div', null, general, infraPanel)));
  }
  async function refreshMe() {
    const me = await api('GET', '/api/auth/me');
    S.me = me.user; S.perms = new Set(me.perms); S.meta = me.meta; S.title = me.title; S.org = me.org; S.csrf = me.csrf;
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
  async function viewAdminBackups(main) {
    const { status, items } = await api('GET', '/api/admin/backups');
    main.replaceChildren(pageHead('גיבויים', `גיבוי אוטומטי כל ${status.intervalMinutes} דקות, 24 שעות ביממה. גיבויים נשמרים ${status.retentionDays} יום.`,
      h('button', { class: 'btn primary', type: 'button', onclick: async (e) => { try { await submitting(e.currentTarget, () => api('POST', '/api/admin/backups', {})); toast('הגיבוי הושלם'); viewAdminBackups(main); } catch (ex) { toast(ex.message, true); } } }, 'גיבוי עכשיו')),
      status.lastError ? h('div', { class: 'form-error', role: 'alert' }, `הגיבוי האחרון נכשל (${fmtDateTime(status.lastError.at.replace('T', ' ').slice(0, 19))}): ${status.lastError.message}`) : null,
      h('section', { class: 'panel' }, h('p', null, status.lastBackup ? `גיבוי אחרון: ${new Date(status.lastBackup.at).toLocaleString('he-IL')} (${fmtSize(status.lastBackup.size)}).` : 'עדיין לא בוצע גיבוי מאז הפעלת השרת.'),
        h('p', { class: 'small muted' }, 'כל פעולה במערכת נשמרת מיד במסד הנתונים בשרת. לגיבוי מחוץ לשרת, הגדירו תיקיית גיבוי על דיסק ענן (BACKUP_DIR).')),
      tableOf([{ label: 'קובץ', render: b => h('span', { class: 'ltr small' }, b.file) }, { label: 'מועד', render: b => new Date(b.at).toLocaleString('he-IL') }, { label: 'גודל', render: b => h('span', { class: 'num' }, fmtSize(b.size)) }], items, { caption: 'גיבויים' }));
  }

  // ---------- אתחול ----------
  async function boot() {
    try {
      const me = await api('GET', '/api/auth/me');
      S.me = me.user; S.csrf = me.csrf; S.perms = new Set(me.perms); S.meta = me.meta; S.prefs = me.prefs || {}; S.title = me.title; S.org = me.org; S.unread = me.unread;
      applyPrefs(S.prefs);
    } catch (ex) {
      S.me = null;
      try { const r = await fetch('/api/auth/me', { headers: { 'X-Requested-With': 'fetch' } }); const j = await r.json(); if (j.title) { S.title = j.title; S.org = j.org; } } catch { /* */ }
    }
    shell = null;
    await route();
  }
  window.addEventListener('hashchange', route);
  applyPrefs({});
  boot();
})();
