// Messaging: SMS via Netgsm, WhatsApp via Meta Cloud API. Falls back to "log" mode
// (message is stored and visible in the admin panel) until credentials are entered.
const { q } = require('./db');

function normalizeTR(phone) {
  // Accepts 05XX XXX XX XX / 5XXXXXXXXX / +905XXXXXXXXX -> returns 905XXXXXXXXX
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('90')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return '90' + d;
}

async function log(channel, recipient, body, status, detail = '') {
  await q('INSERT INTO messages (channel,recipient,body,status,detail) VALUES ($1,$2,$3,$4,$5)',
    [channel, recipient, body, status, String(detail).slice(0, 500)]);
}

async function sendSMS(settings, to, body) {
  const recipient = normalizeTR(to);
  if (settings.sms_provider !== 'netgsm' || !settings.netgsm_usercode) {
    await log('sms', recipient, body, 'logged', 'Test mode: SMS provider not configured');
    return { ok: true, mode: 'log' };
  }
  try {
    // Netgsm HTTP API (GET) - https://www.netgsm.com.tr/dokuman/
    const url = new URL('https://api.netgsm.com.tr/sms/send/get');
    url.searchParams.set('usercode', settings.netgsm_usercode);
    url.searchParams.set('password', settings.netgsm_password);
    url.searchParams.set('gsmno', recipient);
    url.searchParams.set('message', body);
    url.searchParams.set('msgheader', settings.netgsm_header);
    url.searchParams.set('dil', 'TR');
    const res = await fetch(url);
    const text = (await res.text()).trim();
    const ok = /^0[0-2]\s/.test(text) || /^0[0-2]$/.test(text.split(' ')[0]);
    await log('sms', recipient, body, ok ? 'sent' : 'failed', 'Netgsm: ' + text);
    return { ok, mode: 'netgsm', detail: text };
  } catch (e) {
    await log('sms', recipient, body, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendWhatsApp(settings, to, body) {
  const recipient = normalizeTR(to);
  if (!recipient || recipient.length < 12) return { ok: false, error: 'no recipient' };
  if (settings.wa_provider !== 'meta' || !settings.wa_token || !settings.wa_phone_id) {
    await log('whatsapp', recipient, body, 'logged', 'Test mode: WhatsApp API not configured');
    return { ok: true, mode: 'log' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${settings.wa_phone_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.wa_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: recipient, type: 'text',
        text: { preview_url: false, body },
      }),
    });
    const data = await res.json();
    const ok = res.ok && !data.error;
    await log('whatsapp', recipient, body, ok ? 'sent' : 'failed', JSON.stringify(data.error || data.messages || data));
    return { ok, mode: 'meta', detail: data };
  } catch (e) {
    await log('whatsapp', recipient, body, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendSMS, sendWhatsApp, normalizeTR };
