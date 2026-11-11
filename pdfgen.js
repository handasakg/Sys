'use strict';
// מחולל PDF קטן ללא תלויות: גופן TrueType מוטמע (טקסט אמיתי שאפשר לחפש ולהעתיק), עברית מימין לשמאל
// עם מספרים ואנגלית בתוכה, תמונות PNG/JPEG (כולל שקיפות), צורות, עטיפת שורות ומעבר עמודים.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---------------- TrueType ----------------
function parseTTF(buf) {
  const tables = {};
  for (let i = 0, n = buf.readUInt16BE(4); i < n; i++) {
    const o = 12 + i * 16; tables[buf.toString('latin1', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  const head = tables.head.off; const upem = buf.readUInt16BE(head + 18);
  const bbox = [0, 2, 4, 6].map(k => buf.readInt16BE(head + 36 + k));
  const hhea = tables.hhea.off; const ascent = buf.readInt16BE(hhea + 4); const descent = buf.readInt16BE(hhea + 6); const nHM = buf.readUInt16BE(hhea + 34);
  const numGlyphs = buf.readUInt16BE(tables.maxp.off + 4);
  const adv = new Uint16Array(numGlyphs); let last = 0;
  for (let g = 0; g < numGlyphs; g++) { if (g < nHM) last = buf.readUInt16BE(tables.hmtx.off + g * 4); adv[g] = last; }
  let capH = Math.round(ascent * 0.7);
  const os2 = tables['OS/2']; if (os2 && os2.len >= 90 && buf.readUInt16BE(os2.off) >= 2) capH = buf.readInt16BE(os2.off + 88);
  const map = new Map(); const cm = tables.cmap.off; let f4 = null; let f12 = null;
  for (let i = 0, n = buf.readUInt16BE(cm + 2); i < n; i++) {
    const pid = buf.readUInt16BE(cm + 4 + i * 8); const eid = buf.readUInt16BE(cm + 6 + i * 8); const off = cm + buf.readUInt32BE(cm + 8 + i * 8);
    const fmt = buf.readUInt16BE(off);
    if (fmt === 12 && (pid === 3 || pid === 0)) f12 = off;
    if (fmt === 4 && ((pid === 3 && eid === 1) || (pid === 0 && !f4))) f4 = off;
  }
  if (f12) {
    for (let i = 0, ng = buf.readUInt32BE(f12 + 12); i < ng; i++) {
      const o = f12 + 16 + i * 12; const s = buf.readUInt32BE(o); const e = buf.readUInt32BE(o + 4); const g = buf.readUInt32BE(o + 8);
      for (let c = s; c <= e; c++) map.set(c, g + c - s);
    }
  } else if (f4) {
    const segX2 = buf.readUInt16BE(f4 + 6); const ends = f4 + 14; const starts = ends + segX2 + 2; const deltas = starts + segX2; const ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = buf.readUInt16BE(ends + i * 2); const start = buf.readUInt16BE(starts + i * 2); const delta = buf.readInt16BE(deltas + i * 2); const ro = buf.readUInt16BE(ranges + i * 2);
      for (let c = start; c <= end && c !== 0xFFFF; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xFFFF;
        else { g = buf.readUInt16BE(ranges + i * 2 + ro + (c - start) * 2); if (g) g = (g + delta) & 0xFFFF; }
        if (g) map.set(c, g);
      }
    }
  }
  return { buf, upem, bbox, ascent, descent, capH, adv, map };
}

// ---------------- כיווניות (BiDi) מפושטת לפסקה בכיוון ימין-לשמאל ----------------
const isHeb = (c) => (c >= 0x0590 && c <= 0x05FF) || (c >= 0xFB1D && c <= 0xFB4F);
const isDigit = (c) => c >= 48 && c <= 57;
const isLatin = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xC0 && c <= 0x24F);
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };
function visual(str) {
  const ch = [...String(str)]; const n = ch.length;
  const t = ch.map(x => { const c = x.codePointAt(0); return isHeb(c) ? 'R' : (isDigit(c) || isLatin(c)) ? 'L' : 'N'; });
  // מפרידים בתוך מספרים / כתובות (02/11/2026, 050-1234567, a@b.co.il) נשארים חלק מהרצף השמאלי
  for (let i = 1; i < n - 1; i++) if (t[i] === 'N' && /[.,:/\-_@+%]/.test(ch[i]) && t[i - 1] === 'L' && t[i + 1] === 'L') t[i] = 'L';
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'N') continue;
    let j = i; while (j < n && t[j] === 'N') j++;
    const before = i > 0 ? t[i - 1] : 'R'; const after = j < n ? t[j] : 'R';
    const d = before === after ? before : 'R';
    for (let k = i; k < j; k++) t[k] = d;
    i = j - 1;
  }
  const runs = [];
  for (let i = 0; i < n;) { let j = i; while (j < n && t[j] === t[i]) j++; runs.push({ d: t[i], s: ch.slice(i, j) }); i = j; }
  return runs.reverse().map(r => r.d === 'R' ? r.s.reverse().map(x => MIRROR[x] || x).join('') : r.s.join('')).join('');
}

// ---------------- תמונות ----------------
function readPNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let o = 8; let w, h, depth, ctype, inter; const idat = []; let plte = null; let trns = null;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('latin1', o + 4, o + 8); const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; inter = d[12]; }
    else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (inter) return null;
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!chans || (depth !== 8 && !(ctype === 3 && [1, 2, 4].includes(depth)))) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPP = chans * depth; const stride = Math.ceil(w * bitsPP / 8); const bpp = Math.max(1, bitsPP / 8 | 0);
  const out = Buffer.alloc(stride * h); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0; const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  const rgb = Buffer.alloc(w * h * 3); const alpha = Buffer.alloc(w * h, 255); let hasAlpha = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const row = out.subarray(y * stride, (y + 1) * stride);
    if (ctype === 3) {
      const bit = x * depth; const idx = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      rgb[i * 3] = plte[idx * 3]; rgb[i * 3 + 1] = plte[idx * 3 + 1]; rgb[i * 3 + 2] = plte[idx * 3 + 2];
      if (trns && idx < trns.length) { alpha[i] = trns[idx]; if (trns[idx] < 255) hasAlpha = true; }
    } else {
      const p = row.subarray(x * chans, x * chans + chans);
      if (ctype === 0 || ctype === 4) { rgb.fill(p[0], i * 3, i * 3 + 3); if (ctype === 4) { alpha[i] = p[1]; if (p[1] < 255) hasAlpha = true; } }
      else { rgb[i * 3] = p[0]; rgb[i * 3 + 1] = p[1]; rgb[i * 3 + 2] = p[2]; if (ctype === 6) { alpha[i] = p[3]; if (p[3] < 255) hasAlpha = true; } }
    }
  }
  return { kind: 'png', w, h, rgb, alpha: hasAlpha ? alpha : null };
}
function readJPEG(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let o = 2;
  while (o < buf.length) {
    if (buf[o] !== 0xFF) return null;
    const m = buf[o + 1]; const len = buf.readUInt16BE(o + 2);
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { kind: 'jpeg', h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7), comps: buf[o + 9], data: buf };
    o += 2 + len;
  }
  return null;
}

// ---------------- מסמך ----------------
const A4 = { w: 595.28, h: 841.89 };
const rgbOf = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => +v.toFixed(3)).join(' '); };
const fmt = (n) => (Math.round(n * 100) / 100).toString();
function pdfString(s) { // UTF-16BE hex
  const b = Buffer.from('﻿' + s, 'utf16le'); for (let i = 0; i < b.length; i += 2) { const x = b[i]; b[i] = b[i + 1]; b[i + 1] = x; }
  return `<${b.toString('hex')}>`;
}

const FONT_DIR = __dirname;
let FONTS = null;
function fonts() {
  if (!FONTS) FONTS = { regular: parseTTF(fs.readFileSync(path.join(FONT_DIR, 'font-regular.ttf'))), bold: parseTTF(fs.readFileSync(path.join(FONT_DIR, 'font-bold.ttf'))) };
  return FONTS;
}

class Doc {
  constructor({ title = '', author = '' } = {}) {
    this.title = title; this.author = author;
    this.pages = []; this.used = { regular: new Map(), bold: new Map() }; this.images = [];
    this.f = fonts(); this.page();
  }
  page() { this.cur = { ops: [] }; this.pages.push(this.cur); return this; }
  get W() { return A4.w; } get H() { return A4.h; }
  op(s) { this.cur.ops.push(s); }
  // מידות
  width(str, size = 10, bold = false) {
    const f = bold ? this.f.bold : this.f.regular; let w = 0;
    for (const ch of String(str)) { const g = f.map.get(ch.codePointAt(0)) || 0; w += f.adv[g]; }
    return w * size / f.upem;
  }
  wrap(str, size, bold, maxW) {
    const out = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      const words = para.split(/(\s+)/).filter(x => x.length); let line = '';
      for (const w of words) {
        const test = line + w;
        if (this.width(test.trimEnd(), size, bold) <= maxW || !line.trim()) {
          if (!line.trim() && this.width(w, size, bold) > maxW) { // מילה ארוכה במיוחד: שבירה לפי תווים
            let part = ''; for (const c of w) { if (this.width(part + c, size, bold) > maxW) { out.push(part); part = ''; } part += c; } line = part;
          } else line = test;
        } else { out.push(line.trim()); line = /^\s+$/.test(w) ? '' : w; }
      }
      out.push(line.trim());
    }
    return out;
  }
  // ציור טקסט. y = קו הבסיס, נמדד מראש העמוד. align ביחס ל-x: right = הקצה הימני של הטקסט ב-x
  text(str, x, y, { size = 10, bold = false, color = '#17252A', align = 'right' } = {}) {
    str = String(str ?? ''); if (!str) return 0;
    const key = bold ? 'bold' : 'regular'; const f = this.f[key]; const vis = visual(str);
    let hex = '';
    for (const ch of vis) { const cp = ch.codePointAt(0); const g = f.map.get(cp) || 0; this.used[key].set(g, ch); hex += g.toString(16).padStart(4, '0'); }
    const w = this.width(str, size, bold);
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.op(`BT /${bold ? 'F2' : 'F1'} ${fmt(size)} Tf ${rgbOf(color)} rg ${fmt(x0)} ${fmt(this.H - y)} Td <${hex}> Tj ET`);
    return w;
  }
  // פסקה עטופה, מיושרת לימין. מחזיר את ה-y שאחריה
  para(str, xRight, y, maxW, { size = 10, bold = false, color = '#17252A', lead = 1.45 } = {}) {
    for (const line of this.wrap(str, size, bold, maxW)) { this.text(line, xRight, y, { size, bold, color }); y += size * lead; }
    return y;
  }
  rect(x, y, w, h, { fill = null, stroke = null, lw = 1, r = 0 } = {}) {
    const Y = this.H - y - h; let p;
    if (r > 0) {
      r = Math.min(r, w / 2, h / 2); const k = 0.5523 * r;
      p = `${fmt(x + r)} ${fmt(Y)} m ${fmt(x + w - r)} ${fmt(Y)} l ${fmt(x + w - r + k)} ${fmt(Y)} ${fmt(x + w)} ${fmt(Y + r - k)} ${fmt(x + w)} ${fmt(Y + r)} c ` +
        `${fmt(x + w)} ${fmt(Y + h - r)} l ${fmt(x + w)} ${fmt(Y + h - r + k)} ${fmt(x + w - r + k)} ${fmt(Y + h)} ${fmt(x + w - r)} ${fmt(Y + h)} c ` +
        `${fmt(x + r)} ${fmt(Y + h)} l ${fmt(x + r - k)} ${fmt(Y + h)} ${fmt(x)} ${fmt(Y + h - r + k)} ${fmt(x)} ${fmt(Y + h - r)} c ` +
        `${fmt(x)} ${fmt(Y + r)} l ${fmt(x)} ${fmt(Y + r - k)} ${fmt(x + r - k)} ${fmt(Y)} ${fmt(x + r)} ${fmt(Y)} c h`;
    } else p = `${fmt(x)} ${fmt(Y)} ${fmt(w)} ${fmt(h)} re`;
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.op(`q ${fill ? rgbOf(fill) + ' rg ' : ''}${stroke ? rgbOf(stroke) + ' RG ' + fmt(lw) + ' w ' : ''}${p} ${paint} Q`);
  }
  line(x1, y1, x2, y2, { color = '#C9D6E3', lw = 1, dash = null } = {}) {
    this.op(`q ${rgbOf(color)} RG ${fmt(lw)} w ${dash ? `[${dash.join(' ')}] 0 d ` : ''}${fmt(x1)} ${fmt(this.H - y1)} m ${fmt(x2)} ${fmt(this.H - y2)} l S Q`);
  }
  circle(cx, cy, r, { fill = null, stroke = null, lw = 1 } = {}) {
    const k = 0.5523 * r; const Y = this.H - cy;
    const p = `${fmt(cx + r)} ${fmt(Y)} m ${fmt(cx + r)} ${fmt(Y + k)} ${fmt(cx + k)} ${fmt(Y + r)} ${fmt(cx)} ${fmt(Y + r)} c ${fmt(cx - k)} ${fmt(Y + r)} ${fmt(cx - r)} ${fmt(Y + k)} ${fmt(cx - r)} ${fmt(Y)} c ` +
      `${fmt(cx - r)} ${fmt(Y - k)} ${fmt(cx - k)} ${fmt(Y - r)} ${fmt(cx)} ${fmt(Y - r)} c ${fmt(cx + k)} ${fmt(Y - r)} ${fmt(cx + r)} ${fmt(Y - k)} ${fmt(cx + r)} ${fmt(Y)} c h`;
    this.op(`q ${fill ? rgbOf(fill) + ' rg ' : ''}${stroke ? rgbOf(stroke) + ' RG ' + fmt(lw) + ' w ' : ''}${p} ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`);
  }
  // תמונה: מחזיר {w,h} שצוירו בפועל (שומר יחס), או null אם הפורמט לא נתמך
  image(buf, x, y, maxW, maxH, { align = 'right' } = {}) {
    let img; try { img = readPNG(buf) || readJPEG(buf); } catch { img = null; }
    if (!img) return null;
    const s = Math.min(maxW / img.w, maxH / img.h); const w = img.w * s; const h = img.h * s;
    const x0 = align === 'right' ? x + maxW - w : align === 'center' ? x + (maxW - w) / 2 : x;
    const name = 'Im' + (this.images.length + 1); this.images.push({ name, img });
    this.op(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x0)} ${fmt(this.H - y - h)} cm /${name} Do Q`);
    return { w, h, x: x0 };
  }

  // ---------- כתיבת הקובץ ----------
  toBuffer() {
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    const reserve = () => { objs.push(null); return objs.length; };
    const stream = (dict, data, compress = true) => {
      const body = compress ? zlib.deflateSync(data, { level: 9 }) : data;
      return { head: `<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>`, body };
    };
    const catalog = reserve(); const pagesId = reserve();
    // גופנים
    const fontRefs = {};
    for (const [key, res] of [['regular', 'F1'], ['bold', 'F2']]) {
      const used = this.used[key]; if (!used.size) continue;
      const f = this.f[key]; const base = key === 'bold' ? 'HandasaSans-Bold' : 'HandasaSans-Regular';
      const s1000 = (v) => Math.round(v * 1000 / f.upem);
      const ff = add(stream(`/Length1 ${f.buf.length}`, f.buf));
      const fd = add(`<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${f.bbox.map(s1000).join(' ')}] /ItalicAngle 0 /Ascent ${s1000(f.ascent)} /Descent ${s1000(f.descent)} /CapHeight ${s1000(f.capH)} /StemV ${key === 'bold' ? 120 : 80} /FontFile2 ${ff} 0 R >>`);
      const gids = [...used.keys()].sort((a, b) => a - b);
      const W = gids.map(g => `${g} [${s1000(f.adv[g])}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /W [${W}] /CIDToGIDMap /Identity >>`);
      const hex4 = (n) => n.toString(16).padStart(4, '0');
      const u16 = (ch) => { const b = Buffer.from(ch, 'utf16le'); let o = ''; for (let i = 0; i < b.length; i += 2) o += hex4(b.readUInt16LE(i)); return o; };
      let bf = ''; for (let i = 0; i < gids.length; i += 100) { const chunk = gids.slice(i, i + 100); bf += `${chunk.length} beginbfchar\n${chunk.map(g => `<${hex4(g)}> <${u16(used.get(g))}>`).join('\n')}\nendbfchar\n`; }
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${bf}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const tu = add(stream('', Buffer.from(cmap, 'latin1')));
      fontRefs[res] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
    }
    // תמונות
    const imgRefs = {};
    for (const { name, img } of this.images) {
      if (img.kind === 'jpeg') imgRefs[name] = add(stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.comps === 1 ? 'DeviceGray' : img.comps === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, img.data, false));
      else {
        const smask = img.alpha ? add(stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8`, img.alpha)) : null;
        imgRefs[name] = add(stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask ? ` /SMask ${smask} 0 R` : ''}`, img.rgb));
      }
    }
    const resources = `<< /Font << ${Object.entries(fontRefs).map(([k, v]) => `/${k} ${v} 0 R`).join(' ')} >>${Object.keys(imgRefs).length ? ` /XObject << ${Object.entries(imgRefs).map(([k, v]) => `/${k} ${v} 0 R`).join(' ')} >>` : ''} >>`;
    const kids = [];
    for (const p of this.pages) {
      const c = add(stream('', Buffer.from(p.ops.join('\n'), 'latin1')));
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources ${resources} /Contents ${c} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (he-IL) /ViewerPreferences << /Direction /R2L /DisplayDocTitle true >> >>`;
    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const info = add(`<< /Title ${pdfString(this.title)} /Author ${pdfString(this.author)} /Producer (Handasa Coordination) /CreationDate (D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z) >>`);
    // הרכבה + טבלת הפניות
    const parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')]; let offset = parts[0].length; const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(offset);
      const chunk = typeof o === 'string' ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
        : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.head}\nstream\n`, 'latin1'), o.body, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      parts.push(chunk); offset += chunk.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

module.exports = { Doc, visual, readPNG, readJPEG };
