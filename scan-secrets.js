'use strict';
// סריקת סודות: קבצי הפרויקט + כל היסטוריית git (כל הענפים). יוצא עם קוד 1 אם נמצא חשד.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PATTERNS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{60,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe live key', /\b(sk|rk)_live_[A-Za-z0-9]{20,}/],
  ['OpenAI / Anthropic key', /\bsk-(ant-)?[A-Za-z0-9_-]{32,}/],
  ['Firebase / Supabase service key (JWT)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Hard-coded password / secret', /\b(password|passwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
  ['Connection string with password', /\b(postgres|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^:\s/]+:[^@\s]+@/i],
];
// ערכי דוגמה מותרים (placeholder) שאינם סודות
const ALLOW = [/example\.gov\.il/, /scan-secrets\.js/, /AAAAAAAAAAAAAAAAAAAAAA==/];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'data']);
// חריגות שנבדקו ידנית: טביעת אצבע (sha256) של השורה המדויקת + נימוק, בקובץ .secrets-allowlist.
// כך שורה אחרת – גם בקובץ אחר או בשינוי קל – לא "מתחבאת" מאחורי החריגה.
const crypto = require('node:crypto');
const fp = (line) => crypto.createHash('sha256').update(line.trim()).digest('hex');
const ALLOWED_FP = new Set();
try {
  for (const l of fs.readFileSync(path.join(ROOT, '.secrets-allowlist'), 'utf8').split('\n')) { const m = l.match(/^([a-f0-9]{64})\b/); if (m) ALLOWED_FP.add(m[1]); }
} catch { /* אין קובץ חריגות */ }
let allowedHits = 0;

function scanText(text, where, out) {
  text.split('\n').forEach((line, i) => {
    if (ALLOW.some(a => a.test(line))) return;
    if (ALLOWED_FP.has(fp(line)) && PATTERNS.some(([, re]) => re.test(line))) { allowedHits++; return; }
    for (const [name, re] of PATTERNS) if (re.test(line)) out.push({ where: `${where}:${i + 1}`, type: name, line: line.trim().slice(0, 140) });
  });
}
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (fs.statSync(p).size < 2_000_000) scanText(fs.readFileSync(p, 'utf8'), path.relative(ROOT, p), out);
    if (e.name === '.env' || /\.(pem|key|p12|pfx)$/.test(e.name)) out.push({ where: path.relative(ROOT, p), type: 'קובץ סודות בתיקיית הפרויקט', line: '' });
  }
}

const findings = [];
walk(ROOT, findings);
let historyScanned = false; let commits = 0;
try {
  commits = Number(execFileSync('git', ['rev-list', '--all', '--count'], { cwd: ROOT }).toString().trim());
  const log = execFileSync('git', ['log', '-p', '--all', '--no-color', '--format=@@commit %H'], { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 }).toString();
  let commit = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('@@commit ')) { commit = line.slice(9, 17); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (ALLOW.some(a => a.test(line))) continue;
    if (ALLOWED_FP.has(fp(line.slice(1))) && PATTERNS.some(([, re]) => re.test(line))) { allowedHits++; continue; }
    for (const [name, re] of PATTERNS) if (re.test(line)) findings.push({ where: `git ${commit}`, type: name, line: line.slice(1).trim().slice(0, 140) });
  }
  const tracked = execFileSync('git', ['log', '--all', '--name-only', '--format='], { cwd: ROOT }).toString().split('\n').filter(Boolean);
  for (const f of new Set(tracked)) if (/(^|\/)\.env$|\.(pem|key|p12|pfx|sqlite|db)$/.test(f)) findings.push({ where: `git history: ${f}`, type: 'קובץ רגיש נשמר ב-git', line: '' });
  historyScanned = true;
} catch (e) { console.warn('git history not scanned:', e.message); }

console.log(JSON.stringify({ historyScanned, commits, allowlisted: allowedHits, findings }, null, 2));
process.exit(findings.length ? 1 : 0);
