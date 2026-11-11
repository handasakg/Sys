'use strict';
// נקודת ההפעלה: קודם משחזרים את המסד מהענן (אם הוגדר), ורק אז פותחים אותו ומפעילים את השרת.
const path = require('node:path');
const config = require('./config');
const cloud = require('./cloudsync');

(async () => {
  if (cloud.enabled) {
    const dbFile = path.join(config.dataDir, process.env.DB_FILE || 'app.db');
    const r = await cloud.restoreDb(dbFile);
    console.log(r.status === 'restored' ? `שוחזר מהענן (${Math.round(r.size / 1024)}KB)` : r.status === 'empty' ? 'אין עדיין עותק בענן – מתחילים מסד חדש' : `שחזור מהענן נכשל: ${r.message}`);
  }
  require('./server').start();
})();
