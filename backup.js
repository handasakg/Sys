'use strict';
// גיבוי אוטומטי מסביב לשעון: עותק עקבי של מסד הנתונים + סנכרון קבצים מצורפים לתיקיית הגיבוי.
// לגיבוי בענן מחוץ לשרת: יש להגדיר BACKUP_DIR לתיקייה מסונכרנת / דיסק ענן מעוגן (ראו README).
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('node:sqlite');
const config = require('./config');
const { db } = require('./db');

let lastBackup = null; let lastError = null; let running = false;

async function runBackup(reason = 'auto') {
  if (running) return { skipped: true };
  running = true;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(config.backupDir, `db-${stamp}.sqlite`);
    await sqlite.backup(db, target);
    fs.chmodSync(target, 0o600);
    // קבצים מצורפים: מעתיקים רק קבצים חדשים (שמות אקראיים ולא משתנים)
    const filesDir = path.join(config.backupDir, 'uploads');
    fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
    let copied = 0;
    for (const f of fs.readdirSync(config.uploadDir)) {
      const dst = path.join(filesDir, f);
      if (!fs.existsSync(dst)) { fs.copyFileSync(path.join(config.uploadDir, f), dst); fs.chmodSync(dst, 0o600); copied++; }
    }
    // שמירה לפי מדיניות ימים
    const cutoff = Date.now() - config.backupRetentionDays * 86400000;
    for (const f of fs.readdirSync(config.backupDir)) {
      if (!/^db-.*\.sqlite$/.test(f)) continue;
      const p = path.join(config.backupDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
    lastBackup = { at: new Date().toISOString(), file: path.basename(target), size: fs.statSync(target).size, files: copied, reason };
    lastError = null;
    return lastBackup;
  } catch (e) {
    lastError = { at: new Date().toISOString(), message: e.message };
    console.error('[backup] failed:', e.message);
    throw e;
  } finally { running = false; }
}

function listBackups() {
  return fs.readdirSync(config.backupDir).filter(f => /^db-.*\.sqlite$/.test(f)).sort().reverse()
    .map(f => ({ file: f, size: fs.statSync(path.join(config.backupDir, f)).size, at: fs.statSync(path.join(config.backupDir, f)).mtime.toISOString() }));
}

function startScheduler() {
  const ms = Math.max(config.backupIntervalMinutes, 5) * 60000;
  setTimeout(() => runBackup('startup').catch(() => {}), 5000).unref();
  setInterval(() => runBackup('auto').catch(() => {}), ms).unref();
}

module.exports = { runBackup, listBackups, startScheduler, status: () => ({ lastBackup, lastError, intervalMinutes: config.backupIntervalMinutes, retentionDays: config.backupRetentionDays }) };
