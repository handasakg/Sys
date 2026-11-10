'use strict';
// שליחת דוא"ל דרך שרת SMTP של הארגון, ללא תלויות חיצוניות.
// תומך ב-TLS מלא (פורט 465, SMTP_SECURE=1) וב-STARTTLS (פורט 587). סיסמת SMTP לא תישלח לעולם בחיבור לא מוצפן.
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');

const env = process.env;
function smtpConfig() {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null;
  return {
    host: env.SMTP_HOST, port: parseInt(env.SMTP_PORT, 10) || (env.SMTP_SECURE === '1' ? 465 : 587),
    secure: env.SMTP_SECURE === '1', user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.MAIL_FROM,
    allowInsecure: env.SMTP_ALLOW_INSECURE === '1', // לבדיקות מקומיות בלבד
    rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== '0',
  };
}
const isConfigured = () => !!smtpConfig();

const clean = (s) => String(s).replace(/[\r\n]/g, ' ').trim(); // מניעת הזרקת כותרות
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s) => `=?UTF-8?B?${b64(clean(s))}?=`;
const addr = (s) => { const m = clean(s).match(/<([^<>\s]+@[^<>\s]+)>|^([^<>\s]+@[^<>\s]+)$/); if (!m) throw new Error('כתובת דוא"ל לא תקינה'); return m[1] || m[2]; };

function send({ to, subject, text }) {
  const cfg = smtpConfig();
  if (!cfg) return Promise.reject(new Error('SMTP לא מוגדר'));
  const rcpt = addr(to); const from = addr(cfg.from);
  return new Promise((resolve, reject) => {
    let sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized }) : net.connect({ host: cfg.host, port: cfg.port });
    let buf = ''; let waiter = null; let done = false; let encrypted = cfg.secure;
    const fail = (e) => { if (done) return; done = true; try { sock.destroy(); } catch { /* */ } reject(e); };
    sock.setTimeout(15000, () => fail(new Error('SMTP timeout')));
    const onData = (d) => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) { const resp = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n'); const w = waiter; waiter = null; if (w) w(resp); return; }
      }
    };
    const attach = (s) => { s.on('data', onData); s.on('error', fail); };
    attach(sock);
    const read = () => new Promise(r => { waiter = r; if (buf.includes('\r\n')) onData(''); });
    const cmd = async (line, expect) => {
      if (line !== null) sock.write(line + '\r\n');
      const resp = await read();
      if (!expect.test(resp)) throw new Error(`SMTP: ${resp.slice(0, 120)}`);
      return resp;
    };
    (async () => {
      await cmd(null, /^220/);
      const me = clean(os.hostname()).replace(/[^\w.-]/g, '') || 'localhost';
      let ehlo = await cmd(`EHLO ${me}`, /^250/);
      if (!encrypted && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', /^220/);
        sock.removeListener('data', onData);
        sock = tls.connect({ socket: sock, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized });
        await new Promise((r, j) => { sock.once('secureConnect', r); sock.once('error', j); });
        attach(sock); encrypted = true;
        ehlo = await cmd(`EHLO ${me}`, /^250/);
      }
      if (!encrypted && !cfg.allowInsecure) throw new Error('שרת ה-SMTP אינו תומך בהצפנה – השליחה בוטלה');
      if (cfg.user) {
        await cmd('AUTH LOGIN', /^334/);
        await cmd(b64(cfg.user), /^334/);
        await cmd(b64(cfg.pass), /^235/);
      }
      await cmd(`MAIL FROM:<${from}>`, /^250/);
      await cmd(`RCPT TO:<${rcpt}>`, /^25[01]/);
      await cmd('DATA', /^354/);
      const body = b64(text).replace(/.{1,76}/g, '$&\r\n');
      const msg = [`From: ${encHeader(cfg.from.replace(/<.*>/, '').trim() || 'מערכת תיאום הנדסי')} <${from}>`, `To: <${rcpt}>`, `Subject: ${encHeader(subject)}`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${from.split('@')[1]}>`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
      await cmd(msg + '\r\n.', /^250/);
      sock.write('QUIT\r\n');
      done = true; sock.end(); resolve(true);
    })().catch(fail);
  });
}

module.exports = { send, isConfigured };
