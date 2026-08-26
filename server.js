const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const db = require('./db');
const { sendSMS, sendWhatsApp } = require('./messaging');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const DAYS_TR = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DAYS_EN = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TZ = 'Europe/Istanbul';

/* ---------- helpers ---------- */
function istanbulToday() {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function nextDateForDay(day, minDaysAhead) {
  // day: 1 Mon..7 Sun. Returns a UTC-midnight Date for the next occurrence >= today+minDaysAhead
  const start = istanbulToday();
  start.setUTCDate(start.getUTCDate() + minDaysAhead);
  const startDay = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
  const diff = (day - startDay + 7) % 7;
  const d = new Date(start); d.setUTCDate(d.getUTCDate() + diff);
  return d;
}
const iso = d => d.toISOString().slice(0, 10);
const fmtTR = isoStr => { const [y, m, d] = isoStr.split('-'); return `${d}.${m}.${y}`; };

function levelAllowed(rule, studentLevel, slotLevel) {
  const i = LEVELS.indexOf(studentLevel);
  if (i < 0) return false;
  const allowed = new Set([studentLevel]);
  if (rule === 'own_next' || rule === 'own_adjacent') { if (LEVELS[i + 1]) allowed.add(LEVELS[i + 1]); }
  if (rule === 'own_adjacent') { if (LEVELS[i - 1]) allowed.add(LEVELS[i - 1]); }
  if (rule === 'all') return true;
  return slotLevel.split(/[-\/,\s]+/).some(l => allowed.has(l));
}
const isValidTRPhone = p => /^05\d{9}$/.test(String(p).replace(/\s/g, ''));
const cleanName = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const nameOk = s => /^[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû' -]{2,60}$/.test(s);

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(data, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function requireAdmin(req, res, next) {
  if (verify(req.cookies.et_admin)) return next();
  res.status(401).json({ error: 'Giriş gerekli / Login required' });
}
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });

async function slotsWithMeta(minDaysAhead) {
  const { rows: slots } = await db.q(`
    SELECT s.*, t.name AS teacher_name, t.phone AS teacher_phone
    FROM slots s LEFT JOIN teachers t ON t.id = s.teacher_id
    ORDER BY s.day, s.start_time, s.id`);
  for (const s of slots) {
    s.next_date = iso(nextDateForDay(s.day, minDaysAhead));
    const { rows } = await db.q('SELECT COUNT(*)::int AS n FROM booking_slots WHERE slot_id=$1 AND slot_date=$2', [s.id, s.next_date]);
    s.booked = rows[0].n;
    s.full = s.capacity > 0 && s.booked >= s.capacity;
  }
  return slots;
}

/* ---------- public API ---------- */
app.get('/api/config', wrap(async (req, res) => {
  const st = await db.getSettings();
  const minDays = parseInt(st.min_days_ahead || '1', 10);
  const slots = (await slotsWithMeta(minDays)).map(s => ({
    id: s.id, day: s.day, start_time: s.start_time, end_time: s.end_time, level: s.level,
    teacher_name: s.teacher_name || '', classroom: s.classroom, cancelled: s.cancelled,
    cancel_note: s.cancel_note, next_date: s.next_date, full: s.full,
  }));
  res.json({
    levels: LEVELS, slots,
    classroom_weekday: st.classroom_weekday, classroom_weekend: st.classroom_weekend,
    level_rule: st.level_rule, min_days_ahead: minDays,
  });
}));

app.post('/api/bookings', wrap(async (req, res) => {
  const st = await db.getSettings();
  const minDays = parseInt(st.min_days_ahead || '1', 10);
  const first = cleanName(req.body.first_name), last = cleanName(req.body.last_name);
  const phone = String(req.body.phone || '').replace(/\s/g, '');
  const level = String(req.body.level || '').toUpperCase();
  const topic = String(req.body.topic || '').trim().slice(0, 200);
  const slotIds = [...new Set((req.body.slot_ids || []).map(Number).filter(Number.isInteger))];

  if (!nameOk(first) || !nameOk(last)) return res.status(400).json({ error: 'İsim ve soyisim sadece harf içermelidir.' });
  if (!isValidTRPhone(phone)) return res.status(400).json({ error: 'Telefon 05XX XXX XX XX formatında olmalıdır.' });
  if (!LEVELS.includes(level)) return res.status(400).json({ error: 'Geçersiz seviye.' });
  if (!slotIds.length) return res.status(400).json({ error: 'En az bir etüt seçmelisiniz.' });

  const all = await slotsWithMeta(minDays);
  const chosen = slotIds.map(id => all.find(s => s.id === id)).filter(Boolean);
  if (chosen.length !== slotIds.length) return res.status(400).json({ error: 'Seçilen etüt bulunamadı.' });
  for (const s of chosen) {
    if (s.cancelled) return res.status(400).json({ error: `${DAYS_TR[s.day]} ${s.start_time} etütü iptal edilmiştir.` });
    if (s.full) return res.status(400).json({ error: `${DAYS_TR[s.day]} ${s.start_time} etütü dolu.` });
    if (!levelAllowed(st.level_rule, level, s.level)) return res.status(400).json({ error: `${s.level} etütü seviyenize uygun değil.` });
    const dup = await db.q(`SELECT 1 FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id
                            WHERE bs.slot_id=$1 AND bs.slot_date=$2 AND b.phone=$3`, [s.id, s.next_date, phone]);
    if (dup.rowCount) return res.status(400).json({ error: `${DAYS_TR[s.day]} ${s.start_time} etütüne zaten kayıtlısınız.` });
  }

  const { rows: [booking] } = await db.q(
    'INSERT INTO bookings (first_name,last_name,phone,level,topic) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [first, last, phone, level, topic]);
  for (const s of chosen) {
    await db.q(`INSERT INTO booking_slots (booking_id,slot_id,slot_date,day,start_time,end_time,level,teacher_name)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [booking.id, s.id, s.next_date, s.day, s.start_time, s.end_time, s.level, s.teacher_name || '']);
  }

  // ---- notifications ----
  const fullName = `${first} ${last}`;
  const line = s => `${DAYS_TR[s.day]} ${fmtTR(s.next_date)} ${s.start_time}-${s.end_time} ${s.level}` +
    (s.teacher_name ? ` (${s.teacher_name})` : '');
  const rooms = [...new Set(chosen.map(s => s.classroom || (s.day >= 6 ? st.classroom_weekend : st.classroom_weekday)))].join(' / ');
  const smsBody = (st.sms_template || '')
    .replace('{AD_SOYAD}', fullName).replace('{ETUTLER}', chosen.map(line).join('\n')).replace('{SINIF}', rooms);
  // SMS is off by default. Netgsm is not connected yet, and a student
  // promised a message that never arrives is worse than no promise.
  const smsOn = String(st.sms_enabled ?? '') === '1';
  const results = {
    sms: smsOn
      ? await sendSMS(st, phone, smsBody)
      : { channel: 'sms', status: 'disabled', detail: 'SMS is switched off in Settings.' },
    whatsapp: [],
  };

  const byTeacher = new Map();
  for (const s of chosen) if (s.teacher_phone) {
    if (!byTeacher.has(s.teacher_phone)) byTeacher.set(s.teacher_phone, { name: s.teacher_name, slots: [] });
    byTeacher.get(s.teacher_phone).slots.push(s);
  }
  const topicText = topic || '—';

  /**
   * Fills a message template. Every placeholder is optional, so a
   * coordinator can shorten or reword the message without breaking it.
   */
  const fill = (tpl, vars) =>
    Object.entries(vars).reduce(
      (out, [key, value]) => out.split(`{${key}}`).join(value),
      tpl || ''
    );

  const TEACHER_DEFAULT =
    'Merhaba {HOCA_ADI},\n\n' +
    '{AD_SOYAD} adlı öğrenciniz etüt kaydı oluşturdu.\n\n' +
    'Seviye: {SEVIYE}\n' +
    'Konu: {KONU}\n' +
    'Telefon: {TELEFON}\n\n' +
    'Etüt saatleri:\n{ETUTLER}\n\n' +
    'İyi çalışmalar dileriz.\nEnglish Time {SUBE}';

  const COORDINATOR_DEFAULT =
    'Yeni etüt kaydı\n\n' +
    'Öğrenci: {AD_SOYAD} ({TELEFON})\n' +
    'Seviye: {SEVIYE}\n' +
    'Konu: {KONU}\n\n' +
    '{ETUTLER}';

  for (const [tPhone, t] of byTeacher) {
    const body = fill(st.wa_teacher_template || TEACHER_DEFAULT, {
      HOCA_ADI: t.name || 'Hocam',
      AD_SOYAD: fullName,
      TELEFON: phone,
      SEVIYE: level,
      KONU: topicText,
      ETUTLER: t.slots.map(s => `• ${line(s)}`).join('\n'),
      SINIF: rooms,
      SUBE: st.branch_name || 'Kızılay',
    });
    results.whatsapp.push(await sendWhatsApp(st, tPhone, body));
  }

  if (st.coordinator_phone) {
    const body = fill(st.wa_coordinator_template || COORDINATOR_DEFAULT, {
      HOCA_ADI: st.coordinator_name || '',
      AD_SOYAD: fullName,
      TELEFON: phone,
      SEVIYE: level,
      KONU: topicText,
      ETUTLER: chosen.map(s => `• ${line(s)}`).join('\n'),
      SINIF: rooms,
      SUBE: st.branch_name || 'Kızılay',
    });
    results.whatsapp.push(await sendWhatsApp(st, st.coordinator_phone, body));
  }

  res.json({
    ok: true, booking_id: booking.id,
    summary: chosen.map(s => ({ id: s.id, day: s.day, day_tr: DAYS_TR[s.day], day_en: DAYS_EN[s.day], date: s.next_date,
      start_time: s.start_time, end_time: s.end_time, level: s.level, teacher_name: s.teacher_name || '',
      classroom: s.classroom || (s.day >= 6 ? st.classroom_weekend : st.classroom_weekday) })),
    sms_mode: results.sms.mode,
  });
}));

/* ---------- admin auth ---------- */
app.post('/api/admin/login', wrap(async (req, res) => {
  const st = await db.getSettings();
  if (String(req.body.password || '') !== st.admin_password) return res.status(401).json({ error: 'Şifre hatalı' });
  res.cookie('et_admin', sign({ role: 'admin', exp: Date.now() + 12 * 3600e3 }),
    { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 12 * 3600e3 });
  res.json({ ok: true });
}));
app.post('/api/admin/logout', (req, res) => { res.clearCookie('et_admin'); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ admin: !!verify(req.cookies.et_admin) }));

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/overview', wrap(async (req, res) => {
  const st = await db.getSettings();
  const minDays = parseInt(st.min_days_ahead || '1', 10);
  const slots = await slotsWithMeta(minDays);
  const { rows: teachers } = await db.q('SELECT * FROM teachers ORDER BY name');
  const { rows: bookings } = await db.q(`
    SELECT b.*, COALESCE(json_agg(json_build_object('date',bs.slot_date,'day',bs.day,'start',bs.start_time,'end',bs.end_time,
           'level',bs.level,'teacher',bs.teacher_name) ORDER BY bs.slot_date, bs.start_time) FILTER (WHERE bs.id IS NOT NULL), '[]') AS slots
    FROM bookings b LEFT JOIN booking_slots bs ON bs.booking_id=b.id
    GROUP BY b.id ORDER BY b.created_at DESC LIMIT 300`);
  const { rows: messages } = await db.q('SELECT * FROM messages ORDER BY created_at DESC LIMIT 100');
  const { rows: [{ n: total }] } = await db.q('SELECT COUNT(*)::int AS n FROM bookings');
  res.json({ settings: st, slots, teachers, bookings, messages, total_bookings: total, levels: LEVELS, site_url: `${req.protocol}://${req.get('host')}` });
}));

admin.put('/settings', wrap(async (req, res) => {
  const allowed = ['coordinator_name', 'coordinator_phone', 'classroom_weekday', 'classroom_weekend', 'level_rule', 'min_days_ahead',
    'sms_provider', 'netgsm_usercode', 'netgsm_password', 'netgsm_header', 'wa_provider', 'wa_token', 'wa_phone_id', 'sms_template',
    'wa_teacher_template', 'wa_coordinator_template', 'sms_enabled', 'branch_name', 'admin_password'];
  for (const k of allowed) if (k in req.body) {
    if (k === 'admin_password' && String(req.body[k]).length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    await db.setSetting(k, req.body[k]);
  }
  res.json({ ok: true });
}));

admin.post('/teachers', wrap(async (req, res) => {
  const { rows: [t] } = await db.q('INSERT INTO teachers (name,phone,note) VALUES ($1,$2,$3) RETURNING *',
    [cleanName(req.body.name), String(req.body.phone || '').replace(/\s/g, ''), String(req.body.note || '')]);
  res.json(t);
}));
admin.put('/teachers/:id', wrap(async (req, res) => {
  const { rows: [t] } = await db.q('UPDATE teachers SET name=$1, phone=$2, note=$3 WHERE id=$4 RETURNING *',
    [cleanName(req.body.name), String(req.body.phone || '').replace(/\s/g, ''), String(req.body.note || ''), req.params.id]);
  res.json(t);
}));
admin.delete('/teachers/:id', wrap(async (req, res) => { await db.q('DELETE FROM teachers WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

const slotFields = b => [Number(b.day), String(b.start_time), String(b.end_time), String(b.level).toUpperCase().trim(),
  b.teacher_id ? Number(b.teacher_id) : null, String(b.classroom || ''), Number(b.capacity || 0)];
admin.post('/slots', wrap(async (req, res) => {
  const { rows: [s] } = await db.q(`INSERT INTO slots (day,start_time,end_time,level,teacher_id,classroom,capacity)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, slotFields(req.body));
  res.json(s);
}));
admin.put('/slots/:id', wrap(async (req, res) => {
  const { rows: [s] } = await db.q(`UPDATE slots SET day=$1,start_time=$2,end_time=$3,level=$4,teacher_id=$5,classroom=$6,capacity=$7
    WHERE id=$8 RETURNING *`, [...slotFields(req.body), req.params.id]);
  res.json(s);
}));
admin.post('/slots/:id/cancel', wrap(async (req, res) => {
  const { rows: [s] } = await db.q('UPDATE slots SET cancelled=$1, cancel_note=$2 WHERE id=$3 RETURNING *',
    [!!req.body.cancelled, String(req.body.note || ''), req.params.id]);
  res.json(s);
}));
admin.delete('/slots/:id', wrap(async (req, res) => { await db.q('DELETE FROM slots WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));
admin.delete('/bookings/:id', wrap(async (req, res) => { await db.q('DELETE FROM bookings WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

admin.post('/test-message', wrap(async (req, res) => {
  const st = await db.getSettings();
  /**
   * Sends the REAL teacher template with sample data, not a generic
   * "test message". A test that does not look like the live message
   * proves very little — you want to see the wording, the line breaks
   * and the placeholders exactly as a teacher will receive them.
   */
  const fill = (tpl, vars) =>
    Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), tpl || '');

  const sample = {
    HOCA_ADI: 'Örnek Hoca',
    AD_SOYAD: 'Örnek Öğrenci',
    TELEFON: '05XX XXX XX XX',
    SEVIYE: 'B1',
    KONU: 'Present Perfect',
    ETUTLER: '• Çarşamba 27.08.2026 17:00-18:00 B1',
    SINIF: st.classroom_weekday || '-',
    SUBE: st.branch_name || 'Kızılay',
  };

  const body = req.body.channel === 'whatsapp'
    ? fill(st.wa_teacher_template || 'English Time Etüt Sistemi – test mesajı', sample)
    : fill(st.sms_template || 'English Time Etut Sistemi - test mesaji', sample);

  const r = req.body.channel === 'whatsapp'
    ? await sendWhatsApp(st, req.body.to, body)
    : await sendSMS(st, req.body.to, body);

  res.json({ ...r, preview: body });
}));

admin.get('/qr.png', wrap(async (req, res) => {
  const url = String(req.query.url || `${req.protocol}://${req.get('host')}`);
  const png = await QRCode.toBuffer(url, { width: 1200, margin: 2, color: { dark: '#111111', light: '#FFE600' }, errorCorrectionLevel: 'H' });
  res.type('png').send(png);
}));

admin.get('/export.xlsx', wrap(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Etüt Kayıtları');
  ws.columns = [
    { header: 'Kayıt No', key: 'id', width: 10 }, { header: 'Kayıt Tarihi', key: 'created', width: 18 },
    { header: 'Ad', key: 'first', width: 16 }, { header: 'Soyad', key: 'last', width: 16 },
    { header: 'Telefon', key: 'phone', width: 15 }, { header: 'Seviye', key: 'level', width: 8 },
    { header: 'Konu', key: 'topic', width: 30 }, { header: 'Etüt Tarihi', key: 'date', width: 12 },
    { header: 'Gün', key: 'day', width: 12 }, { header: 'Saat', key: 'time', width: 13 },
    { header: 'Etüt Seviyesi', key: 'slevel', width: 12 }, { header: 'Öğretmen', key: 'teacher', width: 18 },
  ];
  ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE600' } };
  const { rows } = await db.q(`SELECT b.*, bs.slot_date, bs.day, bs.start_time, bs.end_time, bs.level AS slevel, bs.teacher_name
    FROM bookings b LEFT JOIN booking_slots bs ON bs.booking_id=b.id ORDER BY b.created_at DESC, bs.slot_date`);
  for (const r of rows) ws.addRow({
    id: r.id, created: new Date(r.created_at).toLocaleString('tr-TR', { timeZone: TZ }), first: r.first_name, last: r.last_name,
    phone: r.phone, level: r.level, topic: r.topic, date: r.slot_date ? fmtTR(iso(new Date(r.slot_date))) : '',
    day: DAYS_TR[r.day] || '', time: r.start_time ? `${r.start_time}-${r.end_time}` : '', slevel: r.slevel || '', teacher: r.teacher_name || '',
  });
  ws.autoFilter = 'A1:L1';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="etut_kayitlari_${iso(istanbulToday())}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

app.use('/api/admin', admin);

// Health check for Coolify. Must sit BEFORE the catch-all route below,
// and must return 200 even if the database is briefly unavailable —
// it answers "is the process alive", not "is everything perfect".
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

// Start listening straight away, on 0.0.0.0 so the container is reachable
// from Coolify's proxy. Binding to localhost would make it unreachable.
app.listen(PORT, '0.0.0.0', () =>
  console.log(`✅ English Time Etüt System listening on port ${PORT}`));

// Set up the database separately, retrying instead of exiting. A crash here
// makes Coolify restart the container, which fails again — a crash loop that
// looks like a code bug but is usually just the database still starting up.
(async function initWithRetry(attempt = 1) {
  try {
    await db.init();
    console.log('✅ Database ready');
  } catch (e) {
    console.error(`⚠️  DB init failed (attempt ${attempt}): ${e.message}`);
    if (attempt < 20) {
      setTimeout(() => initWithRetry(attempt + 1), 5000);
    } else {
      console.error('❌ Giving up on DB init. Server still running; check DATABASE_URL.');
    }
  }
})();
