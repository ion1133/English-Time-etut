/**
 * messaging.js — SMS only, via Netgsm.
 *
 * WhatsApp was removed deliberately. Meta's Cloud API forbids sending
 * free text to anyone who has not messaged your business number in the
 * last 24 hours, which makes it useless for notifying teachers who never
 * write to the school. Working around it needs a registered SIM plus a
 * template approved by Meta for every message type — days of setup for
 * something SMS does immediately.
 *
 * MESSAGES ARE WRITTEN WITHOUT TURKISH CHARACTERS. An SMS holds 160
 * plain characters but only 70 if it contains ğ ş ı İ ç ö ü, so a single
 * Turkish message often bills as three. "etudunuz" instead of "etüdünüz"
 * is less pretty and roughly a third of the cost, which matters when
 * every booking sends two messages.
 */
const db = require('./db');

/** Turkish mobile numbers, normalised to 90XXXXXXXXXX. */
function normalizeTR(input) {
  let n = String(input || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  if (!n.startsWith('90')) n = '90' + n;
  return n;
}

/**
 * Strips Turkish characters so a message stays in the 160-character GSM
 * alphabet. Applied to every outgoing SMS, so a coordinator who types
 * Turkish into a template does not silently triple the cost.
 */
function toGsm(text) {
  const map = {
    'ğ': 'g', 'Ğ': 'G', 'ü': 'u', 'Ü': 'U', 'ş': 's', 'Ş': 'S',
    'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C',
    'â': 'a', 'Â': 'A', 'î': 'i', 'û': 'u',
    '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
    '\u2013': '-', '\u2014': '-', '\u2026': '...',
  };
  return String(text || '').replace(/[^\x00-\x7F]/g, (ch) => map[ch] ?? '');
}

/** How many SMS a message will actually bill as. Shown in the log. */
function smsParts(text) {
  const len = String(text || '').length;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

async function log(recipient, body, status, detail) {
  try {
    await db.q(
      'INSERT INTO messages (channel, recipient, body, status, detail) VALUES ($1,$2,$3,$4,$5)',
      ['sms', recipient, body, status, String(detail || '')]
    );
  } catch (e) {
    console.error('Could not log message:', e.message);
  }
}

/**
 * Sends one SMS.
 *
 * Never throws. A failed notification must not roll back a booking that
 * the student has already been told is confirmed — the failure is logged
 * and visible in the Mesajlar tab instead.
 */
async function sendSMS(settings, to, rawBody) {
  const recipient = normalizeTR(to);
  const body = toGsm(rawBody);

  if (!recipient || recipient.length < 12) {
    await log(recipient || '(bos)', body, 'failed', 'Gecersiz telefon numarasi');
    return { ok: false, error: 'invalid number' };
  }

  const ready =
    settings.sms_provider === 'netgsm' &&
    settings.netgsm_usercode &&
    settings.netgsm_password &&
    settings.netgsm_header;

  if (!ready) {
    await log(recipient, body, 'logged',
      `Test modu — gonderilmedi (${smsParts(body)} SMS olacakti)`);
    return { ok: true, mode: 'log', parts: smsParts(body) };
  }

  try {
    // Netgsm's REST endpoint. Form-encoded, and it answers with a plain
    // text code rather than JSON.
    const params = new URLSearchParams({
      usercode: settings.netgsm_usercode,
      password: settings.netgsm_password,
      gsmno: recipient,
      message: body,
      msgheader: settings.netgsm_header,
      dil: 'TR',
    });

    const res = await fetch('https://api.netgsm.com.tr/sms/send/get/?' + params.toString(), {
      method: 'GET',
    });
    const text = (await res.text()).trim();
    const code = text.split(' ')[0];

    // Netgsm replies "00 <messageid>" or "01 <messageid>" on success;
    // anything else is an error code that needs translating.
    const ok = code === '00' || code === '01' || code === '02';

    await log(recipient, body, ok ? 'sent' : 'failed',
      ok ? `${smsParts(body)} SMS · ${text}` : netgsmError(code, text));

    return { ok, mode: 'netgsm', detail: ok ? text : netgsmError(code, text), parts: smsParts(body) };
  } catch (e) {
    await log(recipient, body, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

/** Netgsm returns bare numbers. These are the ones that actually occur. */
function netgsmError(code, raw) {
  const errors = {
    '20': 'Mesaj metni cok uzun veya karakter hatasi',
    '30': 'Kullanici adi veya sifre hatali, ya da API erisimi kapali',
    '40': 'Gonderici adi (baslik) sistemde tanimli degil',
    '50': 'Aboneligi olmayan numara',
    '51': 'Aboneligi olmayan numara',
    '70': 'Hatali sorgulama - parametreleri kontrol edin',
    '80': 'Gonderim sinir asimi',
    '85': 'Ayni numaraya cok fazla gonderim',
    '100': 'Bakiye yetersiz',
  };
  return errors[code] ? `${code}: ${errors[code]}` : `Netgsm yaniti: ${raw}`;
}

module.exports = { sendSMS, normalizeTR, toGsm, smsParts };
