const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const db = require('./db');
const { sendSMS } = require('./messaging');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders(res, filePath) {
    /* HTML is never cached; CSS and JS are, because their URLs carry a
     * ?v= version. The old blanket 1-hour cache let a browser pair NEW
     * html with OLD javascript — the cached script looked for a button
     * the new page no longer had, threw, and rendered a white screen. */
    res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=86400');
  },
}));

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

    /* A cancellation now applies to ONE date, not to the weekly slot for
     * ever. If this particular date is cancelled the slot is hidden; next
     * week's occurrence is unaffected. */
    const { rows: cx } = await db.q(
      'SELECT note FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2',
      [s.id, s.next_date]
    );
    s.date_cancelled = cx.length > 0;
    s.date_cancel_note = cx[0]?.note || '';
  }
  return slots;
}

/* ---------- public API ---------- */
app.get('/api/config', wrap(async (req, res) => {
  const st = await db.getSettings();
  const minDays = parseInt(st.min_days_ahead || '1', 10);
  const slots = (await slotsWithMeta(minDays)).map(s => ({
    id: s.id, day: s.day, start_time: s.start_time, end_time: s.end_time, level: s.level,
    teacher_name: s.teacher_name || '', classroom: s.classroom,
    cancelled: s.cancelled || s.date_cancelled,
    cancel_note: s.date_cancel_note || s.cancel_note,
    next_date: s.next_date, full: s.full,
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
    /* Checks BOTH the legacy flag and the per-date cancellation.
     * Previously only s.cancelled was tested, so a session cancelled for
     * a specific date still accepted bookings — students were told their
     * place was reserved for an etut that was not happening. */
    if (s.cancelled || s.date_cancelled) {
      return res.status(400).json({ error: `${DAYS_TR[s.day]} ${s.start_time} etütü iptal edilmiştir.` });
    }
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

  /* ---------- notifications ----------
   *
   * SMS only. Every message is written in plain letters so it bills as a
   * single SMS; messaging.js strips any Turkish characters a coordinator
   * types into a template.
   *
   * Nothing here can fail the booking. The student has already been told
   * their place is reserved, so a failed SMS is logged in the Mesajlar
   * tab rather than thrown back at them.
   */
  const fullName = `${first} ${last}`;
  const line = s => `${fmtTR(s.next_date)} ${DAYS_TR[s.day]} ${s.start_time}-${s.end_time} ${s.level}`;
  const rooms = [...new Set(chosen.map(s => s.classroom || (s.day >= 6 ? st.classroom_weekend : st.classroom_weekday)))].join(' / ');

  const fill = (tpl, vars) =>
    Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), tpl || '');

  const results = { student: null, teachers: [] };

  // --- the student ---
  const studentBody = fill(st.sms_student_template || '', {
    AD_SOYAD: fullName,
    ETUTLER: chosen.map(line).join(' | '),
    SINIF: rooms,
    SEVIYE: level,
    SUBE: st.branch_name || 'Kizilay',
  });
  results.student = await sendSMS(st, phone, studentBody);

  /* --- the teachers ---
   *
   * ONE SMS per etut session, not per student. Ten students booking the
   * same Wednesday 17:00 slot means the teacher hears once, on the first
   * booking; the other nine bookings send nothing.
   *
   * The message deliberately carries NO student name. A teacher needs to
   * know an etut is happening and when — the register is in the admin
   * panel, and putting names in SMS spreads student data across phones
   * for no benefit.
   *
   * teacher_notifications makes this safe against double-clicks and
   * simultaneous bookings: the UNIQUE constraint means only the first
   * INSERT succeeds, so exactly one SMS goes out.
   */
  for (const slot of chosen) {
    if (!slot.teacher_phone) continue;

    /* Checked with an explicit SELECT rather than relying on
     * "ON CONFLICT ... RETURNING" returning no rows. That behaviour is
     * correct in PostgreSQL but not universal, and a notification that
     * silently fires ten times is exactly the bug being fixed. The
     * INSERT still carries ON CONFLICT so two simultaneous bookings
     * cannot both slip through. */
    const already = await db.q(
      `SELECT 1 FROM teacher_notifications
        WHERE slot_id=$1 AND slot_date=$2 AND kind='booking'`,
      [slot.id, slot.next_date]
    );
    if (already.rowCount) continue;

    await db.q(
      `INSERT INTO teacher_notifications (slot_id, slot_date, kind)
       VALUES ($1, $2, 'booking')
       ON CONFLICT (slot_id, slot_date, kind) DO NOTHING`,
      [slot.id, slot.next_date]
    );

    const body = fill(st.sms_teacher_template || '', {
      HOCA_ADI: slot.teacher_name || 'Hocam',
      TARIH: fmtTR(slot.next_date),
      GUN: DAYS_TR[slot.day],
      SAAT: `${slot.start_time}-${slot.end_time}`,
      SEVIYE: slot.level,
      SINIF: slot.classroom || (slot.day >= 6 ? st.classroom_weekend : st.classroom_weekday) || '-',
      SUBE: st.branch_name || 'Kizilay',
    });
    results.teachers.push(await sendSMS(st, slot.teacher_phone, body));
  }

  // --- the coordinator, if one is set ---
  if (st.coordinator_phone) {
    const body = fill(st.sms_coordinator_template || '', {
      AD_SOYAD: fullName,
      TELEFON: phone,
      SEVIYE: level,
      KONU: topic || '-',
      ETUTLER: chosen.map(line).join(' | '),
      SINIF: rooms,
      SUBE: st.branch_name || 'Kizilay',
    });
    results.teachers.push(await sendSMS(st, st.coordinator_phone, body));
  }

  /* The confirmation screen reads `summary` and `sms_mode`.
   *
   * An earlier rewrite of this block reduced the response to {ok:true},
   * so the browser threw on `data.summary.map(...)` and showed
   * "Baglanti hatasi" — even though the booking had saved perfectly.
   * The failure looked like a network problem and was not one. */
  res.json({
    ok: true,
    sms_mode: results.student?.mode === 'log' ? 'log' : 'sent',
    summary: chosen.map(s => ({
      level: s.level,
      date: s.next_date,
      day_tr: DAYS_TR[s.day],
      day_en: DAYS_EN[s.day],
      start_time: s.start_time,
      end_time: s.end_time,
      classroom: s.classroom || (s.day >= 6 ? st.classroom_weekend : st.classroom_weekday) || '',
      teacher_name: s.teacher_name || '',
    })),
  });
}));
/**
 * Admin login.
 *
 * RESTORED — an earlier edit to the notification block above overran its
 * boundary and deleted this route. The panel then had no way to issue a
 * session cookie, so every attempt came back "Hatalı şifre" no matter
 * what was typed, and resetting the password in the database changed
 * nothing because nothing was reading it.
 */
app.post('/api/admin/login', wrap(async (req, res) => {
  const st = await db.getSettings();
  const supplied = String(req.body?.password ?? '');
  const expected = String(st.admin_password ?? '');

  if (!expected) {
    return res.status(500).json({ error: 'Yönetici şifresi tanımlı değil.' });
  }

  // Constant-time compare so the response time does not leak how much of
  // the password was correct.
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) return res.status(401).json({ error: 'Hatalı şifre' });

  res.cookie('et_admin', sign({ exp: Date.now() + 12 * 3600 * 1000 }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: 12 * 3600 * 1000,
  });
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
  /* The admin panel showed only the legacy `cancelled` column, so a
   * cancellation made for a specific date was invisible here — it
   * appeared on the student page but not in the panel that created it.
   * Both flags are merged, and the raw ones kept so the panel can tell
   * a one-off cancellation from a permanently disabled slot. */
  const slotsForAdmin = slots.map(s => ({
    ...s,
    cancelled: s.cancelled || s.date_cancelled,
    cancel_note: s.date_cancel_note || s.cancel_note || '',
    date_cancelled: !!s.date_cancelled,
    legacy_cancelled: !!s.cancelled,
  }));

  res.json({ settings: st, slots: slotsForAdmin, teachers, bookings, messages, total_bookings: total, levels: LEVELS, site_url: `${req.protocol}://${req.get('host')}` });
}));

admin.put('/settings', wrap(async (req, res) => {
  const allowed = ['coordinator_name', 'coordinator_phone', 'classroom_weekday', 'classroom_weekend', 'level_rule', 'min_days_ahead',
    'sms_provider', 'netgsm_usercode', 'netgsm_password', 'netgsm_header',
    'sms_student_template', 'sms_teacher_template', 'sms_coordinator_template',
    'sms_cancel_template', 'sms_cancel_teacher_template',
    'branch_name', 'admin_password'];
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
  /**
   * Merges with the existing row instead of overwriting every column.
   *
   * The previous version fed every field straight into the UPDATE, so a
   * request that omitted one wrote rubbish: `Number(undefined)` became
   * NaN for `day` and `String(undefined)` became the literal text
   * "undefined" for the times. PostgreSQL rejects NaN for an integer, so
   * the admin saw a 500; had the column been text, the slot would have
   * been silently corrupted instead.
   */
  const { rows: [current] } = await db.q('SELECT * FROM slots WHERE id=$1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Etüt bulunamadı.' });

  const b = req.body || {};
  const merged = {
    day: b.day === undefined ? current.day : Number(b.day),
    start_time: b.start_time === undefined ? current.start_time : String(b.start_time),
    end_time: b.end_time === undefined ? current.end_time : String(b.end_time),
    level: b.level === undefined ? current.level : String(b.level).toUpperCase().trim(),
    teacher_id: b.teacher_id === undefined ? current.teacher_id : (b.teacher_id ? Number(b.teacher_id) : null),
    classroom: b.classroom === undefined ? current.classroom : String(b.classroom).trim(),
    capacity: b.capacity === undefined ? current.capacity : Number(b.capacity),
  };

  if (!Number.isInteger(merged.day) || merged.day < 1 || merged.day > 7) {
    return res.status(400).json({ error: 'Geçersiz gün.' });
  }
  if (!Number.isFinite(merged.capacity) || merged.capacity < 0) {
    return res.status(400).json({ error: 'Geçersiz kontenjan.' });
  }
  if (!LEVELS.includes(merged.level)) {
    return res.status(400).json({ error: 'Geçersiz seviye.' });
  }

  const { rows: [s] } = await db.q(
    `UPDATE slots SET day=$1,start_time=$2,end_time=$3,level=$4,teacher_id=$5,classroom=$6,capacity=$7
     WHERE id=$8 RETURNING *`,
    [merged.day, merged.start_time, merged.end_time, merged.level,
     merged.teacher_id, merged.classroom, merged.capacity, req.params.id]);
  res.json(s);
}));
admin.post('/slots/:id/cancel', wrap(async (req, res) => {
  /**
   * Cancels ONE date, not the weekly slot.
   *
   * A teacher off sick this Wednesday needs the 3rd cancelled and the
   * 10th left alone. The old version set a flag on the recurring slot,
   * which killed that time permanently.
   *
   * Every student already booked on that date is texted. That is the
   * whole point: a cancellation nobody is told about is worse than no
   * cancellation, because students turn up to an empty room.
   */
  const st = await db.getSettings();
  const slotId = parseInt(req.params.id, 10);
  const date = String(req.body.date || '').slice(0, 10);
  const note = String(req.body.note || '').trim();
  const cancelling = req.body.cancelled !== false;

  if (!date) return res.status(400).json({ error: 'Tarih secilmedi.' });

  const { rows: [slot] } = await db.q(
    `SELECT s.*, t.name AS teacher_name, t.phone AS teacher_phone
       FROM slots s LEFT JOIN teachers t ON t.id = s.teacher_id WHERE s.id=$1`, [slotId]);
  if (!slot) return res.status(404).json({ error: 'Etut bulunamadi.' });

  if (!cancelling) {
    await db.q('DELETE FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2', [slotId, date]);

    /* Also clear the LEGACY flag on the recurring slot.
     *
     * Before per-date cancellation existed, cancelling set a boolean on
     * the weekly slot itself. Nothing cleared it afterwards, so any slot
     * cancelled under the old system stayed cancelled for ever: the
     * admin panel reported "restored", the student page still showed it
     * struck through, and every booking was rejected with "etut iptal
     * edilmistir". */
    await db.q("UPDATE slots SET cancelled=false, cancel_note='' WHERE id=$1", [slotId]);

    return res.json({ ok: true, restored: true });
  }

  await db.q(
    `INSERT INTO slot_cancellations (slot_id, slot_date, note) VALUES ($1,$2,$3)
     ON CONFLICT (slot_id, slot_date) DO UPDATE SET note = EXCLUDED.note`,
    [slotId, date, note]);

  // Who was booked on this exact date?
  const { rows: affected } = await db.q(
    `SELECT DISTINCT b.id, b.first_name, b.last_name, b.phone
       FROM booking_slots bs JOIN bookings b ON b.id = bs.booking_id
      WHERE bs.slot_id=$1 AND bs.slot_date=$2`, [slotId, date]);

  const fill = (tpl, vars) =>
    Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), tpl || '');

  const notified = [];
  for (const person of affected) {
    const body = fill(st.sms_cancel_template || '', {
      AD_SOYAD: `${person.first_name} ${person.last_name}`,
      TARIH: fmtTR(date),
      GUN: DAYS_TR[slot.day],
      SAAT: `${slot.start_time}-${slot.end_time}`,
      SEBEP: note || '-',
      SUBE: st.branch_name || 'Kizilay',
    });
    notified.push(await sendSMS(st, person.phone, body));
  }

  // Tell the teacher too, so nobody travels in for a cancelled session.
  if (slot.teacher_phone) {
    const body = fill(st.sms_cancel_teacher_template || '', {
      HOCA_ADI: slot.teacher_name || 'Hocam',
      TARIH: fmtTR(date),
      GUN: DAYS_TR[slot.day],
      SAAT: `${slot.start_time}-${slot.end_time}`,
      SAYI: String(affected.length),
      SUBE: st.branch_name || 'Kizilay',
    });
    notified.push(await sendSMS(st, slot.teacher_phone, body));
  }

  res.json({ ok: true, notified: affected.length, results: notified });
}));
admin.delete('/slots/:id', wrap(async (req, res) => { await db.q('DELETE FROM slots WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));
admin.delete('/bookings/:id', wrap(async (req, res) => { await db.q('DELETE FROM bookings WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

admin.post('/test-message', wrap(async (req, res) => {
  const st = await db.getSettings();
  /**
   * Sends the REAL student template with sample data, not a generic test
   * string. A test that does not look like the live message proves very
   * little — you want to see the exact wording and how many SMS it bills.
   */
  const fill = (tpl, vars) =>
    Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), tpl || '');

  const sample = {
    HOCA_ADI: 'Ornek Hoca',
    AD_SOYAD: 'Ornek Ogrenci',
    TELEFON: '05XXXXXXXXX',
    SEVIYE: 'B1',
    KONU: 'Present Perfect',
    ETUTLER: '03.09.2026 Carsamba 17:00-18:00 B1',
    SINIF: st.classroom_weekday || '-',
    TARIH: '03.09.2026',
    GUN: 'Carsamba',
    SAAT: '17:00-18:00',
    SEBEP: 'Ogretmen izinli',
    SAYI: '3',
    SUBE: st.branch_name || 'Kizilay',
  };

  const which = req.body.template || 'student';
  const tpl =
    which === 'teacher' ? st.sms_teacher_template :
    which === 'cancel' ? st.sms_cancel_template :
    st.sms_student_template;

  const body = fill(tpl || 'English Time Etut Sistemi - test mesaji', sample);
  const r = await sendSMS(st, req.body.to, body);

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
