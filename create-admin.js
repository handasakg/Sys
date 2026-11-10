'use strict';
// יצירת מנהל מערכת ראשון. אין משתמש/סיסמת ברירת מחדל בקוד.
// שימוש:  node create-admin.js            (שואל שם משתמש, שם מלא וסיסמה)
// או:      ADMIN_USERNAME=... ADMIN_FULLNAME=... ADMIN_PASSWORD=... node create-admin.js
const readline = require('node:readline');
const { db } = require('./db');
const sec = require('./security');

function ask(q, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

(async () => {
  const username = process.env.ADMIN_USERNAME || await ask('שם משתמש למנהל: ');
  const fullName = process.env.ADMIN_FULLNAME || await ask('שם מלא: ');
  const password = process.env.ADMIN_PASSWORD || await ask('סיסמה (12+ תווים, אותיות וספרות): ', true);
  if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) { console.error('שם משתמש לא תקין'); process.exit(1); }
  const probs = sec.passwordProblems(password, username);
  if (probs.length) { console.error('סיסמה חלשה: ' + probs.join(', ')); process.exit(1); }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) { console.error('המשתמש כבר קיים'); process.exit(1); }
  const role = db.prepare('SELECT id FROM roles WHERE system = 1').get();
  db.prepare('INSERT INTO users (username, full_name, password_hash, role_id) VALUES (?, ?, ?, ?)')
    .run(username, fullName || username, await sec.hashPassword(password), role.id);
  console.log(`נוצר מנהל מערכת: ${username}`);
  process.exit(0);
})();
