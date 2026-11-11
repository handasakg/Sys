'use strict';
// תצוגה מקדימה של קובצי Word (docx) ו-Excel (xlsx) בלי ספריות חיצוניות:
// קוראים את קובץ ה-ZIP, מחלצים את הטקסט והטבלאות, ומחזירים מבנה נתונים פשוט (טקסט בלבד, בלי HTML).
// הגנות: מגבלת גודל לכל רכיב אחרי פריסה (נגד "פצצת ZIP"), מגבלת שורות ועמודות.
const zlib = require('node:zlib');

const MAX_ENTRY = 25 * 1024 * 1024; // 25MB אחרי פריסה
const MAX_ROWS = 1000, MAX_COLS = 40, MAX_BLOCKS = 3000;

function readZip(buf) {
  // מחפשים את סוף הספרייה המרכזית (End Of Central Directory)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('הקובץ פגום');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    entries.set(buf.toString('utf8', p + 46, p + 46 + nlen), { method, csize, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  return (name) => {
    const e = entries.get(name); if (!e) return null;
    if (e.usize > MAX_ENTRY) throw new Error('הקובץ גדול מדי לתצוגה מקדימה');
    const lh = e.off; if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('הקובץ פגום');
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data.toString('utf8');
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY }).toString('utf8');
    throw new Error('שיטת דחיסה לא נתמכת');
  };
}
const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) && c > 8 && c < 0x110000 ? String.fromCodePoint(c) : ''; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
});

// Word: פסקאות וטבלאות לפי הסדר
function docx(buf) {
  const get = readZip(buf);
  const xml = get('word/document.xml'); if (!xml) throw new Error('לא נמצא תוכן במסמך');
  const body = (xml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/) || [, xml])[1];
  const paraText = (p) => {
    let t = '';
    p.replace(/<w:(t|tab|br|cr)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:t>)/g, (m, tag, txt) => { t += tag === 't' ? unxml(txt || '') : tag === 'tab' ? '\t' : '\n'; return m; });
    return t;
  };
  const blocks = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g; let m;
  while ((m = re.exec(body)) && blocks.length < MAX_BLOCKS) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl>')) {
      const rows = [];
      for (const tr of chunk.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
        if (rows.length >= MAX_ROWS) break;
        rows.push((tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).slice(0, MAX_COLS).map(tc => (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(paraText).join('\n').trim()));
      }
      if (rows.length) blocks.push({ type: 'table', rows });
    } else {
      const text = paraText(chunk);
      const heading = /<w:pStyle w:val="(?:Heading|heading|כותרת)\s?(\d)"/.exec(chunk);
      blocks.push(heading ? { type: 'h', level: Math.min(3, Number(heading[1]) || 2), text } : { type: 'p', text });
    }
  }
  return { kind: 'doc', blocks, truncated: blocks.length >= MAX_BLOCKS };
}

// Excel: כל גיליון כטבלה (ערכים מחושבים כפי שנשמרו בקובץ)
function xlsx(buf) {
  const get = readZip(buf);
  const shared = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(unxml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  const wb = get('xl/workbook.xml') || '';
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const target = {}; rels.replace(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g, (m, id, t) => { target[id] = t.replace(/^\/?xl\//, ''); return m; });
  rels.replace(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g, (m, t, id) => { target[id] = target[id] || t.replace(/^\/?xl\//, ''); return m; });
  const sheets = [];
  const colNum = (ref) => { const l = (ref.match(/^[A-Z]+/) || ['A'])[0]; let n = 0; for (const c of l) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
  const list = [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g)];
  const files = list.length ? list.map(([, name, rid]) => [unxml(name), 'xl/' + (target[rid] || '')]) : [['גיליון 1', 'xl/worksheets/sheet1.xml']];
  for (const [name, file] of files.slice(0, 12)) {
    const xml = get(file); if (!xml) continue;
    const rows = []; let truncated = false;
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || []) {
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
      const cells = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = (c.match(/\br="([A-Z]+\d+)"/) || [, 'A1'])[1]; const col = colNum(ref); if (col >= MAX_COLS) continue;
        const t = (c.match(/\bt="(\w+)"/) || [])[1]; const vv = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = shared[Number(vv)] ?? ''; else if (t === 'inlineStr') val = unxml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ''])[1]);
        else if (t === 'b') val = vv === '1' ? 'TRUE' : 'FALSE'; else if (vv !== undefined) val = unxml(vv);
        cells[col] = val;
      }
      rows.push(Array.from({ length: cells.length }, (_, i) => cells[i] ?? ''));
    }
    // מסירים שורות ריקות בסוף
    while (rows.length && rows[rows.length - 1].every(x => x === '')) rows.pop();
    sheets.push({ name, rows, truncated });
  }
  if (!sheets.length) throw new Error('לא נמצאו גיליונות בקובץ');
  return { kind: 'sheet', sheets };
}

function preview(ext, buf) {
  if (ext === 'docx') return docx(buf);
  if (ext === 'xlsx') return xlsx(buf);
  return null;
}
module.exports = { preview, PREVIEW_EXT: ['docx', 'xlsx'] };
