'use strict';
// טעינת משתני סביבה מקובץ .env (ללא תלות חיצונית). הקובץ עצמו לעולם לא נשמר ב-git.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname; // כל הקבצים בתיקייה אחת

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function int(name, def) {
  const n = parseInt(env[name], 10);
  return Number.isFinite(n) ? n : def;
}

const config = Object.freeze({
  ROOT,
  isProd,
  port: int('PORT', 3000),
  host: env.HOST || '127.0.0.1',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${int('PORT', 3000)}`).replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY === '1',
  forceHttps: isProd ? env.FORCE_HTTPS !== '0' : env.FORCE_HTTPS === '1',
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  uploadDir: path.resolve(ROOT, env.UPLOAD_DIR || 'data/uploads'),
  backupDir: path.resolve(ROOT, env.BACKUP_DIR || 'data/backups'),
  logDir: path.resolve(ROOT, env.LOG_DIR || 'data/logs'),
  backupIntervalMinutes: int('BACKUP_INTERVAL_MINUTES', 60),
  backupRetentionDays: int('BACKUP_RETENTION_DAYS', 30),
  sessionIdleMinutes: int('SESSION_IDLE_MINUTES', 30),
  sessionAbsoluteHours: int('SESSION_ABSOLUTE_HOURS', 8),
  resetTokenMinutes: int('RESET_TOKEN_MINUTES', 30),
  maxBodyBytes: 1024 * 1024, // JSON
  hardMaxUploadMb: 50,      // תקרה קשיחה שלא ניתן לעקוף מלוח הבקרה
});

module.exports = config;
