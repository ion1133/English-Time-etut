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

/**
 * VatanSMS wants a bare 10-digit mobile number: 5XXXXXXXXX.
 * No country code, no leading zero.
 */
function localTR(input) {
  let n = String(input || '').replace(/\D/g, '');
  if (n.startsWith('90')) n = n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  return n;
}

/** Turkish mobile numbers, normalised to 90XXXXXXXXXX (Netgsm format). */
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

  const provider = settings.sms_provider;

  const netgsmReady = provider === 'netgsm' &&
    settings.netgsm_usercode && settings.netgsm_password && settings.netgsm_header;

  const vatanReady = provider === 'vatansms' &&
    settings.vatan_api_id && settings.vatan_api_key && settings.vatan_sender;

  if (!netgsmReady && !vatanReady) {
    await log(recipient, body, 'logged',
      `Test modu — gonderilmedi (${smsParts(body)} SMS olacakti)`);
    return { ok: true, mode: 'log', parts: smsParts(body) };
  }

  if (vatanReady) return sendViaVatan(settings, recipient, body);

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

/**
 * VatanSMS — a plain JSON REST call.
 *
 * Chosen as the easier alternative to Netgsm, whose signup requires
 * uploading documents, an e-Devlet approval AND a wet-signed form sent
 * by cargo. VatanSMS activates the same day from a web form.
 *
 * The sender header still needs BTK approval — that is regulation, not a
 * provider choice, and no Turkish provider can waive it.
 */
async function sendViaVatan(settings, recipient90, body) {
  const phone = localTR(recipient90);

  try {
    const res = await fetch('https://api.vatansms.net/api/v1/1toN', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_id: settings.vatan_api_id,
        api_key: settings.vatan_api_key,
        sender: settings.vatan_sender,
        // 'normal' keeps the 160-character GSM alphabet. Messages are
        // already stripped of Turkish characters, so 'turkce' would
        // halve the limit for no benefit.
        message_type: 'normal',
        // 'bilgi' marks these as informational rather than marketing.
        // A booking confirmation is not a commercial message, so it does
        // not need IYS consent — sending it as 'ticari' would wrongly
        // require one and could get the message blocked.
        message_content_type: 'bilgi',
        message: body,
        phones: [phone],
      }),
    });

    const data = await res.json().catch(() => ({}));
    const ok = res.ok && (data.status === true || data.status === 'success' || !!data.report_id);
    const detail = ok
      ? `${smsParts(body)} SMS · rapor: ${data.report_id ?? '-'}`
      : (data.message || data.error || `HTTP ${res.status}`);

    await log(recipient90, body, ok ? 'sent' : 'failed', detail);
    return { ok, mode: 'vatansms', detail, parts: smsParts(body) };
  } catch (e) {
    await log(recipient90, body, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendSMS, normalizeTR, localTR, toGsm, smsParts };
