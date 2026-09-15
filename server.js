const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  const incoming = String(req.get('x-request-id') || '').trim();
  req.requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '250kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));

if (process.env.NODE_ENV === 'production' && !String(process.env.SESSION_SECRET || '').trim()) {
  console.error('❌ SESSION_SECRET is required in production. Configure it in Coolify.');
  process.exit(1);
}
const SECRET = String(process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('⚠️ SESSION_SECRET is not set. Development sessions will reset after every server restart.');
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const DAYS_TR = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DAYS_EN = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TZ = 'Europe/Istanbul';
const TEACHER_COOKIE = 'et_teacher';
const STUDENT_COOKIE = 'et_student';
const ADMIN_COOKIE = 'et_admin';
const SESSION_12H = 12 * 3600 * 1000;
const SESSION_30D = 30 * 86400 * 1000;
let dbReady = false;

/* ----------------------------- helpers ----------------------------- */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const positiveIntParam = value => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };
const cleanName = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const nameOk = s => /^[\p{L}\p{M}' -]{2,60}$/u.test(s);
const cleanPhone = p => String(p || '').replace(/\D/g, '');
const isValidTRPhone = p => /^05\d{9}$/.test(cleanPhone(p));
const validUsername = s => /^[A-Za-z0-9._-]{3,40}$/.test(String(s || '').trim());
const validTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const iso = d => d.toISOString().slice(0, 10);
function dateISO(value) {
  // PostgreSQL DATE values are calendar dates, not instants. node-postgres may
  // materialize DATE as a local-midnight Date depending on platform/TZ. Using
  // toISOString() can then shift the date to the previous UTC day (notably on
  // Windows in Europe/Istanbul), causing schedule edits to target the wrong
  // occurrence. Preserve the Date object's local calendar components instead.
  if (value instanceof Date) {
    const y=value.getFullYear(), m=String(value.getMonth()+1).padStart(2,'0'), d=String(value.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0,10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : iso(d);
}
const fmtTR = s => { const [y, m, d] = dateISO(s).split('-'); return y ? `${d}.${m}.${y}` : ''; };
const escLike = s => `%${String(s || '').replace(/[\\%_]/g, c => '\\' + c)}%`;

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = type => parts.find(x => x.type === type)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
function validISODate(s) {
  const raw = String(s || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const x = new Date(Date.UTC(y, mo - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === mo - 1 && x.getUTCDate() === d;
}
function requireISODate(value, label = 'Tarih') {
  const raw = String(value || '').slice(0, 10);
  if (!validISODate(raw)) throw httpError(400, `${label} geçersiz.`);
  return raw;
}
function dateObj(s) { if (!validISODate(s)) throw httpError(400, 'Geçersiz tarih.'); const [y,m,d]=String(s).split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
function addDays(s, n) { const d = dateObj(s); d.setUTCDate(d.getUTCDate() + Number(n || 0)); return iso(d); }
function dayOfWeek(s) { const d = dateObj(s).getUTCDay(); return d === 0 ? 7 : d; }
function mondayOf(s) { return addDays(s, 1 - dayOfWeek(s)); }
function normalizeWeek(s) { const raw=String(s||'').slice(0,10); return mondayOf(validISODate(raw) ? raw : localDateParts().date); }
function nextDateForDay(day, minDaysAhead = 0) {
  const start = addDays(localDateParts().date, minDaysAhead);
  return addDays(start, (day - dayOfWeek(start) + 7) % 7);
}
function dateForWeekDay(anyDateInWeek, day) { return addDays(mondayOf(anyDateInWeek), day - 1); }
function sessionHasEnded(date, endTime) {
  const now = localDateParts();
  return date < now.date || (date === now.date && String(endTime || '23:59') <= now.time);
}
function sessionHasStarted(date, startTime) {
  const now = localDateParts();
  return date < now.date || (date === now.date && String(startTime || '00:00') <= now.time);
}
function dateBookable(date, minDays, maxWeeks = 6) {
  const min = addDays(localDateParts().date, Number(minDays || 0));
  const max = addDays(localDateParts().date, Math.max(1, Number(maxWeeks || 6)) * 7);
  return date >= min && date <= max;
}

function levelAllowed(rule, studentLevel, slotLevel) {
  const i = LEVELS.indexOf(studentLevel);
  if (i < 0) return false;
  if (rule === 'all') return true;
  const allowed = new Set([studentLevel]);
  if (rule === 'own_next' || rule === 'own_adjacent') if (LEVELS[i + 1]) allowed.add(LEVELS[i + 1]);
  if (rule === 'own_adjacent') if (LEVELS[i - 1]) allowed.add(LEVELS[i - 1]);
  return String(slotLevel || '').split(/[-/,\s]+/).some(l => allowed.has(l));
}
function validSlotLevel(value) {
  const tokens = String(value || '').toUpperCase().trim().split(/[-/,\s]+/).filter(Boolean);
  return tokens.length > 0 && tokens.length <= 3 && tokens.every(x => LEVELS.includes(x));
}
function effectiveClassroom(s, st) { return s.classroom || (Number(s.day) >= 6 ? st.classroom_weekend : st.classroom_weekday) || ''; }

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function setSessionCookie(req, res, name, payload, maxAge) {
  res.cookie(name, sign({ ...payload, exp: Date.now() + maxAge }), {
    httpOnly: true, sameSite: 'lax', secure: req.secure || req.protocol === 'https', maxAge, path: '/',
  });
}
function clearCookie(res, name) { res.clearCookie(name, { path: '/' }); }

function makePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function passwordMatches(password, salt, expectedHex) {
  if (!salt || !expectedHex) return false;
  const got = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

async function requireAdmin(req, res, next) {
  const p = verify(req.cookies[ADMIN_COOKIE]);
  if (!p || p.role !== 'admin') return res.status(401).json({ error: 'Yönetici girişi gerekli.' });
  const st = await db.getSettings();
  if (Number(p.sv) !== Number(st.admin_session_version || 1)) {
    clearCookie(res, ADMIN_COOKIE);
    return res.status(401).json({ error: 'Yönetici oturumu artık geçerli değil.' });
  }
  req.auth = p; next();
}
async function requireTeacher(req, res, next) {
  const p = verify(req.cookies[TEACHER_COOKIE]);
  if (!p || p.role !== 'teacher') return res.status(401).json({ error: 'Öğretmen girişi gerekli.' });
  const { rows: [t] } = await db.q('SELECT id,name,username,active,session_version,created_at,deleted_at FROM teachers WHERE id=$1', [p.id]);
  if (!t || !t.active || t.deleted_at || Number(t.session_version) !== Number(p.sv)) { clearCookie(res, TEACHER_COOKIE); return res.status(401).json({ error: 'Oturum artık geçerli değil.' }); }
  req.teacher = t; req.auth = p; next();
}
async function requireStudent(req, res, next) {
  const p = verify(req.cookies[STUDENT_COOKIE]);
  if (!p || p.role !== 'student') return res.status(401).json({ error: 'Öğrenci girişi gerekli.' });
  const { rows: [s] } = await db.q('SELECT * FROM students WHERE id=$1', [p.id]);
  if (!s || !s.active || Number(s.session_version) !== Number(p.sv)) { clearCookie(res, STUDENT_COOKIE); return res.status(401).json({ error: 'Oturum artık geçerli değil.' }); }
  req.student = s; req.auth = p; next();
}

/* ------------------------ API safety / diagnostics ------------------------ */
const rateBuckets = new Map();
function rateLimit(prefix, max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    let b = rateBuckets.get(key);
    if (!b || b.reset <= now) b = { n: 0, reset: now + windowMs };
    b.n += 1; rateBuckets.set(key, b);
    if (b.n > max) return res.status(429).json({ error: 'Çok fazla istek. Lütfen kısa bir süre sonra tekrar deneyin.' });
    next();
  };
}
async function safeSystemLog(entry) {
  try { if (dbReady) await db.logSystem(entry); }
  catch (e) { console.error('system log write failed:', e.message); }
}
app.use('/api', (req, res, next) => {
  if (!dbReady) return res.status(503).json({ error: 'Sistem veritabanını hazırlıyor. Lütfen birkaç saniye sonra tekrar deneyin.', request_id: req.requestId });
  next();
});
app.use('/api', (req, res, next) => {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite === 'cross-site') return res.status(403).json({ error: 'İstek kaynağı reddedildi.' });
  if (!origin) return next();
  try {
    const u = new URL(origin);
    const expectedHost = String(req.get('host') || '').toLowerCase();
    const expectedProto = req.protocol;
    if (u.host.toLowerCase() !== expectedHost || u.protocol.replace(':','') !== expectedProto) {
      return res.status(403).json({ error: 'İstek kaynağı reddedildi.' });
    }
  } catch { return res.status(403).json({ error: 'İstek kaynağı reddedildi.' }); }
  next();
});

async function audit(client, actorType, actorId, action, entityType = '', entityId = '', detail = {}) {
  await client.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,detail)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [actorType, actorId || null, action, entityType, String(entityId || ''), JSON.stringify(detail)]);
}
async function notify(client, targetType, targetId, title, body = '', kind = 'info', slotId = null, slotDate = null) {
  await client.query(`INSERT INTO panel_notifications(target_type,target_id,title,body,kind,slot_id,slot_date)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [targetType, targetId ?? null, title, body, kind, slotId, slotDate]);
}
async function viewerNotifications(viewerType, viewerId, limit = 60, beforeId = null, createdAt = null) {
  const broadcastType = viewerType === 'teacher' ? 'all_teachers' : viewerType === 'student' ? 'all_students' : 'all_admins';
  const accountCreated = createdAt || '1970-01-01T00:00:00Z';
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 60));
  const { rows } = await db.q(`
    SELECT n.*, (r.notification_id IS NOT NULL) AS read
      FROM panel_notifications n
      LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.viewer_type=$1 AND r.viewer_id=$2
     WHERE (((n.target_type=$1 AND n.target_id=$2)) OR (n.target_type=$3 AND n.created_at >= $4::timestamptz))
       AND ($5::bigint IS NULL OR n.id < $5)
     ORDER BY n.id DESC LIMIT $6`, [viewerType, viewerId, broadcastType, accountCreated, beforeId ? Number(beforeId) : null, safeLimit]);
  return rows;
}
async function markNotification(viewerType, viewerId, notificationId) {
  await db.q(`INSERT INTO notification_reads(notification_id,viewer_type,viewer_id)
    SELECT id,$2,$3 FROM panel_notifications
     WHERE id=$1 AND ((target_type=$2 AND target_id=$3) OR target_type=$4)
    ON CONFLICT DO NOTHING`, [notificationId, viewerType, viewerId, viewerType === 'teacher' ? 'all_teachers' : viewerType === 'student' ? 'all_students' : 'all_admins']);
}

async function ensureOccurrence(client, slot, date, st) {
  const { rows: [existing] } = await client.query('SELECT * FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2', [slot.id, date]);
  if (existing) return existing;
  let teacherName = slot.teacher_name || '';
  if (!teacherName && slot.teacher_id) {
    const { rows: [t] } = await client.query('SELECT name FROM teachers WHERE id=$1', [slot.teacher_id]);
    teacherName = t?.name || '';
  }
  const classroom = effectiveClassroom(slot, st);
  const { rows: [occ] } = await client.query(`INSERT INTO slot_occurrences
    (slot_id,slot_date,day,start_time,end_time,level,teacher_id,teacher_name,classroom,capacity)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(slot_id,slot_date) DO UPDATE SET slot_id=EXCLUDED.slot_id RETURNING *`,
    [slot.id, date, slot.day, slot.start_time, slot.end_time, slot.level, slot.teacher_id, teacherName, classroom, slot.capacity || 0]);
  return occ;
}

async function scheduleForWeek(weekInput, viewer = {}) {
  if (weekInput !== undefined && weekInput !== null && String(weekInput).trim() && !validISODate(String(weekInput).slice(0,10))) throw httpError(400,'Hafta tarihi geçersiz.');
  const weekStart = normalizeWeek(weekInput);
  const weekEnd = addDays(weekStart, 6);
  const st = await db.getSettings();
  const { rows: slots } = await db.q(`SELECT s.*,t.name AS teacher_name FROM slots s LEFT JOIN teachers t ON t.id=s.teacher_id ORDER BY s.day,s.start_time,s.id`);
  const { rows: occs } = await db.q(`SELECT * FROM slot_occurrences WHERE slot_date BETWEEN $1 AND $2`, [weekStart, weekEnd]);
  const { rows: cancels } = await db.q(`SELECT * FROM slot_cancellations WHERE slot_date BETWEEN $1 AND $2`, [weekStart, weekEnd]);
  const { rows: bookRows } = await db.q(`
    SELECT bs.*, b.first_name,b.last_name,b.topic,b.level AS student_level,b.student_id,
           s.first_name AS current_first,s.last_name AS current_last,s.level AS current_level
      FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id
      LEFT JOIN students s ON s.id=bs.student_id
     WHERE bs.slot_date BETWEEN $1 AND $2 AND b.status<>'deleted_by_admin'
     ORDER BY bs.slot_date,bs.start_time,b.first_name,b.last_name`, [weekStart, weekEnd]);
  let unreadBySlot = new Map();
  if (viewer.type === 'teacher' && viewer.id) {
    const { rows: unread } = await db.q(`SELECT n.slot_id,n.slot_date,COUNT(*)::int n
      FROM panel_notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.viewer_type='teacher' AND r.viewer_id=$1
      WHERE n.target_type='teacher' AND n.target_id=$1 AND n.kind='booking' AND r.notification_id IS NULL AND n.slot_id IS NOT NULL AND n.slot_date BETWEEN $2 AND $3
      GROUP BY n.slot_id,n.slot_date`, [viewer.id, weekStart, weekEnd]);
    unreadBySlot = new Map(unread.map(x => [`${x.slot_id}|${dateISO(x.slot_date)}`, x.n]));
  }
  const occMap = new Map(occs.map(o => [`${o.slot_id}|${dateISO(o.slot_date)}`, o]));
  const cxMap = new Map(cancels.map(c => [`${c.slot_id}|${dateISO(c.slot_date)}`, c]));
  const byOcc = new Map();
  for (const r of bookRows) {
    const key = `${r.slot_id}|${dateISO(r.slot_date)}`;
    if (!byOcc.has(key)) byOcc.set(key, []);
    byOcc.get(key).push(r);
  }
  const minDays = Number(st.min_days_ahead || 1);
  const maxWeeks = Number(st.max_weeks_ahead || 6);
  const out = slots.filter(slot => slot.active !== false).map(slot => {
    const date = dateForWeekDay(weekStart, slot.day);
    const key = `${slot.id}|${date}`;
    const o = occMap.get(key);
    const base = o || slot;
    const bookings = byOcc.get(key) || [];
    const active = bookings.filter(b => b.status === 'active');
    const cancelledStudents = bookings.filter(b => b.status !== 'active');
    const capacity = Number(base.capacity || 0);
    const cx = cxMap.get(key);
    const classroom = base.classroom || effectiveClassroom(base, st);
    const item = {
      id: slot.id, date, day: Number(base.day || slot.day), start_time: base.start_time, end_time: base.end_time,
      level: base.level, teacher_id: base.teacher_id, teacher_name: base.teacher_name || slot.teacher_name || '', classroom,
      capacity, recurring_capacity: Number(slot.capacity || 0), booked: active.length, remaining: capacity > 0 ? Math.max(0, capacity - active.length) : null,
      full: capacity > 0 && active.length >= capacity,
      cancelled: !!slot.cancelled || !!cx, cancel_note: cx?.note || slot.cancel_note || '',
      own: viewer.type === 'teacher' ? Number(base.teacher_id) === Number(viewer.id) : false,
      new_count: viewer.type === 'teacher' && Number(base.teacher_id) === Number(viewer.id) ? (unreadBySlot.get(key) || 0) : 0,
      ended: sessionHasEnded(date, base.end_time),
    };
    if (viewer.type === 'teacher') {
      item.students = active.map(b => ({ id: b.student_id, first_name: b.current_first || b.first_name, last_name: b.current_last || b.last_name, level: b.current_level || b.student_level, topic: b.topic || '' }));
      item.cancelled_students = cancelledStudents.map(b => ({ id: b.student_id, first_name: b.current_first || b.first_name, last_name: b.current_last || b.last_name, level: b.current_level || b.student_level, topic: b.topic || '', status: b.status }));
    }
    if (viewer.type === 'student') {
      const mine = bookings.find(b => Number(b.student_id) === Number(viewer.id));
      const activeMine = bookings.find(b => Number(b.student_id) === Number(viewer.id) && b.status === 'active');
      item.mine_status = activeMine ? 'active' : (mine ? 'cancelled_previous' : null);
      item.allowed = levelAllowed(st.level_rule, viewer.level, item.level);
      item.bookable = !sessionHasStarted(date, item.start_time) && dateBookable(date, minDays, maxWeeks) && item.allowed && !item.cancelled && !item.full && !activeMine;
    }
    return item;
  });
  /* If the recurring slot was later moved to a different weekday/time, a
     booked historical occurrence can legitimately sit on a date that no longer
     matches the slot's current weekday. Keep that history visible in weekly
     Teacher/Student views instead of silently hiding it. */
  const slotMap = new Map(slots.map(s => [Number(s.id), s]));
  for (const o of occs) {
    const slot = slotMap.get(Number(o.slot_id));
    if (!slot) continue;
    const date = dateISO(o.slot_date);
    if (slot.active !== false && date === dateForWeekDay(weekStart, slot.day)) continue;
    const key = `${slot.id}|${date}`;
    const bookings = byOcc.get(key) || [];
    const cx = cxMap.get(key);
    if (!bookings.length && !cx) continue;
    if (viewer.type === 'student' && slot.active === false && !bookings.some(b => Number(b.student_id) === Number(viewer.id))) continue;
    const active = bookings.filter(b => b.status === 'active');
    const cancelledStudents = bookings.filter(b => b.status !== 'active');
    const capacity = Number(o.capacity || 0);
    const item = {
      id: slot.id, date, day: Number(o.day), start_time: o.start_time, end_time: o.end_time,
      level: o.level, teacher_id: o.teacher_id, teacher_name: o.teacher_name || '',
      classroom: o.classroom || effectiveClassroom(o, st), capacity,
      recurring_capacity: Number(slot.capacity || 0), booked: active.length,
      remaining: capacity > 0 ? Math.max(0, capacity - active.length) : null,
      full: capacity > 0 && active.length >= capacity,
      cancelled: !!cx, cancel_note: cx?.note || '',
      own: viewer.type === 'teacher' ? Number(o.teacher_id) === Number(viewer.id) : false,
      new_count: viewer.type === 'teacher' && Number(o.teacher_id) === Number(viewer.id) ? (unreadBySlot.get(key) || 0) : 0,
      ended: sessionHasEnded(date, o.end_time), historical_occurrence: true,
    };
    if (viewer.type === 'teacher') {
      item.students = active.map(b => ({ id: b.student_id, first_name: b.current_first || b.first_name, last_name: b.current_last || b.last_name, level: b.current_level || b.student_level, topic: b.topic || '' }));
      item.cancelled_students = cancelledStudents.map(b => ({ id: b.student_id, first_name: b.current_first || b.first_name, last_name: b.current_last || b.last_name, level: b.current_level || b.student_level, topic: b.topic || '', status: b.status }));
    }
    if (viewer.type === 'student') {
      const mine = bookings.find(b => Number(b.student_id) === Number(viewer.id));
      const activeMine = bookings.find(b => Number(b.student_id) === Number(viewer.id) && b.status === 'active');
      item.mine_status = activeMine ? 'active' : (mine ? 'cancelled_previous' : null);
      item.allowed = levelAllowed(st.level_rule, viewer.level, item.level);
      item.bookable = slot.active !== false && !sessionHasStarted(date, item.start_time) && dateBookable(date, minDays, maxWeeks) && item.allowed && !item.cancelled && !item.full && !activeMine;
    }
    out.push(item);
  }
  out.sort((a, b) => (a.date + a.start_time + String(a.id)).localeCompare(b.date + b.start_time + String(b.id)));
  return { week_start: weekStart, week_end: weekEnd, revision: Number(st.data_revision || 1), min_days_ahead: minDays, max_weeks_ahead: maxWeeks, level_rule: st.level_rule, slots: out };
}

async function slotsWithMeta(minDaysAhead) {
  const st = await db.getSettings();
  const { rows: slots } = await db.q(`SELECT s.*,t.name AS teacher_name FROM slots s LEFT JOIN teachers t ON t.id=s.teacher_id WHERE s.active=true ORDER BY s.day,s.start_time,s.id`);
  const targets = slots.map(s => ({ slot: s, date: nextDateForDay(s.day, minDaysAhead) }));
  const weeks = [...new Set(targets.map(x => mondayOf(x.date)))];
  const schedules = new Map();
  for (const w of weeks) schedules.set(w, await scheduleForWeek(w));
  return targets.map(({ slot, date }) => {
    const week = schedules.get(mondayOf(date));
    return week.slots.find(x => x.id === slot.id && x.date === date) || {
      ...slot, date, booked: 0, full: false, cancelled: !!slot.cancelled,
      classroom: effectiveClassroom(slot, st), teacher_name: slot.teacher_name || '',
    };
  });
}

async function lockScheduleConfig(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('schedule:config'))");
}

async function lockOccurrences(client, occurrences) {
  const keys = [...new Map(occurrences.map(x => [`${x.date}|${Number(x.slot_id)}`, { slot_id: Number(x.slot_id), date: x.date }])).values()]
    .sort((a,b) => a.date.localeCompare(b.date) || a.slot_id - b.slot_id);
  for (const x of keys) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`slot:${x.slot_id}:${x.date}`]);
}

async function clearFutureTeacherAssignments(client, teacherId, reason = 'Öğretmen ataması kaldırıldı') {
  const today = localDateParts().date;
  const { rows: affectedRows } = await client.query(`
    SELECT DISTINCT bs.slot_id, bs.slot_date::text AS date, bs.student_id
      FROM booking_slots bs
     WHERE bs.teacher_id=$1 AND bs.slot_date >= $2 AND bs.status='active' AND bs.slot_id IS NOT NULL`, [teacherId, today]);
  const { rows: occRows } = await client.query(`
    SELECT DISTINCT slot_id, slot_date::text AS date
      FROM slot_occurrences WHERE teacher_id=$1 AND slot_date >= $2`, [teacherId, today]);
  await lockOccurrences(client, [...affectedRows, ...occRows].map(r => ({ slot_id:r.slot_id, date:r.date })));

  await client.query('UPDATE slots SET teacher_id=NULL,updated_at=NOW() WHERE teacher_id=$1 AND active=true', [teacherId]);
  await client.query(`UPDATE slot_occurrences SET teacher_id=NULL,teacher_name='',updated_at=NOW()
    WHERE teacher_id=$1 AND slot_date >= $2`, [teacherId, today]);
  await client.query(`UPDATE booking_slots SET teacher_id=NULL,teacher_name='',updated_at=NOW()
    WHERE teacher_id=$1 AND slot_date >= $2`, [teacherId, today]);

  const students = [...new Set(affectedRows.filter(r=>r.student_id!==null&&r.student_id!==undefined).map(r => Number(r.student_id)).filter(Number.isInteger))];
  for (const studentId of students) {
    await notify(client, 'student', studentId, 'Etüt öğretmen ataması güncellendi', reason, 'schedule');
  }
  if (affectedRows.length || occRows.length) {
    await notify(client, 'all_teachers', null, 'Öğretmen ataması güncellendi', reason, 'schedule');
  }
  return { students:students.length, occurrences:new Set([...affectedRows,...occRows].map(r=>`${r.slot_id}|${r.date}`)).size };
}

async function createOrGetStudent(client, { first, last, phone, level }) {
  const key = db.identityKey(phone, first, last);
  const { rows: [existing] } = await client.query('SELECT * FROM students WHERE identity_key=$1 FOR UPDATE', [key]);
  if (existing) {
    if (!existing.active) throw httpError(403, 'Bu bilgilerle işlem yapılamıyor. Eğitim koordinatörüyle görüşün.');
    if (existing.level !== level) throw httpError(409, 'Bu bilgiler mevcut öğrenci kaydıyla eşleşmiyor. Eğitim koordinatörüyle görüşün.');
    return { student: existing, created: false };
  }
  const { rows: [student] } = await client.query(`INSERT INTO students(first_name,last_name,phone,level,identity_key)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(identity_key) DO UPDATE SET updated_at=students.updated_at
    RETURNING *`, [first, last, phone, level, key]);
  if (!student.active || student.level !== level) throw httpError(409, 'Bu bilgiler mevcut öğrenci kaydıyla eşleşmiyor. Eğitim koordinatörüyle görüşün.');
  return { student, created: true };
}

async function bookSelections(req, studentInput, selections, authenticatedStudentId = null) {
  const topic = String(studentInput?.topic || '').trim().slice(0, 200);
  if (!Array.isArray(selections) || !selections.length || selections.length > 20) throw httpError(400, 'En az bir etüt seçmelisiniz.');

  let publicIdentity = null;
  if (!authenticatedStudentId) {
    const first = cleanName(studentInput?.first_name), last = cleanName(studentInput?.last_name);
    const phone = cleanPhone(studentInput?.phone), level = String(studentInput?.level || '').toUpperCase();
    if (!nameOk(first) || !nameOk(last)) throw httpError(400, 'İsim ve soyisim geçerli harflerden oluşmalıdır.');
    if (!isValidTRPhone(phone)) throw httpError(400, 'Telefon 05XX XXX XX XX formatında olmalıdır.');
    if (!LEVELS.includes(level)) throw httpError(400, 'Geçersiz seviye.');
    publicIdentity = { first, last, phone, level };
  }

  const raw = selections.map(x => {
    const slot_id = positiveIntParam(x?.slot_id);
    if (!slot_id) throw httpError(400, 'Geçersiz etüt.');
    const date = x?.date ? requireISODate(x.date, 'Etüt tarihi') : null;
    return { slot_id, date };
  });
  const rawSeen = new Set();
  for (const x of raw) {
    const k = `${x.slot_id}|${x.date || ''}`;
    if (rawSeen.has(k)) throw httpError(400, 'Aynı etüt aynı tarih için birden fazla kez seçilemez.');
    rawSeen.add(k);
  }

  return db.tx(async client => {
    await lockScheduleConfig(client);
    const st = await db.getSettings(client);
    let student, createdStudent = false;
    if (authenticatedStudentId) {
      const { rows: [locked] } = await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE', [authenticatedStudentId]);
      if (!locked || !locked.active) throw httpError(401, 'Öğrenci oturumu artık geçerli değil.');
      student = locked;
    } else {
      const found = await createOrGetStudent(client, publicIdentity);
      student = found.student; createdStudent = found.created;
    }

    const ids = [...new Set(raw.map(x => x.slot_id))].sort((a,b)=>a-b);
    const { rows: slotRows } = await client.query(`SELECT s.*,t.name AS teacher_name
      FROM slots s LEFT JOIN teachers t ON t.id=s.teacher_id
      WHERE s.id=ANY($1::int[]) AND s.active=true ORDER BY s.id FOR SHARE OF s`, [ids]);
    const slotMap = new Map(slotRows.map(x => [Number(x.id), x]));
    if (slotRows.length !== ids.length) throw httpError(404, 'Seçilen etütlerden biri bulunamadı veya artık aktif değil.');

    const normalized = [];
    const normalizedSeen = new Set();
    for (const x of raw) {
      const slot = slotMap.get(x.slot_id);
      const date = x.date || nextDateForDay(slot.day, Number(st.min_days_ahead || 1));
      if (!validISODate(date)) throw httpError(400, 'Etüt tarihi geçersiz.');
      if (dayOfWeek(date) !== Number(slot.day)) {
        const { rows: [moved] } = await client.query('SELECT 1 FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2', [slot.id, date]);
        if (!moved) throw httpError(400, 'Etüt tarihi programla eşleşmiyor.');
      }
      if (!dateBookable(date, Number(st.min_days_ahead || 1), Number(st.max_weeks_ahead || 6))) throw httpError(400, 'Bu tarih kayıt penceresinin dışında.');
      const key = `${slot.id}|${date}`;
      if (normalizedSeen.has(key)) throw httpError(400, 'Aynı etüt aynı tarih için birden fazla kez seçilemez.');
      normalizedSeen.add(key);
      normalized.push({ slot_id: Number(slot.id), date, slot });
    }

    // One canonical order for all occurrence advisory locks prevents A→B/B→A deadlocks.
    await lockOccurrences(client, normalized);

    const prepared = [];
    for (const x of normalized.sort((a,b)=>a.date.localeCompare(b.date)||a.slot_id-b.slot_id)) {
      const occ = await ensureOccurrence(client, x.slot, x.date, st);
      const { rows: [cx] } = await client.query('SELECT note FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2', [x.slot_id, x.date]);
      if (x.slot.cancelled || cx) throw httpError(409, `${fmtTR(x.date)} ${occ.start_time} etütü iptal edilmiştir.`);
      if (sessionHasStarted(x.date, occ.start_time)) throw httpError(409, 'Başlamış veya tamamlanmış bir etüde kayıt yapılamaz.');
      if (!levelAllowed(st.level_rule, student.level, occ.level)) throw httpError(400, `${occ.level} etütü seviyenize uygun değil.`);
      const { rows: [{ n }] } = await client.query(`SELECT COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND slot_date=$2 AND status='active'`, [x.slot_id, x.date]);
      if (Number(occ.capacity) > 0 && Number(n) >= Number(occ.capacity)) throw httpError(409, `${fmtTR(x.date)} ${occ.start_time} etütü dolu.`);
      const dup = await client.query(`SELECT 1 FROM booking_slots WHERE slot_id=$1 AND slot_date=$2 AND student_id=$3 AND status='active'`, [x.slot_id, x.date, student.id]);
      if (dup.rowCount) throw httpError(409, `${fmtTR(x.date)} ${occ.start_time} etütüne zaten kayıtlısınız.`);
      prepared.push({ ...x, occ });
    }

    // Reject overlap inside this request.
    for (let i=0;i<prepared.length;i++) for (let j=i+1;j<prepared.length;j++) {
      const a=prepared[i], b=prepared[j];
      if (a.date===b.date && a.occ.start_time < b.occ.end_time && b.occ.start_time < a.occ.end_time) {
        throw httpError(409, 'Aynı saatte çakışan iki etüt seçilemez.');
      }
    }
    // Reject overlap with the student's existing active bookings.
    for (const x of prepared) {
      const overlap = await client.query(`SELECT 1 FROM booking_slots
        WHERE student_id=$1 AND slot_date=$2 AND status='active' AND start_time < $4 AND $3 < end_time LIMIT 1`,
        [student.id, x.date, x.occ.start_time, x.occ.end_time]);
      if (overlap.rowCount) throw httpError(409, `${fmtTR(x.date)} tarihinde başka bir etüdünüzle saat çakışması var.`);
    }

    const { rows: [booking] } = await client.query(`INSERT INTO bookings(first_name,last_name,phone,level,topic,student_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [student.first_name, student.last_name, student.phone, student.level, topic, student.id]);
    for (const x of prepared) {
      await client.query(`INSERT INTO booking_slots(booking_id,slot_id,slot_date,day,start_time,end_time,level,teacher_name,student_id,teacher_id,classroom,capacity_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [booking.id, x.slot_id, x.date, x.occ.day, x.occ.start_time, x.occ.end_time, x.occ.level, x.occ.teacher_name || '', student.id, x.occ.teacher_id, x.occ.classroom || '', x.occ.capacity || 0]);
      if (x.occ.teacher_id) await notify(client, 'teacher', x.occ.teacher_id, 'Yeni etüt kaydı', `${student.first_name} ${student.last_name}, ${fmtTR(x.date)} ${x.occ.start_time} ${x.occ.level} etüdüne kayıt oldu.`, 'booking', x.slot_id, x.date);
      await notify(client, 'admin', 0, 'Yeni etüt kaydı', `${student.first_name} ${student.last_name} · ${fmtTR(x.date)} ${x.occ.start_time} · ${x.occ.level}`, 'booking', x.slot_id, x.date);
    }
    await notify(client, 'student', student.id, 'Etüt kaydınız oluşturuldu', `${prepared.length} etüt kaydınız başarıyla oluşturuldu.`, 'booking');
    await audit(client, 'student', student.id, 'booking_created', 'booking', booking.id, { count: prepared.length });
    await db.bumpRevisions(client, createdStudent ? ['booking','notification','account'] : ['booking','notification']);
    return { ok: true, booking_id: booking.id, student, selections: prepared.map(x => ({ slot_id:x.slot_id, date:x.date })),
      summary: prepared.map(x => ({ level:x.occ.level,date:x.date,day_tr:DAYS_TR[x.occ.day],day_en:DAYS_EN[x.occ.day],start_time:x.occ.start_time,end_time:x.occ.end_time,classroom:x.occ.classroom||'',teacher_name:x.occ.teacher_name||'' })) };
  });
}

app.get('/api/config', wrap(async (req, res) => {
  const st = await db.getSettings();
  const minDays = Number(st.min_days_ahead || 1);
  const slots = await slotsWithMeta(minDays);
  res.json({
    levels: LEVELS,
    slots: slots.map(s => ({ id: s.id, day: s.day, start_time: s.start_time, end_time: s.end_time, level: s.level,
      teacher_name: s.teacher_name || '', classroom: s.classroom || '', cancelled: !!s.cancelled, cancel_note: s.cancel_note || '',
      next_date: s.date, full: !!s.full, capacity: Number(s.capacity || 0), booked: Number(s.booked || 0) })),
    classroom_weekday: st.classroom_weekday, classroom_weekend: st.classroom_weekend,
    level_rule: st.level_rule, min_days_ahead: minDays, max_weeks_ahead: Number(st.max_weeks_ahead || 6), revision: Number(st.data_revision || 1),
  });
}));

app.post('/api/bookings', rateLimit('public-booking', 25, 10 * 60 * 1000), wrap(async (req, res) => {
  const ids = [...new Set((req.body.slot_ids || []).map(Number).filter(Number.isInteger))];
  const st = await db.getSettings();
  const { rows: slots } = await db.q('SELECT id,day FROM slots WHERE id = ANY($1::int[]) AND active=true', [ids]);
  if (slots.length !== ids.length) throw httpError(400, 'Seçilen etütlerden biri artık mevcut değil. Programı yenileyip tekrar deneyin.');
  const dayMap = new Map(slots.map(s => [s.id, s.day]));
  const selections = ids.map(id => ({ slot_id: id, date: nextDateForDay(dayMap.get(id), Number(st.min_days_ahead || 1)) }));
  const data = await bookSelections(req, req.body, selections);
  setSessionCookie(req,res,STUDENT_COOKIE,{role:'student',id:data.student.id,sv:data.student.session_version},SESSION_30D);
  res.json({ok:true,booking_id:data.booking_id,summary:data.summary,student_id:data.student.id});
}));

/* ----------------------------- student auth/panel ----------------------------- */
const student = express.Router();
app.post('/api/student/login', rateLimit('student-login', 30, 10 * 60 * 1000), wrap(async (req, res) => {
  const first = cleanName(req.body.first_name), last = cleanName(req.body.last_name), phone = cleanPhone(req.body.phone), level = String(req.body.level || '').toUpperCase();
  if (!nameOk(first) || !nameOk(last) || !isValidTRPhone(phone) || !LEVELS.includes(level)) throw httpError(400, 'Bilgilerinizi kontrol edin.');
  const key = db.identityKey(phone, first, last);
  const { rows: [s] } = await db.q('SELECT * FROM students WHERE identity_key=$1', [key]);
  if (!s || s.level !== level) throw httpError(401, 'Bu bilgilerle eşleşen öğrenci kaydı bulunamadı. İlk etüt kaydınızı ana sayfadan oluşturabilirsiniz.');
  if (!s.active) throw httpError(403, 'Öğrenci paneli erişiminiz yönetici tarafından devre dışı bırakılmıştır.');
  setSessionCookie(req, res, STUDENT_COOKIE, { role: 'student', id: s.id, sv: s.session_version }, SESSION_30D);
  await db.tx(c => audit(c, 'student', s.id, 'login', 'student', s.id));
  res.json({ ok: true });
}));
app.post('/api/student/logout', (req, res) => { clearCookie(res, STUDENT_COOKIE); res.json({ ok: true }); });
app.get('/api/student/me', wrap(async (req, res) => {
  const p = verify(req.cookies[STUDENT_COOKIE]);
  if (!p || p.role !== 'student') return res.json({ student: null });
  const { rows: [s] } = await db.q('SELECT id,first_name,last_name,phone,level,active,session_version FROM students WHERE id=$1', [p.id]);
  res.json({ student: s && s.active && Number(s.session_version) === Number(p.sv) ? s : null });
}));
student.use(wrap(requireStudent));
student.get('/dashboard', wrap(async (req, res) => {
  const week = await scheduleForWeek(req.query.week, { type: 'student', id: req.student.id, level: req.student.level });
  const { rows: mine } = await db.q(`SELECT bs.id,bs.slot_id,bs.slot_date,bs.day,bs.start_time,bs.end_time,bs.level,bs.teacher_name,bs.classroom,bs.status,bs.cancel_note,
      CASE WHEN sc.id IS NOT NULL THEN true ELSE false END AS occurrence_cancelled, sc.note AS occurrence_cancel_note,
      (SELECT COUNT(*)::int FROM booking_slots x WHERE x.slot_id=bs.slot_id AND x.slot_date=bs.slot_date AND x.status='active') AS booked,
      COALESCE(so.capacity,bs.capacity_snapshot,0) AS capacity
    FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id
    LEFT JOIN slot_cancellations sc ON sc.slot_id=bs.slot_id AND sc.slot_date=bs.slot_date
    LEFT JOIN slot_occurrences so ON so.slot_id=bs.slot_id AND so.slot_date=bs.slot_date
    WHERE bs.student_id=$1 AND b.status<>'deleted_by_admin'
    ORDER BY bs.slot_date DESC,bs.start_time`, [req.student.id]);
  const categorized = mine.map(x => ({ ...x, slot_date: dateISO(x.slot_date), state:
    x.status !== 'active' ? 'cancelled' : x.occurrence_cancelled ? 'cancelled_by_admin' : sessionHasEnded(dateISO(x.slot_date), x.end_time) ? 'completed' : 'upcoming' }));
  const notifications = await viewerNotifications('student', req.student.id, 60, null, req.student.created_at);
  const { rows: [phoneRequest] } = await db.q(`SELECT * FROM phone_change_requests WHERE student_id=$1 AND status='pending' ORDER BY requested_at DESC LIMIT 1`, [req.student.id]);
  res.json({ student: { id: req.student.id, first_name: req.student.first_name, last_name: req.student.last_name, phone: req.student.phone, level: req.student.level }, week, bookings: categorized, notifications, phone_request: phoneRequest || null });
}));
student.post('/book', wrap(async (req, res) => {
  const selections = Array.isArray(req.body.selections) ? req.body.selections : [];
  const data = await bookSelections(req, { topic: req.body.topic || '' }, selections, req.student.id);
  res.json(data);
}));
student.post('/bookings/:id/cancel', wrap(async (req, res) => {
  const bsId = positiveIntParam(req.params.id);
  if (!bsId) throw httpError(400, 'Geçersiz kayıt numarası.');
  const result = await db.tx(async client => {
    const { rows:[lockedStudent] } = await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE', [req.student.id]);
    if (!lockedStudent || !lockedStudent.active) throw httpError(401, 'Öğrenci oturumu artık geçerli değil.');
    const { rows: [peek] } = await client.query(`SELECT bs.*,b.topic FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id
      WHERE bs.id=$1 AND bs.student_id=$2`, [bsId, lockedStudent.id]);
    if (!peek) throw httpError(404, 'Etüt kaydı bulunamadı.');
    const date = requireISODate(dateISO(peek.slot_date), 'Etüt tarihi');
    if (peek.slot_id) await lockOccurrences(client, [{ slot_id: peek.slot_id, date }]);
    const { rows: [row] } = await client.query(`SELECT bs.*,b.topic FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id
      WHERE bs.id=$1 AND bs.student_id=$2 FOR UPDATE OF bs`, [bsId, lockedStudent.id]);
    if (!row) throw httpError(404, 'Etüt kaydı bulunamadı.');
    if (row.status !== 'active') throw httpError(409, 'Bu kayıt zaten iptal edilmiş.');
    if (sessionHasEnded(date, row.end_time)) throw httpError(409, 'Tamamlanmış bir etüt iptal edilemez.');
    await client.query(`UPDATE booking_slots SET status='cancelled_by_student',cancelled_at=NOW(),cancel_note='Öğrenci tarafından iptal edildi',updated_at=NOW() WHERE id=$1`, [bsId]);
    if (row.teacher_id) await notify(client, 'teacher', row.teacher_id, 'Öğrenci kaydını iptal etti', `${lockedStudent.first_name} ${lockedStudent.last_name}, ${fmtTR(date)} ${row.start_time} ${row.level} etüdündeki kaydını iptal etti.`, 'cancellation', row.slot_id, date);
    await notify(client, 'admin', 0, 'Öğrenci etüt iptali', `${lockedStudent.first_name} ${lockedStudent.last_name} · ${fmtTR(date)} ${row.start_time} · ${row.level}`, 'cancellation', row.slot_id, date);
    await notify(client, 'student', lockedStudent.id, 'Etüt kaydınız iptal edildi', `${fmtTR(date)} ${row.start_time} ${row.level} etüt kaydınız iptal edildi.`, 'cancellation', row.slot_id, date);
    await audit(client, 'student', lockedStudent.id, 'booking_cancelled', 'booking_slot', bsId, { slot_id: row.slot_id, date });
    await db.bumpRevisions(client, ['booking','notification']);
    return row;
  });
  res.json({ ok: true, slot_id: result.slot_id });
}));
student.put('/profile', wrap(async (req, res) => {
  const first = cleanName(req.body.first_name), last = cleanName(req.body.last_name);
  if (!nameOk(first) || !nameOk(last)) throw httpError(400, 'İsim ve soyisim geçerli harflerden oluşmalıdır.');
  await db.tx(async client => {
    const { rows:[current] } = await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE', [req.student.id]);
    if (!current || !current.active) throw httpError(404, 'Öğrenci bulunamadı.');
    const key = db.identityKey(current.phone, first, last);
    const exists = await client.query('SELECT 1 FROM students WHERE identity_key=$1 AND id<>$2', [key, current.id]);
    if (exists.rowCount) throw httpError(409, 'Bu bilgiler başka bir öğrenci profiliyle çakışıyor.');
    await client.query('UPDATE students SET first_name=$1,last_name=$2,identity_key=$3,updated_at=NOW() WHERE id=$4', [first, last, key, current.id]);
    await client.query('UPDATE bookings SET first_name=$1,last_name=$2 WHERE student_id=$3', [first, last, current.id]);
    await audit(client, 'student', current.id, 'profile_name_changed', 'student', current.id);
    await db.bumpRevisions(client, ['account','booking']);
  });
  res.json({ ok: true });
}));
student.post('/phone-change', wrap(async (req, res) => {
  const newPhone = cleanPhone(req.body.phone);
  if (!isValidTRPhone(newPhone)) throw httpError(400, 'Telefon 05XX XXX XX XX formatında olmalıdır.');
  await db.tx(async client => {
    const { rows:[current] } = await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE', [req.student.id]);
    if (!current || !current.active) throw httpError(404, 'Öğrenci bulunamadı.');
    if (newPhone === current.phone) throw httpError(400, 'Yeni telefon numarası mevcut numarayla aynı.');
    await client.query("UPDATE phone_change_requests SET status='superseded',resolved_at=NOW() WHERE student_id=$1 AND status='pending'", [current.id]);
    await client.query(`INSERT INTO phone_change_requests(student_id,old_phone,new_phone) VALUES($1,$2,$3)`, [current.id, current.phone, newPhone]);
    await notify(client, 'admin', 0, 'Telefon değişikliği onayı', `${current.first_name} ${current.last_name}: ***${current.phone.slice(-4)} → ***${newPhone.slice(-4)}`, 'account');
    await audit(client, 'student', current.id, 'phone_change_requested', 'student', current.id, { new_phone_last4: newPhone.slice(-4) });
    await db.bumpRevisions(client, ['account','notification']);
  });
  res.json({ ok: true });
}));
student.post('/notifications/:id/read', wrap(async (req, res) => { const id=positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz bildirim.'); await markNotification('student', req.student.id, id); res.json({ ok: true }); }));
student.get('/notifications', wrap(async (req,res)=>{
  const before=positiveIntParam(req.query.before_id);
  const items=await viewerNotifications('student',req.student.id,Number(req.query.limit)||40,before,req.student.created_at);
  res.json({items,next_before:items.length?items[items.length-1].id:null});
}));
student.get('/sync-state', wrap(async (req,res)=>res.json(await db.getSyncState())));
app.use('/api/student', student);

/* ----------------------------- teacher auth/panel ----------------------------- */
app.post('/api/teacher/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!validUsername(username) || !password) throw httpError(401, 'Kullanıcı adı veya şifre hatalı.');
  const { rows: [lock] } = await db.q("SELECT * FROM auth_lockouts WHERE actor_type='teacher' AND actor_key=$1", [username]);
  if (lock?.locked_until && new Date(lock.locked_until) > new Date()) throw httpError(423, 'Çok fazla başarısız deneme. Hesap geçici olarak kilitlendi; yönetici kilidi kaldırabilir.');
  if (lock?.locked_until && new Date(lock.locked_until) <= new Date()) {
    await db.q("UPDATE auth_lockouts SET failed_count=0,locked_until=NULL,updated_at=NOW() WHERE actor_type='teacher' AND actor_key=$1", [username]);
  }
  const { rows: [t] } = await db.q('SELECT * FROM teachers WHERE LOWER(username)=$1', [username]);
  if (!t || !t.active || t.deleted_at || !passwordMatches(password, t.password_salt, t.password_hash)) {
    const { rows: [state] } = await db.q(`INSERT INTO auth_lockouts(actor_type,actor_key,failed_count,updated_at)
      VALUES('teacher',$1,1,NOW()) ON CONFLICT(actor_type,actor_key) DO UPDATE SET failed_count=auth_lockouts.failed_count+1,updated_at=NOW() RETURNING failed_count`, [username]);
    if (state.failed_count >= 5) await db.q("UPDATE auth_lockouts SET locked_until=NOW()+INTERVAL '15 minutes' WHERE actor_type='teacher' AND actor_key=$1", [username]);
    throw httpError(state.failed_count >= 5 ? 423 : 401, state.failed_count >= 5 ? 'Hesap 15 dakika kilitlendi. Yönetici kilidi kaldırabilir.' : 'Kullanıcı adı veya şifre hatalı.');
  }
  await db.q("DELETE FROM auth_lockouts WHERE actor_type='teacher' AND actor_key=$1", [username]);
  setSessionCookie(req, res, TEACHER_COOKIE, { role: 'teacher', id: t.id, sv: t.session_version }, SESSION_12H);
  await db.tx(c => audit(c, 'teacher', t.id, 'login', 'teacher', t.id));
  res.json({ ok: true });
}));
app.post('/api/teacher/logout', (req, res) => { clearCookie(res, TEACHER_COOKIE); res.json({ ok: true }); });
app.get('/api/teacher/me', wrap(async (req, res) => {
  const p = verify(req.cookies[TEACHER_COOKIE]);
  if (!p || p.role !== 'teacher') return res.json({ teacher: null });
  const { rows: [t] } = await db.q('SELECT id,name,username,active,session_version,deleted_at FROM teachers WHERE id=$1', [p.id]);
  res.json({ teacher: t && t.active && !t.deleted_at && Number(t.session_version) === Number(p.sv) ? t : null });
}));
const teacher = express.Router();
teacher.use(wrap(requireTeacher));
teacher.get('/dashboard', wrap(async (req, res) => {
  const week = await scheduleForWeek(req.query.week, { type: 'teacher', id: req.teacher.id });
  const today = localDateParts().date;
  const currentWeek = await scheduleForWeek(mondayOf(today), { type: 'teacher', id: req.teacher.id });
  const ownToday = currentWeek.slots.filter(s => s.own && s.date === today && !s.cancelled);
  const ownWeek = currentWeek.slots.filter(s => s.own && !s.cancelled);
  const todayStudentIds = new Set(ownToday.flatMap(s => (s.students || []).map(x => x.id).filter(Boolean)));
  const weekStudentIds = new Set(ownWeek.flatMap(s => (s.students || []).map(x => x.id).filter(Boolean)));
  const stats = {
    today_etuts: ownToday.length,
    today_students: todayStudentIds.size,
    upcoming_etuts: ownWeek.filter(s => !s.ended && s.date >= today).length,
    week_students: weekStudentIds.size,
  };
  const notifications = await viewerNotifications('teacher', req.teacher.id, 60, null, req.teacher.created_at);
  res.json({ teacher: { id: req.teacher.id, name: req.teacher.name, username: req.teacher.username }, stats, week, notifications });
}));
teacher.post('/notifications/:id/read', wrap(async (req, res) => { const id=positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz bildirim.'); await markNotification('teacher', req.teacher.id, id); res.json({ ok: true }); }));
teacher.get('/notifications', wrap(async (req,res)=>{ const before=positiveIntParam(req.query.before_id); const items=await viewerNotifications('teacher',req.teacher.id,Number(req.query.limit)||40,before,req.teacher.created_at); res.json({items,next_before:items.length?items[items.length-1].id:null}); }));
teacher.get('/sync-state', wrap(async (req,res)=>res.json(await db.getSyncState())));
teacher.post('/slots/:id/read', wrap(async (req, res) => {
  const slotId = positiveIntParam(req.params.id), date = requireISODate(req.body.date, 'Etüt tarihi');
  if(!slotId) throw httpError(400,'Geçersiz etüt.');
  await db.q(`INSERT INTO notification_reads(notification_id,viewer_type,viewer_id)
    SELECT id,'teacher',$1 FROM panel_notifications
     WHERE target_type='teacher' AND target_id=$1 AND slot_id=$2 AND slot_date=$3
    ON CONFLICT DO NOTHING`, [req.teacher.id, slotId, date]);
  res.json({ ok: true });
}));
app.use('/api/teacher', teacher);

/* ----------------------------- admin auth ----------------------------- */
const adminAttempt = new Map();
function adminRateKey(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
app.post('/api/admin/login', wrap(async (req, res) => {
  const key = adminRateKey(req), now = Date.now(), state = adminAttempt.get(key) || { n: 0, until: 0 };
  if (state.until > now) throw httpError(429, 'Çok fazla başarısız deneme. Birkaç dakika sonra tekrar deneyin.');
  const st = await db.getSettings();
  const supplied = String(req.body?.password ?? '');
  const ok = !!(st.admin_password_hash && st.admin_password_salt) && passwordMatches(supplied, st.admin_password_salt, st.admin_password_hash);
  if (!ok) {
    state.n += 1; if (state.n >= 8) { state.until = now + 10 * 60 * 1000; state.n = 0; }
    adminAttempt.set(key, state);
    await safeSystemLog({request_id:req.requestId,severity:'WARN',category:'security',source:'server',http_method:req.method,route:req.path,status_code:401,user_role:'admin',action:'admin_login_failed',message:'Failed Admin login attempt'});
    throw httpError(401, 'Hatalı şifre');
  }
  adminAttempt.delete(key);
  setSessionCookie(req, res, ADMIN_COOKIE, { role: 'admin', id: 0, sv: Number(st.admin_session_version || 1) }, SESSION_12H);
  res.json({ ok: true });
}));
app.post('/api/admin/logout', (req, res) => { clearCookie(res, ADMIN_COOKIE); res.json({ ok: true }); });
app.get('/api/admin/me', wrap(async (req, res) => {
  const p = verify(req.cookies[ADMIN_COOKIE]);
  if (!p || p.role !== 'admin') return res.json({admin:false});
  const st=await db.getSettings();
  res.json({admin:Number(p.sv)===Number(st.admin_session_version||1)});
}));

const admin = express.Router();
admin.use(wrap(requireAdmin));

function safeSettings(st) {
  const allowed = ['coordinator_name','classroom_weekday','classroom_weekend','level_rule','min_days_ahead','max_weeks_ahead','branch_name','panel_change_message','data_revision','schedule_revision','booking_revision','account_revision','notification_revision'];
  return Object.fromEntries(allowed.map(k => [k, st[k] ?? '']));
}
admin.get('/overview', wrap(async (req, res) => {
  const st = await db.getSettings();
  const minDays = Number(st.min_days_ahead || 1);
  const slots = await slotsWithMeta(minDays);
  const { rows: teachers } = await db.q(`SELECT id,name,phone,note,username,active,session_version,created_at,deleted_at FROM teachers ORDER BY deleted_at NULLS FIRST,name`);
  const { rows: recurringAssignments } = await db.q(`SELECT id,day,start_time,end_time,level,teacher_id,classroom,capacity FROM slots WHERE active=true ORDER BY day,start_time,id`);
  for (const t of teachers) t.assignments = recurringAssignments.filter(x=>Number(x.teacher_id)===Number(t.id));
  const { rows: bookings } = await db.q(`SELECT b.*,COALESCE(json_agg(json_build_object(
      'id',bs.id,'date',bs.slot_date,'day',bs.day,'start',bs.start_time,'end',bs.end_time,'level',bs.level,'teacher',bs.teacher_name,'classroom',bs.classroom,'status',bs.status,'cancel_note',bs.cancel_note)
      ORDER BY bs.slot_date,bs.start_time) FILTER(WHERE bs.id IS NOT NULL),'[]') slots
    FROM bookings b LEFT JOIN booking_slots bs ON bs.booking_id=b.id WHERE b.status<>'deleted_by_admin'
    GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`);
  const { rows: students } = await db.q(`SELECT s.*,
      (SELECT COUNT(*)::int FROM booking_slots bs WHERE bs.student_id=s.id AND bs.status='active') AS active_bookings,
      (SELECT COUNT(*)::int FROM booking_slots bs WHERE bs.student_id=s.id) AS total_slots
    FROM students s ORDER BY s.updated_at DESC LIMIT 50`);
  const { rows: phoneRequests } = await db.q(`SELECT p.*,s.first_name,s.last_name FROM phone_change_requests p JOIN students s ON s.id=p.student_id WHERE p.status='pending' ORDER BY p.requested_at`);
  const { rows: auditRows } = await db.q('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
  const notifications = await viewerNotifications('admin', 0, 50);
  const nowParts=localDateParts();
  const { rows: [counts] } = await db.q(`SELECT
    (SELECT COUNT(*)::int FROM bookings WHERE status<>'deleted_by_admin') total_bookings,
    (SELECT COUNT(*)::int FROM students) total_students,
    (SELECT COUNT(*)::int FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id
      WHERE b.status<>'deleted_by_admin' AND bs.status='active'
        AND (bs.slot_date > $1::date OR (bs.slot_date=$1::date AND bs.end_time::time > $2::time))) upcoming_participations,
    (SELECT COUNT(*)::int FROM system_logs WHERE resolved=false AND severity IN ('ERROR','CRITICAL')) unresolved_errors,
    (SELECT COUNT(*)::int FROM system_logs WHERE resolved=false AND severity='CRITICAL') unresolved_critical`, [nowParts.date, nowParts.time]);
  const slotsForAdmin = slots.map(s => ({ ...s, next_date: s.date, date_cancelled: !!s.cancelled, legacy_cancelled: false }));
  res.json({ settings: safeSettings(st), slots: slotsForAdmin, teachers, bookings, students, phone_requests: phoneRequests, audit: auditRows, notifications,
    total_bookings: counts.total_bookings, total_students: counts.total_students, upcoming_participations: counts.upcoming_participations, log_summary:{unresolved_errors:counts.unresolved_errors,unresolved_critical:counts.unresolved_critical},
    levels: LEVELS, site_url: `${req.protocol}://${req.get('host')}` });
}));

admin.get('/bookings', wrap(async(req,res)=>{
  const page=Math.max(1,Number(req.query.page)||1), limit=Math.min(100,Math.max(10,Number(req.query.limit)||50)), off=(page-1)*limit;
  const qv=String(req.query.q||'').trim(), status=String(req.query.status||'').trim();
  const like=escLike(qv);
  const where=["b.status<>'deleted_by_admin'"]; const params=[];
  if(qv){params.push(like);where.push(`(b.first_name ILIKE $${params.length} ESCAPE '\\' OR b.last_name ILIKE $${params.length} ESCAPE '\\' OR b.phone ILIKE $${params.length} ESCAPE '\\' OR b.topic ILIKE $${params.length} ESCAPE '\\')`);}
  if(status){params.push(status);where.push(`EXISTS(SELECT 1 FROM booking_slots z WHERE z.booking_id=b.id AND z.status=$${params.length})`);}
  const {rows:[c]}=await db.q(`SELECT COUNT(*)::int total FROM bookings b WHERE ${where.join(' AND ')}`,params);
  const p2=[...params,limit,off], li=p2.length-1, oi=p2.length;
  const {rows:items}=await db.q(`SELECT b.*,COALESCE(json_agg(json_build_object('id',bs.id,'date',bs.slot_date,'day',bs.day,'start',bs.start_time,'end',bs.end_time,'level',bs.level,'teacher',bs.teacher_name,'classroom',bs.classroom,'status',bs.status,'cancel_note',bs.cancel_note) ORDER BY bs.slot_date,bs.start_time) FILTER(WHERE bs.id IS NOT NULL),'[]') slots
    FROM bookings b LEFT JOIN booking_slots bs ON bs.booking_id=b.id WHERE ${where.join(' AND ')} GROUP BY b.id ORDER BY b.created_at DESC LIMIT $${li} OFFSET $${oi}`,p2);
  res.json({items,total:c.total,page,limit,pages:Math.max(1,Math.ceil(c.total/limit))});
}));
admin.get('/students', wrap(async(req,res)=>{
  const page=Math.max(1,Number(req.query.page)||1), limit=Math.min(100,Math.max(10,Number(req.query.limit)||50)), off=(page-1)*limit;
  const qv=String(req.query.q||'').trim(), params=[], where=[];
  if(qv){params.push(escLike(qv));where.push(`(s.first_name ILIKE $1 ESCAPE '\\' OR s.last_name ILIKE $1 ESCAPE '\\' OR s.phone ILIKE $1 ESCAPE '\\' OR s.level ILIKE $1 ESCAPE '\\')`);}
  const wh=where.length?'WHERE '+where.join(' AND '):'';
  const {rows:[c]}=await db.q(`SELECT COUNT(*)::int total FROM students s ${wh}`,params);
  const p2=[...params,limit,off], li=p2.length-1, oi=p2.length;
  const {rows:items}=await db.q(`SELECT s.*,(SELECT COUNT(*)::int FROM booking_slots bs WHERE bs.student_id=s.id AND bs.status='active') active_bookings,(SELECT COUNT(*)::int FROM booking_slots bs WHERE bs.student_id=s.id) total_slots FROM students s ${wh} ORDER BY s.updated_at DESC LIMIT $${li} OFFSET $${oi}`,p2);
  res.json({items,total:c.total,page,limit,pages:Math.max(1,Math.ceil(c.total/limit))});
}));
admin.get('/students/:id/bookings', wrap(async(req,res)=>{
  const id=positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz öğrenci.');
  const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(10,Number(req.query.limit)||50)),off=(page-1)*limit;
  const {rows:[exists]}=await db.q('SELECT id FROM students WHERE id=$1',[id]); if(!exists) throw httpError(404,'Öğrenci bulunamadı.');
  const {rows:[c]}=await db.q(`SELECT COUNT(*)::int total FROM booking_slots WHERE student_id=$1`,[id]);
  const {rows:items}=await db.q(`SELECT bs.*,b.topic,b.status booking_status FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id WHERE bs.student_id=$1 ORDER BY bs.slot_date DESC,bs.start_time DESC LIMIT $2 OFFSET $3`,[id,limit,off]);
  res.json({items,total:c.total,page,limit,pages:Math.max(1,Math.ceil(c.total/limit))});
}));
admin.get('/notifications', wrap(async(req,res)=>{ const before=positiveIntParam(req.query.before_id); const items=await viewerNotifications('admin',0,Number(req.query.limit)||40,before); res.json({items,next_before:items.length?items[items.length-1].id:null}); }));
admin.get('/sync-state', wrap(async(req,res)=>res.json(await db.getSyncState())));

admin.put('/settings', wrap(async (req, res) => {
  const allowed = ['coordinator_name','classroom_weekday','classroom_weekend','level_rule','min_days_ahead','max_weeks_ahead','branch_name','panel_change_message'];
  const body = { ...req.body };
  for (const k of ['coordinator_name','classroom_weekday','classroom_weekend','branch_name','panel_change_message']) if (body[k] !== undefined) body[k] = String(body[k] ?? '').trim();
  if (body.level_rule !== undefined && !['own','own_next','own_adjacent','all'].includes(String(body.level_rule))) throw httpError(400, 'Geçersiz seviye kuralı.');
  if (body.min_days_ahead !== undefined) { const d=Number(body.min_days_ahead); if(!Number.isInteger(d)||d<0||d>14) throw httpError(400,'En erken kayıt günü 0–14 arasında olmalı.'); body.min_days_ahead=String(d); }
  if (body.max_weeks_ahead !== undefined) { const d=Number(body.max_weeks_ahead); if(!Number.isInteger(d)||d<1||d>52) throw httpError(400,'Maksimum kayıt ufku 1–52 hafta arasında olmalı.'); body.max_weeks_ahead=String(d); }
  if (body.coordinator_name?.length > 100 || body.branch_name?.length > 100 || body.classroom_weekday?.length > 120 || body.classroom_weekend?.length > 120 || body.panel_change_message?.length > 500) throw httpError(400, 'Ayar alanlarından biri izin verilen uzunluğu aşıyor.');
  let newAdminSessionVersion=null;
  await db.tx(async client => {
    await lockScheduleConfig(client);
    const before = await db.getSettings(client);
    const candidateSettings={...before,...Object.fromEntries(allowed.filter(k=>k in body).map(k=>[k,String(body[k])]))};
    if (body.classroom_weekday !== undefined || body.classroom_weekend !== undefined) await validateAllClassroomConflicts(client,candidateSettings);
    for (const k of allowed) if (k in body) await db.setSetting(k, body[k], client);
    if (body.admin_password !== undefined) {
      const pw = String(body.admin_password || '');
      if (pw.length < 8 || pw === db.KNOWN_UNSAFE_ADMIN_PASSWORD) throw httpError(400, 'Yönetici şifresi en az 8 karakter olmalı ve eski varsayılan şifre kullanılamaz.');
      const hp = hashPassword(pw);
      await db.setSetting('admin_password_hash', hp.hash, client);
      await db.setSetting('admin_password_salt', hp.salt, client);
      await db.setSetting('admin_password', '', client);
      const next=Number(before.admin_session_version||1)+1; await db.setSetting('admin_session_version',String(next),client); newAdminSessionVersion=next;
    }
    const weekdayChanged = body.classroom_weekday !== undefined && String(body.classroom_weekday) !== String(before.classroom_weekday || '');
    const weekendChanged = body.classroom_weekend !== undefined && String(body.classroom_weekend) !== String(before.classroom_weekend || '');
    if (weekdayChanged || weekendChanged) {
      const today = localDateParts().date;
      if (weekdayChanged) {
        await client.query(`UPDATE slot_occurrences o SET classroom=$1,updated_at=NOW() FROM slots s WHERE o.slot_id=s.id AND s.classroom='' AND o.day BETWEEN 1 AND 5 AND o.slot_date >= $2`, [String(body.classroom_weekday || ''), today]);
        await client.query(`UPDATE booking_slots bs SET classroom=$1,updated_at=NOW() FROM slots s WHERE bs.slot_id=s.id AND s.classroom='' AND bs.day BETWEEN 1 AND 5 AND bs.slot_date >= $2`, [String(body.classroom_weekday || ''), today]);
      }
      if (weekendChanged) {
        await client.query(`UPDATE slot_occurrences o SET classroom=$1,updated_at=NOW() FROM slots s WHERE o.slot_id=s.id AND s.classroom='' AND o.day BETWEEN 6 AND 7 AND o.slot_date >= $2`, [String(body.classroom_weekend || ''), today]);
        await client.query(`UPDATE booking_slots bs SET classroom=$1,updated_at=NOW() FROM slots s WHERE bs.slot_id=s.id AND s.classroom='' AND bs.day BETWEEN 6 AND 7 AND bs.slot_date >= $2`, [String(body.classroom_weekend || ''), today]);
      }
      const msg = String(body.panel_change_message ?? before.panel_change_message ?? 'Program eğitim koordinatörü tarafından güncellendi.');
      await notify(client,'all_students',null,'Sınıf bilgisi güncellendi',msg,'schedule'); await notify(client,'all_teachers',null,'Sınıf bilgisi güncellendi',msg,'schedule');
    }
    await audit(client, 'admin', 0, 'settings_updated', 'settings', 'global', { fields: Object.keys(body).filter(x => x !== 'admin_password') });
    const domains=[]; if(Object.keys(body).some(k=>['classroom_weekday','classroom_weekend','level_rule','min_days_ahead','max_weeks_ahead'].includes(k))) domains.push('schedule'); if(weekdayChanged||weekendChanged) domains.push('notification'); if(body.admin_password!==undefined) domains.push('account');
    await db.bumpRevisions(client, domains.length?domains:['account']);
  });
  if(newAdminSessionVersion) setSessionCookie(req,res,ADMIN_COOKIE,{role:'admin',id:0,sv:newAdminSessionVersion},SESSION_12H);
  res.json({ ok: true });
}));

/* teacher management */
admin.post('/teachers', wrap(async (req, res) => {
  const name = cleanName(req.body.name), username = String(req.body.username || '').trim();
  if (!nameOk(name)) throw httpError(400, 'Geçerli bir öğretmen adı girin.');
  if (!validUsername(username)) throw httpError(400, 'Kullanıcı adı 3–40 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir.');
  const temp = makePassword(), hp = hashPassword(temp), active = req.body.active !== false;
  try {
    const result = await db.tx(async client => {
      const { rows: [t] } = await client.query(`INSERT INTO teachers(name,phone,note,username,password_hash,password_salt,active)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,phone,note,username,active,session_version`, [name, cleanPhone(req.body.phone), String(req.body.note || '').trim().slice(0,200), username, hp.hash, hp.salt, active]);
      await audit(client, 'admin', 0, 'teacher_created', 'teacher', t.id, { username }); await db.bumpRevisions(client,['account']); return t;
    });
    res.json({ teacher: result, temporary_password: temp });
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'Bu kullanıcı adı zaten kullanılıyor.');
    throw e;
  }
}));
admin.put('/teachers/:id', wrap(async (req, res) => {
  const id = positiveIntParam(req.params.id), name = cleanName(req.body.name), username = String(req.body.username || '').trim();
  if (!id) throw httpError(400,'Geçersiz öğretmen.');
  if (!nameOk(name) || !validUsername(username)) throw httpError(400, 'Ad veya kullanıcı adı geçersiz.');
  try {
    const t = await db.tx(async client => {
      await lockScheduleConfig(client);
      const { rows: [current] } = await client.query('SELECT * FROM teachers WHERE id=$1 FOR UPDATE', [id]);
      if (!current) throw httpError(404, 'Öğretmen bulunamadı.');
      const active = req.body.active === undefined ? current.active : !!req.body.active;
      const temp = current.password_hash ? null : makePassword();
      const hp = temp ? hashPassword(temp) : { hash: current.password_hash, salt: current.password_salt };
      const bump = active !== current.active || username.toLowerCase() !== String(current.username||'').toLowerCase() || !!temp;
      const { rows: [updated] } = await client.query(`UPDATE teachers SET name=$1,phone=$2,note=$3,username=$4,active=$5,
        password_hash=$6,password_salt=$7,session_version=session_version+$8,deleted_at=CASE WHEN $5 THEN NULL ELSE deleted_at END WHERE id=$9
        RETURNING id,name,phone,note,username,active,session_version,deleted_at`, [name, cleanPhone(req.body.phone), String(req.body.note || '').trim().slice(0,200), username, active, hp.hash, hp.salt, bump ? 1 : 0, id]);
      /* User requested current teacher name everywhere, including history. */
      if (name !== current.name) {
        await client.query('UPDATE booking_slots SET teacher_name=$1 WHERE teacher_id=$2', [name, id]);
        await client.query('UPDATE slot_occurrences SET teacher_name=$1 WHERE teacher_id=$2', [name, id]);
      }
      let unassigned={students:0,occurrences:0};
      if(!active && current.active) unassigned=await clearFutureTeacherAssignments(client,id,'Atanmış öğretmen artık aktif olmadığı için etüt öğretmen ataması kaldırıldı.');
      await audit(client, 'admin', 0, 'teacher_updated', 'teacher', id, { active, username, account_initialized: !!temp, unassigned });
      await db.bumpRevisions(client, unassigned.occurrences||unassigned.students ? ['account','schedule','booking','notification'] : ['account','schedule']); return { updated, temp };
    });
    res.json({ ...t.updated, ...(t.temp ? { temporary_password: t.temp } : {}) });
  } catch (e) { if (e.code === '23505') throw httpError(409, 'Bu kullanıcı adı zaten kullanılıyor.'); throw e; }
}));
admin.post('/teachers/:id/reset-password', wrap(async (req, res) => {
  const temp = makePassword(), hp = hashPassword(temp), id = positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz öğretmen.');
  await db.tx(async client => {
    const r = await client.query(`UPDATE teachers SET password_hash=$1,password_salt=$2,session_version=session_version+1 WHERE id=$3`, [hp.hash, hp.salt, id]);
    if (!r.rowCount) throw httpError(404, 'Öğretmen bulunamadı.');
    await client.query("DELETE FROM auth_lockouts WHERE actor_type='teacher' AND actor_key IN (SELECT LOWER(username) FROM teachers WHERE id=$1)", [id]);
    await audit(client, 'admin', 0, 'teacher_password_reset', 'teacher', id); await db.bumpRevisions(client,['account']);
  });
  res.json({ ok: true, temporary_password: temp });
}));
admin.post('/teachers/:id/logout-all', wrap(async (req, res) => {
  const id=positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz öğretmen.');
  await db.tx(async client => { const r=await client.query('UPDATE teachers SET session_version=session_version+1 WHERE id=$1', [id]); if(!r.rowCount) throw httpError(404,'Öğretmen bulunamadı.'); await audit(client,'admin',0,'teacher_force_logout','teacher',id); await db.bumpRevisions(client,['account']); });
  res.json({ ok: true });
}));
admin.post('/teachers/:id/unlock', wrap(async (req, res) => {
  const id=positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz öğretmen.');
  const { rows: [t] } = await db.q('SELECT username FROM teachers WHERE id=$1', [id]);
  if (!t) throw httpError(404, 'Öğretmen bulunamadı.');
  await db.q("DELETE FROM auth_lockouts WHERE actor_type='teacher' AND actor_key=$1", [String(t.username || '').toLowerCase()]);
  res.json({ ok: true });
}));
admin.delete('/teachers/:id', wrap(async (req, res) => {
  const id=positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz öğretmen.');
  await db.tx(async client => {
    await lockScheduleConfig(client);
    const { rows: [current] } = await client.query('SELECT * FROM teachers WHERE id=$1 FOR UPDATE',[id]);
    if (!current) throw httpError(404, 'Öğretmen bulunamadı.');
    const { rows: [t] } = await client.query(`UPDATE teachers SET active=false,deleted_at=COALESCE(deleted_at,NOW()),session_version=session_version+1 WHERE id=$1 RETURNING id`, [id]);
    const unassigned=await clearFutureTeacherAssignments(client,id,'Öğretmen hesabı arşivlendiği için gelecekteki etüt ataması kaldırıldı.');
    await audit(client,'admin',0,'teacher_archived','teacher',id,{unassigned}); await db.bumpRevisions(client,['account','schedule','booking','notification']);
  });
  res.json({ ok: true });
}));

/* student management */
admin.put('/students/:id', wrap(async (req, res) => {
  const id = positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz öğrenci.');
  const updated = await db.tx(async client => {
    const { rows: [s] } = await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE', [id]);
    if (!s) throw httpError(404, 'Öğrenci bulunamadı.');
    const first = req.body.first_name === undefined ? s.first_name : cleanName(req.body.first_name);
    const last = req.body.last_name === undefined ? s.last_name : cleanName(req.body.last_name);
    const phone = req.body.phone === undefined ? s.phone : cleanPhone(req.body.phone);
    const level = req.body.level === undefined ? s.level : String(req.body.level).toUpperCase();
    const active = req.body.active === undefined ? s.active : !!req.body.active;
    if (!nameOk(first) || !nameOk(last) || !isValidTRPhone(phone) || !LEVELS.includes(level)) throw httpError(400, 'Öğrenci bilgileri geçersiz.');
    const key = db.identityKey(phone, first, last);
    const conflict = await client.query('SELECT 1 FROM students WHERE identity_key=$1 AND id<>$2', [key, id]);
    if (conflict.rowCount) throw httpError(409, 'Aynı telefon ve isimle başka bir öğrenci zaten var.');
    const sensitive = phone !== s.phone || first !== s.first_name || last !== s.last_name || level !== s.level || active !== s.active;
    const { rows: [u] } = await client.query(`UPDATE students SET first_name=$1,last_name=$2,phone=$3,level=$4,active=$5,identity_key=$6,
      session_version=session_version+$7,updated_at=NOW() WHERE id=$8 RETURNING *`, [first,last,phone,level,active,key,sensitive?1:0,id]);
    await client.query('UPDATE bookings SET first_name=$1,last_name=$2,phone=$3 WHERE student_id=$4', [first,last,phone,id]);
    if (phone !== s.phone) await client.query("UPDATE phone_change_requests SET status='superseded',resolved_at=NOW() WHERE student_id=$1 AND status='pending'", [id]);
    await audit(client,'admin',0,'student_updated','student',id,{ active, level, phone_changed: phone!==s.phone }); await db.bumpRevisions(client,['account','booking']); return u;
  });
  res.json(updated);
}));
admin.post('/students/:id/logout-all', wrap(async (req, res) => {
  const id=positiveIntParam(req.params.id); if(!id) throw httpError(400,'Geçersiz öğrenci.');
  await db.tx(async client => { const r=await client.query('UPDATE students SET session_version=session_version+1 WHERE id=$1',[id]); if(!r.rowCount) throw httpError(404,'Öğrenci bulunamadı.'); await audit(client,'admin',0,'student_force_logout','student',id); await db.bumpRevisions(client,['account']); });
  res.json({ ok: true });
}));
admin.post('/phone-requests/:id/resolve', wrap(async (req, res) => {
  const requestId=positiveIntParam(req.params.id); if(!requestId) throw httpError(400,'Geçersiz istek.');
  const approve = !!req.body.approve;
  await db.tx(async client => {
    const { rows:[peek] }=await client.query(`SELECT * FROM phone_change_requests WHERE id=$1`,[requestId]);
    if(!peek || peek.status!=='pending') throw httpError(404,'Bekleyen istek bulunamadı.');
    const {rows:[student]}=await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE',[peek.student_id]);
    if(!student) throw httpError(404,'Öğrenci bulunamadı.');
    const { rows: [r] } = await client.query(`SELECT * FROM phone_change_requests WHERE id=$1 AND student_id=$2 AND status='pending' FOR UPDATE`, [requestId,student.id]);
    if (!r) throw httpError(409, 'İstek artık beklemede değil.');
    if (approve) {
      const key = db.identityKey(r.new_phone, student.first_name, student.last_name);
      const conflict = await client.query('SELECT 1 FROM students WHERE identity_key=$1 AND id<>$2', [key, student.id]);
      if (conflict.rowCount) throw httpError(409, 'Yeni telefon bu isimle başka bir profilde kullanılıyor.');
      await client.query('UPDATE students SET phone=$1,identity_key=$2,session_version=session_version+1,updated_at=NOW() WHERE id=$3', [r.new_phone,key,student.id]);
      await client.query('UPDATE bookings SET phone=$1 WHERE student_id=$2', [r.new_phone,student.id]);
      await notify(client,'student',student.id,'Telefon değişikliği onaylandı','Yeni telefon numaranız kaydedildi. Güvenlik için tekrar giriş yapmanız gerekir.','account');
    } else await notify(client,'student',student.id,'Telefon değişikliği reddedildi','Telefon değişikliği isteğiniz yönetici tarafından reddedildi.','account');
    await client.query(`UPDATE phone_change_requests SET status=$1,resolved_at=NOW() WHERE id=$2`, [approve?'approved':'rejected',r.id]);
    await audit(client,'admin',0,approve?'phone_change_approved':'phone_change_rejected','student',student.id,{ new_phone_last4:String(r.new_phone).slice(-4) }); await db.bumpRevisions(client,['account','booking','notification']);
  });
  res.json({ ok: true });
}));

/* slot management */
function slotBody(body = {}, current = {}) {
  let teacherId=current.teacher_id ?? null;
  if (body.teacher_id !== undefined) {
    if (body.teacher_id === null || body.teacher_id === '') teacherId=null;
    else { teacherId=positiveIntParam(body.teacher_id); if(!teacherId) throw httpError(400,'Öğretmen numarası geçersiz.'); }
  }
  return {
    day: body.day === undefined ? Number(current.day) : Number(body.day),
    start_time: body.start_time === undefined ? current.start_time : String(body.start_time),
    end_time: body.end_time === undefined ? current.end_time : String(body.end_time),
    level: body.level === undefined ? current.level : String(body.level).toUpperCase().trim(),
    teacher_id: teacherId,
    classroom: body.classroom === undefined ? String(current.classroom || '') : String(body.classroom || '').trim().slice(0,120),
    capacity: body.capacity === undefined ? Number(current.capacity || 0) : Number(body.capacity || 0),
  };
}
function validateSlot(m) {
  if (!Number.isInteger(m.day) || m.day < 1 || m.day > 7) throw httpError(400, 'Geçersiz gün.');
  if (!validTime(m.start_time) || !validTime(m.end_time) || m.start_time >= m.end_time) throw httpError(400, 'Başlangıç ve bitiş saatlerini kontrol edin.');
  if (!validSlotLevel(m.level)) throw httpError(400, 'Geçersiz seviye. A1, A1-A2, B1-B2 gibi bir değer kullanın.');
  if (!Number.isInteger(m.capacity) || m.capacity < 0 || m.capacity > 999) throw httpError(400, 'Geçersiz kontenjan.');
}
function timesOverlap(aStart,aEnd,bStart,bEnd){ return aStart < bEnd && bStart < aEnd; }
function roomForModel(m,st){ return String(m.classroom || (Number(m.day)>=6?st.classroom_weekend:st.classroom_weekday) || '').trim(); }
async function validateSlotConflicts(client,m,excludeId=null,st=null){
  st=st||await db.getSettings(client);
  if(m.teacher_id){
    const {rows:[t]}=await client.query('SELECT id,name,active,deleted_at FROM teachers WHERE id=$1',[m.teacher_id]);
    if(!t || !t.active || t.deleted_at) throw httpError(400,'Seçilen öğretmen aktif değil veya bulunamadı.');
  }
  const {rows:others}=await client.query(`SELECT * FROM slots WHERE active=true AND day=$1 AND ($2::int IS NULL OR id<>$2) ORDER BY start_time,id`,[m.day,excludeId]);
  const room=roomForModel(m,st);
  for(const o of others){
    if(!timesOverlap(m.start_time,m.end_time,o.start_time,o.end_time)) continue;
    if(m.teacher_id && Number(o.teacher_id)===Number(m.teacher_id)) throw httpError(409,`Öğretmenin ${o.start_time}-${o.end_time} saatinde çakışan başka bir etüdü var.`);
    const otherRoom=roomForModel(o,st);
    if(room && otherRoom && room.toLocaleLowerCase('tr-TR')===otherRoom.toLocaleLowerCase('tr-TR')) throw httpError(409,`${room} sınıfında ${o.start_time}-${o.end_time} saatinde çakışan başka bir etüt var.`);
  }
}
async function validateAllClassroomConflicts(client,st){
  const {rows:slots}=await client.query('SELECT * FROM slots WHERE active=true ORDER BY day,start_time,id');
  for(let i=0;i<slots.length;i++) for(let j=i+1;j<slots.length;j++){
    const a=slots[i],b=slots[j]; if(Number(a.day)!==Number(b.day)||!timesOverlap(a.start_time,a.end_time,b.start_time,b.end_time)) continue;
    const ra=roomForModel(a,st),rb=roomForModel(b,st);
    if(ra&&rb&&ra.toLocaleLowerCase('tr-TR')===rb.toLocaleLowerCase('tr-TR')) throw httpError(409,`${ra} sınıfı için ${DAYS_TR[a.day]} ${a.start_time}-${a.end_time} saatlerinde program çakışması oluşur.`);
  }
}
async function relevantFutureDates(client,slotId,today){
  const {rows}=await client.query(`SELECT DISTINCT d::date AS d FROM (
    SELECT slot_date d FROM slot_occurrences WHERE slot_id=$1 AND slot_date >= $2
    UNION SELECT slot_date d FROM booking_slots WHERE slot_id=$1 AND slot_date >= $2
    UNION SELECT slot_date d FROM slot_cancellations WHERE slot_id=$1 AND slot_date >= $2
  ) x ORDER BY d`,[slotId,today]);
  return rows.map(r=>dateISO(r.d));
}
async function applyOccurrenceCancellation(client,slot,date,cancelling,note,st,{alreadyLocked=false}={}){
  date=requireISODate(date,'Etüt tarihi');
  if(!alreadyLocked) await lockOccurrences(client,[{slot_id:slot.id,date}]);
  let existing=null;
  if(dayOfWeek(date)!==Number(slot.day)){
    const {rows:[o]}=await client.query('SELECT * FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2',[slot.id,date]);
    if(!o) throw httpError(400,'İptal tarihi etüt günüyle eşleşmiyor.'); existing=o;
  }
  const occ=existing||await ensureOccurrence(client,slot,date,st);
  if(sessionHasEnded(date,occ.end_time)) throw httpError(409,'Tamamlanmış bir etüdün iptal/restorasyon durumu değiştirilemez.');
  if(cancelling) await client.query(`INSERT INTO slot_cancellations(slot_id,slot_date,note) VALUES($1,$2,$3) ON CONFLICT(slot_id,slot_date) DO UPDATE SET note=EXCLUDED.note`,[slot.id,date,note]);
  else await client.query('DELETE FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2',[slot.id,date]);
  const {rows:affected}=await client.query(`SELECT DISTINCT bs.student_id FROM booking_slots bs WHERE bs.slot_id=$1 AND bs.slot_date=$2 AND bs.status='active' AND bs.student_id IS NOT NULL`,[slot.id,date]);
  for(const a of affected) await notify(client,'student',a.student_id,cancelling?'Etüt iptal edildi':'Etüt yeniden açıldı',`${fmtTR(date)} ${occ.start_time} ${occ.level} etüdü ${cancelling?'iptal edildi'+(note?': '+note:''):'yeniden programa alındı'}.`,cancelling?'cancellation':'schedule',slot.id,date);
  if(occ.teacher_id) await notify(client,'teacher',occ.teacher_id,cancelling?'Etüt iptal edildi':'Etüt yeniden açıldı',`${fmtTR(date)} ${occ.start_time}-${occ.end_time} ${occ.level}`,cancelling?'cancellation':'schedule',slot.id,date);
  await notify(client,'admin',0,cancelling?'Etüt iptal edildi':'Etüt yeniden açıldı',`${fmtTR(date)} ${occ.start_time} ${occ.level} · ${affected.length} öğrenci`,'schedule',slot.id,date);
  await audit(client,'admin',0,cancelling?'occurrence_cancelled':'occurrence_restored','slot',slot.id,{date,note,affected:affected.length});
  return {affected:affected.length};
}
function occurrenceOperationFromBody(body){
  if(!body?.occurrence || body.occurrence.date===undefined) return null;
  return {date:requireISODate(body.occurrence.date,'İptal tarihi'),cancelled:body.occurrence.cancelled!==false,note:String(body.occurrence.note||'').trim().slice(0,300)};
}

admin.post('/slots', wrap(async (req, res) => {
  const m = slotBody(req.body); validateSlot(m); const op=occurrenceOperationFromBody(req.body);
  const saved = await db.tx(async client => {
    await lockScheduleConfig(client);
    const st=await db.getSettings(client); await validateSlotConflicts(client,m,null,st);
    const { rows:[row] } = await client.query(`INSERT INTO slots(day,start_time,end_time,level,teacher_id,classroom,capacity,active) VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`, [m.day,m.start_time,m.end_time,m.level,m.teacher_id,m.classroom,m.capacity]);
    if(op) await applyOccurrenceCancellation(client,row,op.date,op.cancelled,op.note,st);
    if(m.teacher_id){const date=nextDateForDay(m.day,Number(st.min_days_ahead||1));await notify(client,'teacher',m.teacher_id,'Etüt size atandı',`${fmtTR(date)} ${m.start_time}-${m.end_time} ${m.level} etüdü size atandı.`,'schedule',row.id,date);}
    await audit(client,'admin',0,'slot_created','slot',row.id,m); await db.bumpRevisions(client,['schedule','notification']); return row;
  });
  res.json(saved);
}));

admin.put('/slots/:id', wrap(async (req, res) => {
  const slotId=positiveIntParam(req.params.id); if(!slotId) throw httpError(400,'Geçersiz etüt.'); const op=occurrenceOperationFromBody(req.body);
  const output=await db.tx(async client=>{
    await lockScheduleConfig(client);
    const st=await db.getSettings(client);
    // BUG-044: lock only the slots row, never the nullable side of the LEFT JOIN.
    const {rows:[current]}=await client.query(`SELECT s.*,t.name teacher_name FROM slots s LEFT JOIN teachers t ON t.id=s.teacher_id WHERE s.id=$1 FOR UPDATE OF s`,[slotId]);
    if(!current || !current.active) throw httpError(404,'Etüt bulunamadı.');
    const m=slotBody(req.body,current); validateSlot(m); await validateSlotConflicts(client,m,slotId,st);
    let newTeacherName=''; if(m.teacher_id){const {rows:[t]}=await client.query('SELECT name FROM teachers WHERE id=$1 AND active=true AND deleted_at IS NULL',[m.teacher_id]);if(!t)throw httpError(400,'Seçilen öğretmen aktif değil.');newTeacherName=t.name;}
    const today=localDateParts().date;
    const futureDates=await relevantFutureDates(client,slotId,today);
    const {rows:[activeInfo]}=await client.query(`SELECT COUNT(DISTINCT slot_date)::int dates,COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND slot_date >= $2 AND status='active'`,[slotId,today]);
    if(m.level!==current.level&&Number(activeInfo.n)>0&&!req.body.confirm_level_change) throw httpError(409,`Bu etütte ${activeInfo.dates} gelecek tarih için aktif kayıt var. Seviye değişikliği mevcut öğrencileri etütte tutacak. Onay gerekli.`,{code:'LEVEL_CONFIRM',affected:activeInfo.dates});
    // Materialize every future dated state before changing its recurring template.
    for(const d of futureDates){const {rows:[exists]}=await client.query('SELECT id FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2',[slotId,d]);if(!exists) await ensureOccurrence(client,current,d,st);}
    const plans=[]; const existingSet=new Set(futureDates);
    for(const oldDate of futureDates){
      let newDate=oldDate,preserve=false;
      if(m.day!==Number(current.day)){
        const candidate=dateForWeekDay(oldDate,m.day);
        if(candidate<today) preserve=true;
        else if(candidate!==oldDate && existingSet.has(candidate) && candidate!==oldDate) preserve=true;
        else newDate=candidate;
      }
      plans.push({oldDate,newDate,preserve});
    }
    const lockSet=[]; for(const x of plans){lockSet.push({slot_id:slotId,date:x.oldDate});if(!x.preserve&&x.newDate!==x.oldDate)lockSet.push({slot_id:slotId,date:x.newDate});} if(op)lockSet.push({slot_id:slotId,date:op.date});
    await lockOccurrences(client,lockSet);
    const changed=['day','start_time','end_time','level','teacher_id','classroom','capacity'].filter(k=>String(m[k]??'')!==String(current[k]??''));
    for(const plan of plans){
      const {oldDate,newDate,preserve}=plan;
      const {rows:[occ]}=await client.query('SELECT * FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2 FOR UPDATE',[slotId,oldDate]); if(!occ)continue;
      if(preserve) continue; // keep this already-materialized occurrence frozen; new recurring rule starts safely later.
      if(newDate!==oldDate){
        const collision=await client.query('SELECT 1 FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2 AND id<>$3',[slotId,newDate,occ.id]);
        if(collision.rowCount) continue;
      }
      const {rows:[{n}]}=await client.query(`SELECT COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND slot_date=$2 AND status='active'`,[slotId,oldDate]);
      const keptCapacity=Number(n)>0&&m.capacity!==Number(current.capacity)?Number(occ.capacity):m.capacity;
      if(newDate!==oldDate){
        await client.query(`INSERT INTO slot_cancellations(slot_id,slot_date,note) SELECT slot_id,$3,note FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2 ON CONFLICT(slot_id,slot_date) DO UPDATE SET note=EXCLUDED.note`,[slotId,oldDate,newDate]);
        await client.query('DELETE FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2',[slotId,oldDate]);
      }
      const room=m.classroom||effectiveClassroom(m,st);
      await client.query(`UPDATE slot_occurrences SET slot_date=$1,day=$2,start_time=$3,end_time=$4,level=$5,teacher_id=$6,teacher_name=$7,classroom=$8,capacity=$9,updated_at=NOW() WHERE id=$10`,[newDate,m.day,m.start_time,m.end_time,m.level,m.teacher_id,newTeacherName,room,keptCapacity,occ.id]);
      // Move/update every preserved status, not just active rows.
      await client.query(`UPDATE booking_slots SET slot_date=$1,day=$2,start_time=$3,end_time=$4,level=$5,teacher_id=$6,teacher_name=$7,classroom=$8,capacity_snapshot=$9,updated_at=NOW() WHERE slot_id=$10 AND slot_date=$11`,[newDate,m.day,m.start_time,m.end_time,m.level,m.teacher_id,newTeacherName,room,keptCapacity,slotId,oldDate]);
      const {rows:affected}=await client.query(`SELECT DISTINCT student_id FROM booking_slots WHERE slot_id=$1 AND slot_date=$2 AND status='active' AND student_id IS NOT NULL`,[slotId,newDate]);
      if(changed.some(k=>k!=='capacity')){const detail=`${st.panel_change_message||'Program güncellendi.'} ${fmtTR(newDate)} · ${m.start_time}-${m.end_time} · ${m.level}${room?' · '+room:''}`;for(const a of affected)await notify(client,'student',a.student_id,'Etüt programınız güncellendi',detail,'schedule',slotId,newDate);}
      if(m.teacher_id&&m.teacher_id!==current.teacher_id) await notify(client,'teacher',m.teacher_id,'Etüt size atandı',`${fmtTR(newDate)} ${m.start_time}-${m.end_time} ${m.level} etüdü size atandı.`,'schedule',slotId,newDate);
    }
    const {rows:[saved]}=await client.query(`UPDATE slots SET day=$1,start_time=$2,end_time=$3,level=$4,teacher_id=$5,classroom=$6,capacity=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,[m.day,m.start_time,m.end_time,m.level,m.teacher_id,m.classroom,m.capacity,slotId]);
    if(op) await applyOccurrenceCancellation(client,{...saved,teacher_name:newTeacherName},op.date,op.cancelled,op.note,st,{alreadyLocked:true});
    if(changed.length){await notify(client,'all_teachers',null,'Program güncellendi',st.panel_change_message||'Program eğitim koordinatörü tarafından güncellendi.','schedule',slotId,null);await notify(client,'all_students',null,'Program güncellendi',st.panel_change_message||'Program eğitim koordinatörü tarafından güncellendi.','schedule',slotId,null);}
    await audit(client,'admin',0,'slot_updated','slot',slotId,{changed,before:{day:current.day,start_time:current.start_time,end_time:current.end_time,level:current.level,teacher_id:current.teacher_id,classroom:current.classroom,capacity:current.capacity},after:m});
    await db.bumpRevisions(client,['schedule','booking','notification']); return saved;
  });
  res.json(output);
}));

admin.post('/slots/:id/cancel', wrap(async (req, res) => {
  const slotId=positiveIntParam(req.params.id); if(!slotId) throw httpError(400,'Geçersiz etüt.');
  const date=requireISODate(req.body.date,'Etüt tarihi'),cancelling=req.body.cancelled!==false,note=String(req.body.note||'').trim().slice(0,300);
  const result=await db.tx(async client=>{
    await lockScheduleConfig(client);
    const st=await db.getSettings(client);
    const {rows:[slot]}=await client.query(`SELECT s.*,t.name teacher_name FROM slots s LEFT JOIN teachers t ON t.id=s.teacher_id WHERE s.id=$1 AND s.active=true FOR UPDATE OF s`,[slotId]);
    if(!slot) throw httpError(404,'Etüt bulunamadı.');
    await lockOccurrences(client,[{slot_id:slotId,date}]);
    const r=await applyOccurrenceCancellation(client,slot,date,cancelling,note,st,{alreadyLocked:true});
    await db.bumpRevisions(client,['schedule','notification']); return r;
  });
  res.json({ok:true,restored:!cancelling,affected:result.affected});
}));
admin.get('/slots/:id/delete-impact',wrap(async(req,res)=>{
  const id=positiveIntParam(req.params.id);if(!id)throw httpError(400,'Geçersiz etüt.');
  const {rows:[exists]}=await db.q('SELECT id FROM slots WHERE id=$1 AND active=true',[id]);if(!exists)throw httpError(404,'Etüt bulunamadı.');
  const {rows:[x]}=await db.q(`SELECT COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND status='active' AND slot_date >= $2`,[id,localDateParts().date]);
  res.json({active_future_bookings:x?.n||0});
}));
admin.delete('/slots/:id',wrap(async(req,res)=>{
  const slotId=positiveIntParam(req.params.id); if(!slotId)throw httpError(400,'Geçersiz etüt.'); const confirm=req.query.confirm==='1';
  const result=await db.tx(async client=>{
    await lockScheduleConfig(client);
    const {rows:[slot]}=await client.query('SELECT * FROM slots WHERE id=$1 AND active=true FOR UPDATE',[slotId]);if(!slot)throw httpError(404,'Etüt bulunamadı.');
    const today=localDateParts().date,st=await db.getSettings(client),dates=await relevantFutureDates(client,slotId,today);
    for(const d of dates){const {rows:[o]}=await client.query('SELECT id FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2',[slotId,d]);if(!o)await ensureOccurrence(client,slot,d,st);}
    await lockOccurrences(client,dates.map(date=>({slot_id:slotId,date})));
    const {rows:future}=await client.query(`SELECT bs.id,bs.student_id,bs.slot_date,bs.start_time,bs.level FROM booking_slots bs WHERE bs.slot_id=$1 AND bs.status='active' AND bs.slot_date >= $2 FOR UPDATE`,[slotId,today]);
    if(future.length&&!confirm)throw httpError(409,`Bu etüdün ${future.length} aktif gelecek kaydı var. Arşivleme bu kayıtları iptal edecek.`);
    for(const b of future){await client.query(`UPDATE booking_slots SET status='cancelled_by_admin',cancelled_at=NOW(),cancel_note='Etüt programdan kaldırıldı',updated_at=NOW() WHERE id=$1`,[b.id]);if(b.student_id)await notify(client,'student',b.student_id,'Etüt programdan kaldırıldı',`${fmtTR(dateISO(b.slot_date))} ${b.start_time} ${b.level} etüdü programdan kaldırıldı.`,'cancellation',slotId,dateISO(b.slot_date));}
    await client.query(`UPDATE booking_slots bs SET status='cancelled_by_admin',cancelled_at=COALESCE(bs.cancelled_at,NOW()),cancel_note=CASE WHEN bs.cancel_note='' THEN COALESCE(sc.note,'Etüt yönetici tarafından iptal edildi') ELSE bs.cancel_note END,updated_at=NOW() FROM slot_cancellations sc WHERE bs.slot_id=$1 AND bs.slot_id=sc.slot_id AND bs.slot_date=sc.slot_date AND bs.status='active'`,[slotId]);
    await client.query('UPDATE slots SET active=false,deleted_at=NOW(),updated_at=NOW() WHERE id=$1',[slotId]);
    await audit(client,'admin',0,'slot_archived','slot',slotId,{cancelled_bookings:future.length});await db.bumpRevisions(client,['schedule','booking','notification']);return future.length;
  });
  res.json({ok:true,archived:true,cancelled_bookings:result});
}));
admin.delete('/bookings/:id',wrap(async(req,res)=>{
  const id=positiveIntParam(req.params.id);if(!id)throw httpError(400,'Geçersiz kayıt.');
  await db.tx(async client=>{
    const {rows:[booking]}=await client.query(`SELECT * FROM bookings WHERE id=$1 AND status<>'deleted_by_admin' FOR UPDATE`,[id]);if(!booking)throw httpError(404,'Kayıt bulunamadı veya zaten silinmiş.');
    const {rows}=await client.query(`SELECT bs.* FROM booking_slots bs WHERE bs.booking_id=$1 FOR UPDATE`,[id]);
    const locks=rows.filter(r=>r.slot_id).map(r=>({slot_id:r.slot_id,date:dateISO(r.slot_date)}));await lockOccurrences(client,locks);
    await client.query(`UPDATE booking_slots SET status=CASE WHEN status='active' THEN 'cancelled_by_admin' ELSE status END,cancelled_at=CASE WHEN status='active' THEN NOW() ELSE cancelled_at END,cancel_note=CASE WHEN status='active' THEN 'Yönetici tarafından silindi' ELSE cancel_note END,updated_at=NOW() WHERE booking_id=$1`,[id]);
    await client.query(`UPDATE bookings SET status='deleted_by_admin',deleted_at=NOW() WHERE id=$1`,[id]);
    for(const r of rows)if(r.status==='active'&&r.student_id)await notify(client,'student',r.student_id,'Etüt kaydı yönetici tarafından kaldırıldı',`${fmtTR(dateISO(r.slot_date))} ${r.start_time} ${r.level}`,'cancellation',r.slot_id,dateISO(r.slot_date));
    await audit(client,'admin',0,'booking_deleted','booking',id);await db.bumpRevisions(client,['booking','notification']);
  });
  res.json({ok:true});
}));

/* panel announcements */
admin.post('/announcements',wrap(async(req,res)=>{
  const audience=String(req.body.audience||'all'),title=String(req.body.title||'Duyuru').trim().slice(0,100),body=String(req.body.body||'').trim().slice(0,1000);
  if(!['all','students','teachers'].includes(audience)) throw httpError(400,'Geçersiz duyuru hedefi.');
  if(!body) throw httpError(400,'Duyuru metni gerekli.');
  const targets=audience==='teachers'?['all_teachers']:audience==='students'?['all_students']:['all_teachers','all_students'];
  await db.tx(async client=>{for(const t of targets)await notify(client,t,null,title,body,'announcement');await notify(client,'admin',0,title,body,'announcement');await audit(client,'admin',0,'announcement_created','announcement','',{audience,title});await db.bumpRevisions(client,['notification']);});
  res.json({ok:true});
}));
admin.post('/notifications/:id/read',wrap(async(req,res)=>{const id=positiveIntParam(req.params.id);if(!id)throw httpError(400,'Geçersiz bildirim.');await markNotification('admin',0,id);res.json({ok:true});}));

/* Production diagnostic log center. */
admin.get('/logs',wrap(async(req,res)=>{
  const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)),off=(page-1)*limit;
  const where=[],params=[]; const add=(sql,v)=>{params.push(v);where.push(sql.replace('?',`$${params.length}`));};
  if(req.query.severity){const sev=String(req.query.severity).toUpperCase();if(!['DEBUG','INFO','WARN','ERROR','CRITICAL'].includes(sev))throw httpError(400,'Geçersiz log seviyesi.');add('severity=?',sev);}
  if(req.query.category)add('category=?',String(req.query.category).slice(0,80));
  if(req.query.source)add('source=?',String(req.query.source).slice(0,80));
  if(req.query.role)add('user_role=?',String(req.query.role).slice(0,40));
  if(req.query.route){params.push(escLike(req.query.route));where.push(`route ILIKE $${params.length} ESCAPE '\\'`);}
  if(req.query.request_id)add('request_id=?',String(req.query.request_id).slice(0,128));
  if(req.query.resolved==='true'||req.query.resolved==='false')add('resolved=?',req.query.resolved==='true');
  if(req.query.from){const d=requireISODate(req.query.from,'Başlangıç tarihi');add('created_at >= ?::date',d);}
  if(req.query.to){const d=requireISODate(req.query.to,'Bitiş tarihi');add("created_at < (?::date + INTERVAL '1 day')",d);}
  if(req.query.q){params.push(escLike(req.query.q));where.push(`(message ILIKE $${params.length} ESCAPE '\\' OR COALESCE(error_code,'') ILIKE $${params.length} ESCAPE '\\' OR COALESCE(action,'') ILIKE $${params.length} ESCAPE '\\')`);}
  const wh=where.length?'WHERE '+where.join(' AND '):'';
  const {rows:[count]}=await db.q(`SELECT COUNT(*)::int total FROM system_logs ${wh}`,params);
  const pp=[...params,limit,off],li=pp.length-1,oi=pp.length;
  const {rows:items}=await db.q(`SELECT id,request_id,created_at,severity,category,source,http_method,route,status_code,user_role,user_id,action,message,error_name,error_code,resolved,resolved_at FROM system_logs ${wh} ORDER BY created_at DESC,id DESC LIMIT $${li} OFFSET $${oi}`,pp);
  const {rows:[summary]}=await db.q(`SELECT COUNT(*) FILTER(WHERE resolved=false AND severity IN ('ERROR','CRITICAL'))::int unresolved_errors,COUNT(*) FILTER(WHERE resolved=false AND severity='CRITICAL')::int critical,COUNT(*) FILTER(WHERE resolved=false AND severity='WARN')::int warnings,COUNT(*)::int total FROM system_logs`);
  res.json({items,total:count.total,page,limit,pages:Math.max(1,Math.ceil(count.total/limit)),summary,readiness:{database:dbReady?'ready':'not_ready'}});
}));
admin.get('/logs/:id',wrap(async(req,res)=>{const id=positiveIntParam(req.params.id);if(!id)throw httpError(400,'Geçersiz log.');const {rows:[row]}=await db.q('SELECT * FROM system_logs WHERE id=$1',[id]);if(!row)throw httpError(404,'Log bulunamadı.');res.json(row);}));
admin.patch('/logs/:id/resolve',wrap(async(req,res)=>{const id=positiveIntParam(req.params.id);if(!id)throw httpError(400,'Geçersiz log.');const resolved=req.body.resolved!==false;const {rows:[row]}=await db.q(`UPDATE system_logs SET resolved=$1,resolved_at=CASE WHEN $1 THEN NOW() ELSE NULL END,resolved_by=CASE WHEN $1 THEN 'admin' ELSE NULL END WHERE id=$2 RETURNING id,resolved,resolved_at`,[resolved,id]);if(!row)throw httpError(404,'Log bulunamadı.');res.json(row);}));
admin.get('/logs.csv',wrap(async(req,res)=>{
  const {rows}=await db.q(`SELECT created_at,severity,category,source,request_id,http_method,route,status_code,user_role,user_id,action,message,error_name,error_code,resolved FROM system_logs ORDER BY created_at DESC LIMIT 5000`);
  const esc=v=>`"${String(v??'').replace(/"/g,'""').replace(/[\r\n]+/g,' ')}"`; const headers=Object.keys(rows[0]||{created_at:'',severity:'',category:'',source:'',request_id:'',http_method:'',route:'',status_code:'',user_role:'',user_id:'',action:'',message:'',error_name:'',error_code:'',resolved:''});
  res.type('text/csv').setHeader('Content-Disposition','attachment; filename="system_logs.csv"');res.send([headers.join(','),...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\n'));
}));

admin.get('/qr.png',wrap(async(req,res)=>{
  const url=String(req.query.url||`${req.protocol}://${req.get('host')}`).slice(0,500);
  const png=await QRCode.toBuffer(url,{width:1200,margin:2,color:{dark:'#111111',light:'#FFE600'},errorCorrectionLevel:'H'});res.setHeader('Cache-Control','private, max-age=3600');res.type('png').send(png);
}));
admin.get('/export.xlsx',wrap(async(req,res)=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Etüt Kayıtları');
  ws.columns=[{header:'Kayıt No',key:'id',width:10},{header:'Kayıt Tarihi',key:'created',width:18},{header:'Ad',key:'first',width:16},{header:'Soyad',key:'last',width:16},{header:'Telefon',key:'phone',width:15},{header:'Seviye',key:'level',width:8},{header:'Konu',key:'topic',width:30},{header:'Etüt Tarihi',key:'date',width:13},{header:'Gün',key:'day',width:12},{header:'Saat',key:'time',width:13},{header:'Etüt Seviyesi',key:'slevel',width:12},{header:'Öğretmen',key:'teacher',width:18},{header:'Sınıf',key:'room',width:20},{header:'Durum',key:'status',width:18}];
  ws.getRow(1).font={bold:true};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE600'}};
  const {rows}=await db.q(`SELECT b.*,bs.slot_date,bs.day,bs.start_time,bs.end_time,bs.level slevel,bs.teacher_name,bs.classroom,bs.status slot_status FROM bookings b LEFT JOIN booking_slots bs ON bs.booking_id=b.id ORDER BY b.created_at DESC,bs.slot_date`);
  for(const r of rows) ws.addRow({id:r.id,created:new Date(r.created_at).toLocaleString('tr-TR',{timeZone:TZ}),first:r.first_name,last:r.last_name,phone:r.phone,level:r.level,topic:r.topic,date:r.slot_date?fmtTR(dateISO(r.slot_date)):'',day:DAYS_TR[r.day]||'',time:r.start_time?`${r.start_time}-${r.end_time}`:'',slevel:r.slevel||'',teacher:r.teacher_name||'',room:r.classroom||'',status:r.slot_status||r.status});
  ws.autoFilter='A1:N1';res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="etut_kayitlari_${localDateParts().date}.xlsx"`);await wb.xlsx.write(res);res.end();
}));
app.post('/api/client-errors', rateLimit('client-error', 20, 60 * 1000), wrap(async(req,res)=>{
  const body=db.sanitizeForLog(req.body||{}); let role='public',userId=null;
  const candidates=[[req.cookies[ADMIN_COOKIE],'admin'],[req.cookies[TEACHER_COOKIE],'teacher'],[req.cookies[STUDENT_COOKIE],'student']];
  for(const [tok,r] of candidates){const p=verify(tok);if(p&&p.role===r){role=r;userId=Number.isInteger(Number(p.id))?Number(p.id):null;break;}}
  await db.logSystem({request_id:req.requestId,severity:'ERROR',category:'frontend',source:'browser',http_method:req.method,route:String(body.page||req.get('referer')||'/').slice(0,500),status_code:null,user_role:role,user_id:userId,action:'client_runtime_error',message:String(body.message||'Unhandled browser error').slice(0,2000),error_name:String(body.error_name||'').slice(0,120)||null,stack_trace:String(body.stack||'').slice(0,12000)||null,metadata:{filename:body.filename,line:body.line,column:body.column,user_agent:String(req.get('user-agent')||'').slice(0,300)}});
  res.status(202).json({ok:true,request_id:req.requestId});
}));
app.use('/api/admin',admin);

// Deliberately gated diagnostic endpoint used only by the destructive integration
// suite to prove request-ID correlation and safe centralized 500 handling.
if (process.env.NODE_ENV === 'test' && process.env.ETUT_ENABLE_TEST_ROUTES === '1') {
  app.get('/api/__test/error', (req,res,next) => next(new Error('Intentional integration-test exception')));
  app.post('/api/__test/uncaught', (req,res) => { res.status(202).json({ok:true,request_id:req.requestId}); setImmediate(()=>{ throw new Error('Intentional uncaught integration-test exception'); }); });
}

/* ----------------------------- health + pages ----------------------------- */
app.get('/healthz',(req,res)=>res.status(200).json({ok:true,database:dbReady?'ready':'starting'}));
app.get('/readyz',async(req,res)=>{
  // Readiness means startup initialization/migrations completed successfully,
  // not merely that PostgreSQL accepts SELECT 1. This prevents Coolify/tests
  // from routing traffic while schema migrations or secure bootstrap are still running.
  if(!dbReady){
    scheduleDbInit();
    return res.status(503).json({ok:false,database:'initializing',request_id:req.requestId});
  }
  try{
    await db.q('SELECT 1');
    return res.status(200).json({ok:true});
  }catch(e){
    dbReady=false;
    scheduleDbInit();
    return res.status(503).json({ok:false,database:'unavailable',request_id:req.requestId});
  }
});

/* Unknown API paths must never fall through to index.html. */
app.use('/api',(req,res)=>res.status(404).json({error:'API yolu bulunamadı.',request_id:req.requestId}));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/teacher',(req,res)=>res.sendFile(path.join(__dirname,'public','teacher.html')));
app.get('/student',(req,res)=>res.sendFile(path.join(__dirname,'public','student.html')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

/* Centralized error boundary: expected 4xx stays concise; unexpected failures are
   correlated by request ID and stored server-side without returning stack traces. */
app.use(async(err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=Number(err.status)||500;
  if(status>=500){
    console.error(`[${req.requestId}]`,err);
    const isDb=!!err.code&&/^[0-9A-Z]{5}$/.test(String(err.code));
    await safeSystemLog({request_id:req.requestId,severity:status>=500?'ERROR':'WARN',category:isDb?'database':'http',source:'server',http_method:req.method,route:req.originalUrl,status_code:status,user_role:req.auth?.role||(req.teacher?'teacher':req.student?'student':'public'),user_id:req.teacher?.id||req.student?.id||null,action:'request_failed',message:err.message||'Unhandled request error',error_name:err.name,error_code:err.code,stack_trace:err.stack,metadata:{method:req.method,path:req.path}});
  }
  const payload={error:status>=500?'Sunucu hatası.':String(err.message||'İstek tamamlanamadı.')};
  if(status>=500)payload.request_id=req.requestId;
  else{if(err.code)payload.code=err.code;if(err.affected!==undefined)payload.affected=err.affected;}
  res.status(status).json(payload);
});

const PORT=process.env.PORT||3000;
const server=app.listen(PORT,'0.0.0.0',()=>console.log(`✅ English Time Etüt System listening on port ${PORT}`));
let initTimer=null,initRunning=false,shuttingDown=false;
async function initWithRetry(attempt=1){
  if(initRunning||shuttingDown)return;initRunning=true;
  try{await db.init();dbReady=true;console.log('✅ Database ready');}
  catch(e){
    dbReady=false;console.error(`⚠️ DB init failed (attempt ${attempt}): ${e.message}`);
    try{await db.logSystem({severity:'CRITICAL',category:'startup',source:'server',action:'database_init_failed',message:e.message,error_name:e.name,error_code:e.code,stack_trace:e.stack,metadata:{attempt}});}catch{}
    if(/Secure Admin bootstrap required/.test(String(e.message))){console.error('❌ Startup stopped: configure a secure ADMIN_PASSWORD in Coolify.');process.exitCode=1;setTimeout(()=>process.exit(1),250);return;}
    const delay=Math.min(30000,Math.max(3000,attempt*3000));initTimer=setTimeout(()=>initWithRetry(attempt+1),delay);
  }finally{initRunning=false;}
}
function scheduleDbInit(){if(shuttingDown||initRunning||initTimer)return;initTimer=setTimeout(()=>{initTimer=null;initWithRetry(1);},1000);}
initWithRetry();

async function gracefulShutdown(signal,exitCode=0){
  if(shuttingDown)return;shuttingDown=true;dbReady=false;if(initTimer)clearTimeout(initTimer);
  console.log(`ℹ️ ${signal}: graceful shutdown started`);
  const force=setTimeout(()=>process.exit(exitCode||1),10000);force.unref();
  server.close(async()=>{try{await db.close();}catch(e){console.error('DB close failed:',e.message);}clearTimeout(force);process.exit(exitCode);});
}
process.on('SIGTERM',()=>gracefulShutdown('SIGTERM',0));
process.on('SIGINT',()=>gracefulShutdown('SIGINT',0));
process.on('unhandledRejection',async reason=>{const e=reason instanceof Error?reason:new Error(String(reason));console.error('Unhandled rejection:',e);await safeSystemLog({severity:'ERROR',category:'process',source:'server',action:'unhandled_rejection',message:e.message,error_name:e.name,error_code:e.code,stack_trace:e.stack});});
process.on('uncaughtException',async e=>{console.error('Uncaught exception:',e);await safeSystemLog({severity:'CRITICAL',category:'process',source:'server',action:'uncaught_exception',message:e.message,error_name:e.name,error_code:e.code,stack_trace:e.stack});gracefulShutdown('uncaughtException',1);});
