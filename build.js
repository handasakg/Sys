'use strict';
// בניית קבצי פרודקשן מוקטנים: app.min.js + app.min.css (esbuild – כלי פיתוח בלבד, לא נדרש בשרת).
// השרת משתמש בגרסה המוקטנת אוטומטית כשהיא קיימת, ומוסיף לה גרסה (hash) למטמון ארוך.
const fs = require('node:fs');
const path = require('node:path');

function loadEsbuild() {
  for (const p of [process.env.ESBUILD_PATH, 'esbuild', '/opt/npm-tools/node_modules/esbuild'].filter(Boolean)) {
    try { return require(p); } catch { /* הבא */ }
  }
  console.error('esbuild לא נמצא. התקינו: npm install --save-dev esbuild'); process.exit(1);
}
const esbuild = loadEsbuild();
const pub = __dirname;
for (const [src, dst, loader] of [['app.js', 'app.min.js', 'js'], ['app.css', 'app.min.css', 'css']]) {
  const code = fs.readFileSync(path.join(pub, src), 'utf8');
  const r = esbuild.transformSync(code, { loader, minify: true, target: loader === 'js' ? 'es2020' : 'chrome100', charset: 'utf8', legalComments: 'none' });
  fs.writeFileSync(path.join(pub, dst), r.code);
  console.log(`${src}: ${(code.length / 1024).toFixed(1)}KB → ${dst}: ${(r.code.length / 1024).toFixed(1)}KB`);
}
