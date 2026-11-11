'use strict';
// מפת GovMap בתוך חלון במערכת (iframe מאותו אתר בלבד).
// ?mode=pick – המגיש לוחץ על המפה ומסמן את מיקום העבודה; הנקודה נשלחת לחלון המערכת.
// ?mode=view&x=..&y=..&z=.. – תצוגת המיקום שנבחר, עם סמן.
// הקואורדינטות ברשת ישראל החדשה (ITM), כמו ב-GovMap.
(() => {
  const qs = new URLSearchParams(location.search);
  const mode = qs.get('mode') === 'view' ? 'view' : 'pick';
  const num = (k) => { const n = Number(qs.get(k)); return Number.isFinite(n) && qs.get(k) !== null && qs.get(k) !== '' ? n : null; };
  const start = { x: num('x'), y: num('y'), z: num('z') };
  const msg = document.getElementById('msg');
  const hint = document.getElementById('hint');
  const post = (data) => { if (window.parent !== window) window.parent.postMessage({ source: 'handasa-map', ...data }, location.origin); };
  const fail = (text, code) => { msg.textContent = text; msg.className = 'msg err'; msg.hidden = false; post({ type: 'error', code, message: text }); };
  const inIsrael = (x, y) => x > 100000 && x < 300000 && y > 350000 && y < 820000;

  // רק חלון של המערכת עצמה רשאי להציג את המפה
  if (window.parent === window && mode === 'pick') { fail('יש לפתוח את המפה מתוך טופס הגשת הבקשה.', 'standalone'); return; }

  fetch('/api/public/map-config', { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
    .then(r => r.json())
    .then(cfg => {
      if (!cfg.token) return fail('המפה עדיין לא הופעלה במערכת (חסר מפתח GovMap).', 'notoken');
      const s = document.createElement('script');
      s.src = 'https://www.govmap.gov.il/govmap/api/govmap.api.js';
      s.onload = () => init(cfg);
      s.onerror = () => fail('לא ניתן לטעון את GovMap. בדקו את החיבור לאינטרנט ונסו שוב.', 'load');
      document.head.append(s);
    })
    .catch(() => fail('לא ניתן לטעון את הגדרות המפה.', 'config'));

  function init(cfg) {
    const g = window.govmap;
    if (!g || !g.createMap) return fail('GovMap לא נטען כראוי.', 'load');
    const has = start.x !== null && start.y !== null && inIsrael(start.x, start.y);
    const center = has ? { x: start.x, y: start.y } : { x: cfg.center.x, y: cfg.center.y };
    const level = has ? (start.z ?? 9) : cfg.center.level;
    let timer = setTimeout(() => fail('GovMap לא נטען. ייתכן שהמפתח לא מאושר לכתובת האתר הזו.', 'timeout'), 25000);
    try {
      g.createMap('map', {
        token: cfg.token, center, level, layersMode: 4, zoomButtons: true, bgButton: true, isEmbeddedToggle: true,
        identifyOnClick: false, setMapMarker: false, showXY: false,
        onError: () => { clearTimeout(timer); fail('GovMap החזיר שגיאה. ייתכן שהמפתח לא מאושר לכתובת האתר הזו.', 'govmap'); },
        onLoad: () => {
          clearTimeout(timer); msg.hidden = true;
          if (has) g.zoomToXY({ x: start.x, y: start.y, level, marker: true });
          if (mode === 'pick') setupPick(g);
          post({ type: 'ready' });
        },
      });
    } catch (e) { clearTimeout(timer); fail('GovMap לא נטען: ' + (e && e.message ? e.message : ''), 'govmap'); }
  }

  function setupPick(g) {
    document.getElementById('bar').hidden = false;
    let level = 9;
    g.onEvent(g.events.CLICK).progress((e) => {
      const p = e && e.mapPoint; if (!p) return;
      const x = Math.round(p.x * 100) / 100, y = Math.round(p.y * 100) / 100;
      if (!inIsrael(x, y)) return;
      g.zoomToXY({ x, y, level, marker: true });
      hint.textContent = 'המיקום סומן. אפשר ללחוץ שוב כדי לדייק, ואז לשמור.'; hint.className = 'hint picked';
      post({ type: 'pick', x, y, z: level });
    });
    if (g.events.EXTENT_CHANGE) g.onEvent(g.events.EXTENT_CHANGE).progress((e) => { const l = e && e.lod && Number(e.lod.level); if (Number.isFinite(l)) level = Math.max(l, 6); });
    document.getElementById('search').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = document.getElementById('q').value.trim(); if (!raw) return;
      const keyword = /קרי+ת גת/.test(raw) ? raw : raw + ' קריית גת';
      hint.textContent = 'מחפש…'; hint.className = 'hint';
      Promise.resolve(g.geocode({ keyword, type: g.geocodeType.FullResult })).then((r) => {
        const list = (r && (r.data || r.Data || r.results)) || [];
        const item = Array.isArray(list) && list.length ? list[0] : r;
        const x = Number(item && (item.X ?? item.x)), y = Number(item && (item.Y ?? item.y));
        if (!inIsrael(x, y)) { hint.textContent = 'הכתובת לא נמצאה. נסו לכתוב רק את שם הרחוב.'; return; }
        g.zoomToXY({ x, y, level: 9, marker: false });
        hint.textContent = 'נמצא. עכשיו לחצו על המפה במקום המדויק של העבודה.';
      }).catch(() => { hint.textContent = 'החיפוש נכשל. אפשר להזיז את המפה ולחפש ידנית.'; });
    });
  }
})();
