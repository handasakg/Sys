'use strict';
// מסמכי PDF שהמערכת מפיקה: אישור לביצוע עבודה (נשלח למגיש), וטופס משטרה (פנימי, מוגבל).
const crypto = require('node:crypto');
const { Doc } = require('./pdfgen');

const C = { navy: '#0E4D92', ink: '#17252A', muted: '#5B6B7A', rule: '#C9D6E3', panel: '#F3F7FB', strip: '#E6F0FA', ok: '#1D7A47', okSoft: '#E5F4EA', warn: '#8A5300', bad: '#B3261E' };
const M = 40; const RIGHT = 555.28; const WIDTH = RIGHT - M; const BOTTOM = 772;
const dmy = (s) => { if (!s) return '—'; const d = new Date(String(s).length <= 10 ? s + 'T00:00:00Z' : String(s).replace(' ', 'T') + 'Z'); if (Number.isNaN(+d)) return String(s); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const days = (a, b) => { if (!a || !b) return null; const n = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1; return n > 0 ? n : null; };
const DEC = { approved: ['אושר', C.ok], conditions: ['אושר בתנאים', C.warn], rejected: ['נדחה', C.bad], pending: ['ממתין', C.muted] };
const KIND = { resident: 'תושב/ת', entrepreneur: 'יזם' };

// עזרי פריסה משותפים
class Layout {
  constructor(doc, { headerSmall, footerLeft, footerRight, footerNote }) {
    Object.assign(this, { doc, headerSmall, footerLeft, footerRight, footerNote }); this.y = 0;
  }
  ensure(h) {
    if (this.y + h <= BOTTOM) return;
    this.doc.page(); this.y = 44;
    this.doc.rect(0, 0, this.doc.W, 5, { fill: C.navy });
    this.doc.text(this.headerSmall, RIGHT, this.y, { size: 9, color: C.muted }); this.y += 22;
  }
  section(title) {
    this.ensure(48); this.y += 10;
    this.doc.rect(RIGHT - 4, this.y - 11, 4, 15, { fill: C.navy, r: 1 });
    this.doc.text(title, RIGHT - 12, this.y, { size: 12.5, bold: true, color: C.navy });
    this.doc.line(M, this.y + 7, RIGHT, this.y + 7, { color: C.rule, lw: 0.8 });
    this.y += 24;
  }
  // שדות בשתי עמודות (תווית מעל ערך). full = שדה ברוחב מלא
  fields(items) {
    const colW = (WIDTH - 20) / 2; let i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.full) {
        const lines = this.doc.wrap(it.value || '—', 10.5, false, WIDTH - 8);
        this.ensure(18 + lines.length * 15);
        this.doc.text(it.label, RIGHT, this.y, { size: 8.5, color: C.muted });
        this.y = this.doc.para(it.value || '—', RIGHT, this.y + 15, WIDTH - 8, { size: 10.5, lead: 1.4 }) + 4; i++; continue;
      }
      const pair = [it, items[i + 1] && !items[i + 1].full ? items[i + 1] : null];
      const wrapped = pair.map(p => (p ? this.doc.wrap(p.value || '—', 10.5, false, colW - 6) : []));
      const h = 16 + Math.max(...wrapped.map(w => w.length || 1)) * 14.5;
      this.ensure(h + 4);
      pair.forEach((p, k) => {
        if (!p) return; const xr = RIGHT - k * (colW + 20);
        this.doc.text(p.label, xr, this.y, { size: 8.5, color: C.muted });
        let yy = this.y + 15; for (const line of wrapped[k]) { this.doc.text(line, xr, yy, { size: 10.5, bold: !!p.strong }); yy += 14.5; }
        this.doc.line(xr - colW + 4, this.y + h - 6, xr, this.y + h - 6, { color: '#E3EAF2', lw: 0.6 });
      });
      this.y += h + 4; i += pair[1] ? 2 : 1;
    }
  }
  footers(code) {
    const total = this.doc.pages.length;
    this.doc.pages.forEach((p, idx) => {
      this.doc.cur = p;
      this.doc.line(M, 796, RIGHT, 796, { color: C.rule, lw: 0.6, dash: [2, 2] });
      this.doc.text(this.footerRight, RIGHT, 810, { size: 8, color: C.muted });
      this.doc.text(`עמוד ${idx + 1} מתוך ${total}`, M, 810, { size: 8, color: C.muted, align: 'left' });
      this.doc.text(this.footerNote, (M + RIGHT) / 2, 824, { size: 7.5, color: C.muted, align: 'center' });
      if (code) this.doc.text(`קוד מסמך ${code}`, M, 824, { size: 7.5, color: C.muted, align: 'left' });
    });
    this.doc.cur = this.doc.pages[this.doc.pages.length - 1];
  }
}

function header(doc, { logo, org, title, subtitle }) {
  doc.rect(0, 0, doc.W, 6, { fill: C.navy });
  let textRight = RIGHT;
  if (logo) { const r = doc.image(logo, RIGHT - 92, 22, 92, 78); if (r) textRight = r.x - 14; }
  doc.text(org, textRight, 40, { size: 10.5, color: C.muted });
  doc.text(title, textRight, 66, { size: 21, bold: true, color: C.navy });
  if (subtitle) doc.text(subtitle, textRight, 86, { size: 11, color: C.ink });
}

// ------------------------------------------------------------------
// אישור לביצוע עבודה
// ------------------------------------------------------------------
function approvalPdf(d) {
  const r = d.request; const pol = d.police || {};
  const doc = new Doc({ title: `אישור לביצוע עבודה – בקשה ${r.number}`, author: d.org });
  const code = crypto.createHash('sha256').update(`${r.id}|${r.number}|${r.closed_at}|${d.secret || ''}`).digest('hex').slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  const L = new Layout(doc, { headerSmall: `אישור לביצוע עבודה – בקשה ${r.number} (המשך)`, footerRight: `${d.org} · ${d.systemTitle}`, footerNote: 'המסמך הופק אוטומטית במערכת לאחר אישור כל הגורמים ומנהל המערכת' });
  header(doc, { logo: d.logo, org: d.org, title: 'אישור לביצוע עבודה', subtitle: d.typeName });
  // חותמת אישור
  doc.rect(M, 22, 158, 78, { fill: C.okSoft, stroke: C.ok, lw: 1.4, r: 10 });
  doc.circle(M + 136, 44, 10, { fill: C.ok });
  doc.op(`q 1 1 1 RG 2 w 1 J 1 j ${M + 131} ${doc.H - 44} m ${M + 135} ${doc.H - 48.5} l ${M + 141.5} ${doc.H - 39.5} l S Q`);
  doc.text('הבקשה אושרה', M + 120, 49, { size: 14, bold: true, color: C.ok });
  doc.text(`מספר בקשה ${r.number}`, M + 148, 70, { size: 10, bold: true, color: C.ink });
  doc.text(`תאריך אישור ${dmy(r.closed_at)}`, M + 148, 88, { size: 9.5, color: C.ink });
  // פס תוקף
  const from = r.planned_start || (r.closed_at || '').slice(0, 10); const to = r.planned_end;
  doc.rect(M, 116, WIDTH, 34, { fill: C.strip, r: 8 });
  doc.text(`תוקף האישור: מ-${dmy(from)} עד ${to ? dmy(to) : 'סיום העבודה'}`, RIGHT - 14, 138, { size: 12, bold: true, color: C.navy });
  doc.text(`הוגשה ${dmy(r.submitted_at || r.created_at)}`, M + 14, 138, { size: 10, color: C.ink, align: 'left' });
  L.y = 168;

  L.section('מגיש הבקשה');
  L.fields([
    { label: 'שם מלא', value: pol.applicant_name || d.applicant.full_name, strong: true }, { label: pol.id_kind === 'company' ? 'ח.פ' : 'ת.ז', value: pol.id_number || '—' },
    { label: 'סוג מגיש', value: KIND[r.applicant_kind] || 'עובד/ת המערכת' }, { label: 'טלפון', value: d.applicant.phone || pol.phone || '—' },
    { label: 'דוא"ל לקבלת עדכונים', value: d.applicant.email || '—' }, { label: 'כתובת', value: d.applicant.address || '—' },
  ]);
  L.section('פרטי העבודה');
  L.fields([
    { label: 'סוג הבקשה', value: d.typeName, strong: true }, { label: 'פרויקט', value: r.project_name || pol.project || '—' },
    { label: 'מיקום / כתובת העבודה', value: r.address || '—' }, { label: 'גוש / חלקה', value: [r.gush, r.helka].filter(Boolean).join(' / ') || '—' },
    { label: 'מהות העבודה', value: r.description || pol.description || r.title, full: true },
  ]);
  L.section('מועדים ושעות פעילות');
  const n = days(from, to);
  L.fields([
    { label: 'תחילת עבודה', value: dmy(from) }, { label: 'סיום עבודה', value: to ? dmy(to) : '—' },
    { label: 'משך משוער', value: n ? `${n} ימים` : '—' }, { label: 'ימי עבודה', value: pol.work_time || '—' },
    { label: 'שעות עבודה', value: pol.work_hours || '—' }, { label: 'איש קשר בשטח', value: pol.contact || '—' },
  ]);

  // טבלת גורמים מאשרים
  L.section('גורמים מאשרים');
  const cols = [{ t: 'גוף', w: 120 }, { t: 'שם המאשר', w: 105 }, { t: 'סטטוס', w: 78 }, { t: 'תאריך', w: 66 }, { t: 'הערות ותנאים', w: WIDTH - 369 }];
  const drawHead = () => {
    doc.rect(M, L.y - 13, WIDTH, 22, { fill: C.navy, r: 4 });
    let x = RIGHT; for (const c of cols) { doc.text(c.t, x - 8, L.y + 2, { size: 9.5, bold: true, color: '#FFFFFF' }); x -= c.w; }
    L.y += 18;
  };
  L.ensure(60); drawHead();
  const rows = d.approvals.map(a => ({ cells: [a.body_name, a.decided_by_name || '—', ...(DEC[a.decision] || DEC.pending), dmy(a.decided_at)], note: a.comment || '' }));
  rows.push({ cells: ['מנהל המערכת – אישור סופי', d.admin.name || '—', 'אושר', C.ok, dmy(r.closed_at)], note: d.admin.comment || '', final: true });
  rows.forEach((row, i) => {
    const noteLines = row.note ? doc.wrap(row.note, 9, false, cols[4].w - 14) : [];
    const nameLines = doc.wrap(row.cells[0], 9.5, true, cols[0].w - 14);
    const h = Math.max(30, 16 + Math.max(noteLines.length, nameLines.length) * 12.5);
    if (L.y + h > BOTTOM) { L.ensure(h + 30); drawHead(); }
    if (i % 2 === 0 || row.final) doc.rect(M, L.y - 12, WIDTH, h, { fill: row.final ? C.okSoft : C.panel });
    let x = RIGHT;
    let yy = L.y + 2; for (const l of nameLines) { doc.text(l, x - 8, yy, { size: 9.5, bold: true }); yy += 12.5; } x -= cols[0].w;
    doc.text(row.cells[1], x - 8, L.y + 2, { size: 9.5 }); x -= cols[1].w;
    doc.text(row.cells[2], x - 8, L.y + 2, { size: 9.5, bold: true, color: row.cells[3] }); x -= cols[2].w;
    doc.text(row.cells[4], x - 8, L.y + 2, { size: 9.5 }); x -= cols[3].w;
    yy = L.y + 2; for (const l of noteLines) { doc.text(l, x - 8, yy, { size: 9, color: C.ink }); yy += 12.5; }
    doc.line(M, L.y - 12 + h, RIGHT, L.y - 12 + h, { color: C.rule, lw: 0.5 });
    L.y += h;
  });
  L.y += 6;

  // הנחיות כלליות
  const g = String(d.guidelines || '').split(/\r?\n/).map(s => s.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
  if (g.length) {
    L.section('הנחיות ותנאים כלליים');
    for (const item of g) {
      const lines = doc.wrap(item, 9.5, false, WIDTH - 22);
      L.ensure(lines.length * 13.5 + 4);
      doc.circle(RIGHT - 4, L.y - 3.2, 2.2, { fill: C.navy });
      for (const l of lines) { doc.text(l, RIGHT - 14, L.y, { size: 9.5 }); L.y += 13.5; }
      L.y += 3;
    }
  }
  L.footers(code);
  return { buffer: doc.toBuffer(), code };
}

// ------------------------------------------------------------------
// טופס משטרה (פנימי)
// ------------------------------------------------------------------
function policePdf(d) {
  const p = d.police; const r = d.request;
  const doc = new Doc({ title: `טופס משטרה – בקשה ${r.number}`, author: d.org });
  const L = new Layout(doc, { headerSmall: `טופס משטרה – בקשה ${r.number} (המשך)`, footerRight: `${d.org} · ${d.systemTitle}`, footerNote: 'מסמך פנימי – גישה למנהל המערכת ולאחראי מיפוי הבקשות בלבד' });
  header(doc, { logo: d.logo, org: d.org, title: 'טופס משטרה', subtitle: 'פרטי עבודה לתיאום מול המשטרה' });
  doc.rect(M, 26, 150, 62, { fill: C.strip, stroke: C.navy, lw: 1, r: 10 });
  doc.text(`בקשה ${r.number}`, M + 140, 50, { size: 12, bold: true, color: C.navy });
  doc.text(`הוגש ${dmy(r.submitted_at || r.created_at)}`, M + 140, 72, { size: 9.5 });
  L.y = 124;
  L.section('פרטי המבקש/ת');
  L.fields([
    { label: 'שם מבקש/ת', value: p.applicant_name, strong: true }, { label: p.id_kind === 'company' ? 'ח.פ' : 'תעודת זהות', value: p.id_number },
    { label: 'פלאפון', value: p.phone }, { label: 'איש קשר', value: p.contact },
  ]);
  L.section('פרטי העבודה');
  L.fields([
    { label: 'פרויקט', value: p.project, strong: true }, { label: 'תאריך', value: dmy(p.date) },
    { label: 'זמן עבודה', value: p.work_time }, { label: 'שעות עבודה', value: p.work_hours },
    { label: 'תיאור', value: p.description, full: true }, { label: 'הערות', value: p.notes || '—', full: true },
  ]);
  L.footers(null);
  return { buffer: doc.toBuffer() };
}

const DEFAULT_GUIDELINES = [
  'לא יאוחר מ-7 ימים לפני תחילת העבודה יש לתאם סיור בשטח עם המפקח העירוני האחראי על אזור העבודה. עבודה מטעם תאגיד המים מחייבת גם תיאום עם מפקח התאגיד.',
  'אין לעשות שימוש בשטח ציבורי סמוך (מדרכות, כבישים, גנים וכדומה) ללא אישור ותוכנית הסדרי תנועה מאושרת.',
  'אין להקים את אתר ההתארגנות אלא באישור מראש של מנהל ההנדסה. אין להשתמש בתשתיות עירוניות (עמודי חשמל, תמרורים) לתלייה, חיבור או קיבוע.',
  'יש לגדר את אתר העבודה, לתקן ולסמן אותו היטב ולהציב שילוט אזהרה ברור בכל גישה אפשרית לאתר. יש להגדיר ולסמן דרכי גישה בטוחות לעוברים ושבים.',
  'אין להשאיר כלים, ציוד וחומרי בנייה בשטח הציבורי בסיום יום העבודה. יש לנקות את האזור מדי יום ולהשאירו נקי ובטוח.',
  'פסולת בניין ועודפי עפר יפונו לאתר מורשה בלבד. יש להציג אישורי פינוי למפקח העירוני על פי דרישה.',
  'באחריות הקבלן למנוע ולטפל בפגיעה בתשתיות ציבוריות. טיפול בנזקים יתבצע ללא דיחוי ובתיאום מול גורמי העירייה.',
  'עבודות מרעישות יבוצעו בהתאם לתקנות למניעת מפגעים: בימי חול בין 07:00 ל-19:00, ובימי שישי וערבי חג בין 07:00 ל-17:00 לכל המאוחר.',
  'בתום העבודות יש לתאם סיור סיום עם מחלקת הפיקוח העירוני לקבלת אישור על תקינות האתר וסביבתו.',
].join('\n');

module.exports = { approvalPdf, policePdf, DEFAULT_GUIDELINES };
