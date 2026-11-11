'use strict';
// מסד הנתונים: SQLite מובנה ב-Node. כל השאילתות בפרויקט פרמטריות (prepare + ?).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { DEFAULT_ROLES } = require('./permissions');

for (const dir of [config.dataDir, config.uploadDir, config.backupDir, config.logDir]) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

const DB_FILE = path.join(config.dataDir, process.env.DB_FILE || 'app.db');
const db = new DatabaseSync(DB_FILE);
try { fs.chmodSync(DB_FILE, 0o600); } catch { /* windows */ }

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA secure_delete = ON;

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, perms TEXT NOT NULL DEFAULT '[]',
  system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, full_name TEXT NOT NULL,
  email TEXT, phone TEXT, department TEXT, password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id), perm_grant TEXT NOT NULL DEFAULT '[]', perm_deny TEXT NOT NULL DEFAULT '[]',
  infra_body_id INTEGER REFERENCES infra_bodies(id),
  active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
  must_change_pw INTEGER NOT NULL DEFAULT 0, prefs TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, ip TEXT, ua TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_by INTEGER
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS infra_bodies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, code TEXT, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'פעיל',
  manager_id INTEGER REFERENCES users(id), start_date TEXT, end_date TEXT, budget REAL NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS budget_entries (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('planned','actual')), description TEXT NOT NULL, amount REAL NOT NULL,
  entry_date TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, assignee_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'פתוחה', priority TEXT NOT NULL DEFAULT 'רגילה',
  start_date TEXT, due_date TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT, address TEXT, gush TEXT, helka TEXT, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  applicant_id INTEGER NOT NULL REFERENCES users(id), assignee_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft', track TEXT NOT NULL DEFAULT 'regular', track_status TEXT NOT NULL DEFAULT 'none',
  planned_start TEXT, planned_end TEXT, due_at TEXT, submitted_at TEXT, closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS request_approvals (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  infra_body_id INTEGER NOT NULL REFERENCES infra_bodies(id), decision TEXT NOT NULL DEFAULT 'pending',
  comment TEXT, decided_by INTEGER REFERENCES users(id), decided_at TEXT,
  UNIQUE(request_id, infra_body_id)
);
CREATE TABLE IF NOT EXISTS request_history (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER, action TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, category TEXT,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, uploaded_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, username TEXT, action TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info',
  ip TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, link TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_req_applicant ON requests(applicant_id);
CREATE INDEX IF NOT EXISTS idx_req_assignee ON requests(assignee_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
`);

// נתוני בסיס (ללא משתמשים וללא סיסמאות ברירת מחדל)
const roleCount = db.prepare('SELECT COUNT(*) AS c FROM roles').get().c;
if (roleCount === 0) {
  const ins = db.prepare('INSERT INTO roles (name, perms, system) VALUES (?, ?, ?)');
  for (const r of DEFAULT_ROLES) ins.run(r.name, JSON.stringify(r.perms), r.system);
}
const DEFAULT_SETTINGS = {
  'files.allowed_ext': JSON.stringify(['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx', 'dwg', 'dxf', 'zip', 'tif', 'tiff']),
  'files.max_mb': '20',
  'sla.regular_days': '14',
  'sla.fast_days': '3',
  'org.name': 'מינהל הנדסה עיריית קריית גת',
  'org.system_title': 'מערכת תיאום הנדסי',
};
const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSet.run(k, v);

if (db.prepare('SELECT COUNT(*) AS c FROM infra_bodies').get().c === 0) {
  const ins = db.prepare('INSERT INTO infra_bodies (name) VALUES (?)');
  for (const n of ['מים וביוב (תאגיד)', 'חברת החשמל', 'בזק / תקשורת', 'גז', 'תנועה ותחבורה', 'ניקוז', 'גנים ונוף', 'תאורת רחובות']) ins.run(n);
}

// שיוך משתמשים לבקשות (משתמש משויך רואה את הבקשה)
db.exec(`CREATE TABLE IF NOT EXISTS user_requests (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, request_id))`);
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('docs.visibility', 'own')").run();
// סוגי בקשות שמוגדרים מלוח הבקרה (במקום רשימה קבועה בקוד)
db.exec(`CREATE TABLE IF NOT EXISTS request_types (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1, public INTEGER NOT NULL DEFAULT 1,
  handler_ids TEXT NOT NULL DEFAULT '[]', infra_chain TEXT NOT NULL DEFAULT '[]', role_resident INTEGER REFERENCES roles(id), role_entrepreneur INTEGER REFERENCES roles(id),
  sort INTEGER NOT NULL DEFAULT 0)`);
if (db.prepare('SELECT COUNT(*) AS c FROM request_types').get().c === 0) {
  const { TYPES } = require('./workflow'); let i = 0;
  for (const [k, n] of Object.entries(TYPES)) db.prepare('INSERT INTO request_types (key, name, sort) VALUES (?, ?, ?)').run(k, n, i++);
}
db.exec(`CREATE TABLE IF NOT EXISTS request_police (request_id INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE, data TEXT NOT NULL)`);
// תפקידים ציבוריים חדשים גם במסדים קיימים
for (const r of require('./permissions').DEFAULT_ROLES.filter(x => ['תושב/ת', 'יזם'].includes(x.name))) db.prepare('INSERT OR IGNORE INTO roles (name, perms) VALUES (?, ?)').run(r.name, JSON.stringify(r.perms));
// הרחבות סכמה למסדים קיימים
const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
if (!hasCol('sessions', 'remember')) db.exec('ALTER TABLE sessions ADD COLUMN remember INTEGER NOT NULL DEFAULT 0');
for (const [t, c, def] of [['users', 'applicant_kind', 'TEXT'], ['users', 'address', 'TEXT'], ['requests', 'applicant_kind', 'TEXT'], ['requests', 'project_name', 'TEXT'],
  ['request_approvals', 'seq', 'INTEGER NOT NULL DEFAULT 0'], ['request_approvals', 'notified_at', 'TEXT'], ['documents', 'visibility', "TEXT NOT NULL DEFAULT 'default'"],
  ['requests', 'fix_auto_approval', 'INTEGER'], ['requests', 'fix_auto_by', 'INTEGER'],
  ['requests', 'loc_x', 'REAL'], ['requests', 'loc_y', 'REAL'], ['requests', 'loc_z', 'REAL'], ['requests', 'loc_label', 'TEXT'],
  ['requests', 'work_time', 'TEXT'], ['infra_bodies', 'contact_user_id', 'INTEGER'], ['tasks', 'infra_body_id', 'INTEGER']]) {
  if (!hasCol(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
}
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('approval.guidelines', ?)").run(require('./documents').DEFAULT_GUIDELINES);
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('public.apply', '1')").run();
// שם הארגון המלא, ותיאור מסך הכניסה (נערך מהגדרות וקבצים)
db.prepare("UPDATE settings SET value = 'מינהל הנדסה עיריית קריית גת' WHERE key = 'org.name' AND value = 'מינהל הנדסה'").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('login.text', 'בקשות לתיאום תכנון, אישורי ביצוע וגמר עבודה – כל גורמי התשתית במקום אחד, וכל אחד רואה מה ממתין לו.')").run();
db.prepare("UPDATE settings SET value = ? WHERE key = 'login.text' AND value = ?").run('בקשות לתיאום תכנון, אישורי ביצוע וגמר עבודה – כל גורמי התשתית במקום אחד, וכל אחד רואה מה ממתין לו.', 'בקשות לתיאום תכנון, אישורי ביצוע וגמר עבודה – כל גורמי התשתית על אותו מסלול, וכל אחד רואה מה ממתין לו.');
// הוסרו מהמערכת: בקשה חדשה פנימית, פרויקטים, תקציב ולוח זמנים. מנקים את ההרשאות הישנות,
// ושם הפרויקט של בקשות ישנות נשמר כטקסט בבקשה. הטבלאות הישנות נשארות בלי שימוש כדי שלא יימחקו נתונים.
{
  const { KEYS } = require('./permissions');
  const clean = (json) => { const a = JSON.parse(json || '[]'); const b = a.filter(k => KEYS.has(k)); return b.length === a.length ? null : JSON.stringify(b); };
  for (const r of db.prepare('SELECT id, perms FROM roles').all()) { const c = clean(r.perms); if (c) db.prepare('UPDATE roles SET perms = ? WHERE id = ?').run(c, r.id); }
  for (const u of db.prepare('SELECT id, perm_grant, perm_deny FROM users').all()) {
    const g = clean(u.perm_grant); const d = clean(u.perm_deny);
    if (g) db.prepare('UPDATE users SET perm_grant = ? WHERE id = ?').run(g, u.id);
    if (d) db.prepare('UPDATE users SET perm_deny = ? WHERE id = ?').run(d, u.id);
  }
  db.exec("UPDATE requests SET project_name = (SELECT name FROM projects p WHERE p.id = requests.project_id) WHERE project_id IS NOT NULL AND (project_name IS NULL OR project_name = '')");
}
// מטפלים אוטומטיים לסוגי בקשות בוטלו
db.exec("UPDATE request_types SET handler_ids = '[]' WHERE handler_ids != '[]'");
// זמן העבודה מטופס המשטרה עובר גם לבקשה עצמה
db.exec("UPDATE requests SET work_time = (SELECT json_extract(p.data, '$.work_time') FROM request_police p WHERE p.request_id = requests.id) WHERE work_time IS NULL AND EXISTS (SELECT 1 FROM request_police p WHERE p.request_id = requests.id)");
for (const [k, val] of Object.entries({ 'requests.prefix': 'TH', 'requests.with_year': '1', 'requests.pad': '4' })) db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, val);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, tx, getSetting, setSetting, DB_FILE };
