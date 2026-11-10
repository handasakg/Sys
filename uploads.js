'use strict';
// העלאת קבצים: הגבלת גודל, רשימת סיומות מותרות (נשלטת מלוח הבקרה), בדיקת חתימת תוכן (magic bytes),
// שמירה בשם אקראי מחוץ לתיקייה הציבורית והורדה רק דרך נתיב מאומת.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { getSetting } = require('./db');
const { HttpError } = require('./security');

// סיומות שלעולם לא יאושרו, גם אם מנהל ינסה להוסיף אותן (הרצת קוד / XSS)
const FORBIDDEN_EXT = new Set(['html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'js', 'mjs', 'cjs', 'exe', 'msi', 'dll', 'bat', 'cmd',
  'com', 'scr', 'pif', 'hta', 'sh', 'bash', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'jar', 'php', 'phtml', 'php5', 'asp', 'aspx', 'jsp',
  'cgi', 'pl', 'py', 'rb', 'swf', 'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'lnk', 'reg', 'iso', 'apk', 'appx', 'htaccess']);

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  tif: 'image/tiff', tiff: 'image/tiff', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword',
  xls: 'application/vnd.ms-excel', zip: 'application/zip', dwg: 'application/acad', dxf: 'application/dxf',
  txt: 'text/plain', csv: 'text/csv', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', kml: 'application/vnd.google-earth.kml+xml',
};

const starts = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
const ascii = (buf, s) => buf.slice(0, s.length).toString('latin1') === s;
function looksText(buf) { return !buf.subarray(0, 8192).includes(0); }
function looksDangerous(buf) {
  const head = buf.subarray(0, 512).toString('latin1').toLowerCase().trimStart();
  return starts(buf, [0x4d, 0x5a]) /* MZ exe */ || starts(buf, [0x7f, 0x45, 0x4c, 0x46]) /* ELF */ ||
    /^<(!doctype|html|script|svg|\?xml|iframe|body)/.test(head) || head.startsWith('#!');
}

// בדיקת חתימה לפי סיומת. סיומת שאין לה חתימה ידועה עוברת רק אם אינה נראית כקובץ הרצה / HTML.
const SIGNATURES = {
  pdf: b => ascii(b, '%PDF-'),
  png: b => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: b => starts(b, [0xff, 0xd8, 0xff]), jpeg: b => starts(b, [0xff, 0xd8, 0xff]),
  gif: b => ascii(b, 'GIF87a') || ascii(b, 'GIF89a'),
  webp: b => ascii(b, 'RIFF') && b.slice(8, 12).toString('latin1') === 'WEBP',
  tif: b => starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a]),
  tiff: b => starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a]),
  zip: b => starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06]),
  docx: b => starts(b, [0x50, 0x4b, 0x03, 0x04]), xlsx: b => starts(b, [0x50, 0x4b, 0x03, 0x04]),
  pptx: b => starts(b, [0x50, 0x4b, 0x03, 0x04]), odt: b => starts(b, [0x50, 0x4b, 0x03, 0x04]), ods: b => starts(b, [0x50, 0x4b, 0x03, 0x04]),
  doc: b => starts(b, [0xd0, 0xcf, 0x11, 0xe0]), xls: b => starts(b, [0xd0, 0xcf, 0x11, 0xe0]),
  dwg: b => ascii(b, 'AC10'),
  dxf: b => looksText(b), txt: b => looksText(b), csv: b => looksText(b),
  rar: b => ascii(b, 'Rar!'), '7z': b => starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
};

function allowedExt() {
  try { return JSON.parse(getSetting('files.allowed_ext') || '[]').filter(e => !FORBIDDEN_EXT.has(e)); } catch { return []; }
}
function maxBytes() {
  const mb = Math.min(Math.max(parseInt(getSetting('files.max_mb'), 10) || 20, 1), config.hardMaxUploadMb);
  return mb * 1024 * 1024;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > limit) { req.resume(); return reject(new HttpError(413, 'הקובץ גדול מהמותר')); }
    const chunks = []; let size = 0; let done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; req.destroy(); return reject(new HttpError(413, 'הקובץ גדול מהמותר')); }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}

// מפענח multipart/form-data פשוט (קובץ אחד + שדות טקסט)
async function parseMultipart(req) {
  const ct = String(req.headers['content-type'] || '');
  const m = ct.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i);
  if (!m) throw new HttpError(400, 'פורמט העלאה לא תקין');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const body = await readBody(req, maxBytes() + 64 * 1024);
  const fields = {}; let file = null;
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const next = body.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    const part = body.subarray(pos + boundary.length + 2, next - 2); // \r\n ... \r\n
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8');
      const data = part.subarray(sep + 4);
      const name = (head.match(/name="([^"]{1,100})"/) || [])[1];
      const filename = (head.match(/filename="([^"]{0,255})"/) || [])[1];
      if (filename !== undefined) {
        if (file) throw new HttpError(400, 'ניתן להעלות קובץ אחד בכל פעם');
        file = { filename, data };
      } else if (name) fields[name] = data.toString('utf8').slice(0, 2000);
    }
    pos = next;
  }
  if (!file || !file.filename) throw new HttpError(400, 'לא נבחר קובץ');
  return { fields, file };
}

function safeOriginalName(name) {
  const base = path.basename(String(name).replace(/\\/g, '/')).normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‪-‮⁦-⁩]/g, '_').trim();
  return (base || 'file').slice(0, 180);
}

async function handleUpload(req) {
  const { fields, file } = await parseMultipart(req);
  const original = safeOriginalName(file.filename);
  const parts = original.toLowerCase().split('.');
  const ext = parts.length > 1 ? parts.pop() : '';
  // חסימת סיומת כפולה מסוכנת (למשל plan.php.pdf)
  if (parts.slice(1).some(p => FORBIDDEN_EXT.has(p))) throw new HttpError(415, 'שם קובץ עם סיומת כפולה אסורה');
  if (!ext || FORBIDDEN_EXT.has(ext) || !allowedExt().includes(ext)) throw new HttpError(415, `סוג קובץ לא מורשה (.${ext || '?'})`);
  if (file.data.length === 0) throw new HttpError(400, 'הקובץ ריק');
  if (file.data.length > maxBytes()) throw new HttpError(413, 'הקובץ גדול מהמותר');
  const sig = SIGNATURES[ext];
  if (looksDangerous(file.data) || (sig && !sig(file.data))) throw new HttpError(415, 'תוכן הקובץ אינו תואם לסוג הקובץ');
  const stored = crypto.randomBytes(24).toString('hex');
  const sha = crypto.createHash('sha256').update(file.data).digest('hex');
  fs.writeFileSync(path.join(config.uploadDir, stored), file.data, { mode: 0o600, flag: 'wx' });
  return { fields, original, stored, size: file.data.length, sha256: sha, mime: MIME[ext] || 'application/octet-stream', ext };
}

function storedPath(stored) {
  if (!/^[a-f0-9]{48}$/.test(stored)) throw new HttpError(400, 'קובץ לא תקין');
  return path.join(config.uploadDir, stored);
}

module.exports = { handleUpload, storedPath, allowedExt, maxBytes, FORBIDDEN_EXT, MIME, readBody };
