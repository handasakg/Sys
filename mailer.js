'use strict';
// שליחת דוא"ל ללא תלויות חיצוניות, בשתי דרכים:
// • SMTP (שרת הארגון / Brevo בפורט 2525): TLS מלא (465, SMTP_SECURE=1) או STARTTLS. סיסמה לא נשלחת לעולם בחיבור לא מוצפן.
// • Brevo API (HTTPS): כשמוגדר BREVO_API_KEY. עובד גם כש-Render חוסם את פורטי ה-SMTP בשרת החינמי.
// בחירה: MAIL_TRANSPORT=smtp|brevo, ואם לא נקבע – Brevo API כשיש מפתח, אחרת SMTP.
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
function transport() {
  const want = (env.MAIL_TRANSPORT || '').toLowerCase();
  const brevoOk = !!(env.BREVO_API_KEY && env.MAIL_FROM); const smtpOk = !!smtpConfig();
  if (want === 'smtp') return smtpOk ? 'smtp' : null;
  if (want === 'brevo') return brevoOk ? 'brevo' : null;
  return brevoOk ? 'brevo' : smtpOk ? 'smtp' : null;
}
const isConfigured = () => !!transport();
// תיאור ההגדרה (בלי סודות) – למסך ההגדרות
function describe() {
  const t = transport(); const c = smtpConfig();
  return { transport: t, from: env.MAIL_FROM || null, smtp: c ? `${c.host}:${c.port}` : null, brevoKey: !!env.BREVO_API_KEY };
}

const clean = (s) => String(s).replace(/[\r\n]/g, ' ').trim(); // מניעת הזרקת כותרות
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s) => `=?UTF-8?B?${b64(clean(s))}?=`;
const addr = (s) => { const m = clean(s).match(/<([^<>\s]+@[^<>\s]+)>|^([^<>\s]+@[^<>\s]+)$/); if (!m) throw new Error('כתובת דוא"ל לא תקינה'); return m[1] || m[2]; };

// attachments: [{ filename, content: Buffer, contentType }]
function sendSmtp({ to, subject, text, attachments = [] }) {
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
      const wrap76 = (b) => b.toString('base64').replace(/.{1,76}/g, '$&\r\n');
      const head = [`From: ${encHeader(cfg.from.replace(/<.*>/, '').trim() || 'מערכת תיאום הנדסי')} <${from}>`, `To: <${rcpt}>`, `Subject: ${encHeader(subject)}`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${from.split('@')[1]}>`, 'MIME-Version: 1.0'];
      let msg;
      if (!attachments.length) msg = [...head, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(text, 'utf8'))].join('\r\n');
      else {
        const bnd = 'b' + require('node:crypto').randomBytes(12).toString('hex');
        const parts = [`--${bnd}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(text, 'utf8'))];
        for (const a of attachments) {
          const fname = clean(a.filename).replace(/["\\]/g, '_');
          parts.push(`--${bnd}`, `Content-Type: ${clean(a.contentType || 'application/octet-stream')}; name="${encHeader(fname)}"`, 'Content-Transfer-Encoding: base64',
            `Content-Disposition: attachment; filename="${encHeader(fname)}"`, '', wrap76(a.content));
        }
        parts.push(`--${bnd}--`, '');
        msg = [...head, `Content-Type: multipart/mixed; boundary="${bnd}"`, '', ...parts].join('\r\n');
      }
      msg = msg.replace(/^\./gm, '..'); // dot-stuffing
      await cmd(msg + '\r\n.', /^250/);
      sock.write('QUIT\r\n');
      done = true; sock.end(); resolve(true);
    })().catch(fail);
  });
}

// ---------- Brevo API (HTTPS) ----------
const senderOf = (from) => { const email = addr(from); const name = clean(from).replace(/<[^>]*>/, '').replace(/^["']|["']$/g, '').trim(); return name && name !== email ? { email, name } : { email }; };
async function sendBrevo({ to, subject, text, attachments = [] }) {
  const body = { sender: senderOf(env.MAIL_FROM), to: [{ email: addr(to) }], subject: clean(subject), textContent: String(text) };
  if (attachments.length) body.attachment = attachments.map(a => ({ name: clean(a.filename), content: Buffer.from(a.content).toString('base64') }));
  let res;
  try {
    res = await fetch(env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', { method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { throw new Error('Brevo API: אין חיבור לשרת (' + (e.cause && e.cause.code || e.message) + ')'); }
  const txt = await res.text(); let j = {}; try { j = JSON.parse(txt); } catch { /* */ }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Brevo API: המפתח ב-BREVO_API_KEY שגוי (נדרש מפתח API, לא מפתח SMTP)');
    throw new Error(`Brevo API (${res.status}): ${(j.message || txt).slice(0, 200)}`);
  }
  return { transport: 'brevo', id: j.messageId || null };
}

function send(msg) {
  const t = transport();
  if (t === 'brevo') return sendBrevo(msg);
  if (t === 'smtp') return sendSmtp(msg).then(() => ({ transport: 'smtp' }));
  return Promise.reject(new Error('הדוא"ל עדיין לא מוגדר בשרת. ההוראות מופיעות למטה, ב"איך מגדירים?".'));
}
module.exports = { send, isConfigured, describe };
