// Database layer (PostgreSQL). Works with Neon / Supabase / Render Postgres.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n❌  DATABASE_URL is not set. Add your Postgres connection string (see README).\n');
  process.exit(1);
}

// Only use SSL for cloud-hosted databases. A Postgres container on the same
// server talks over the internal Docker network and has no SSL certificate,
// so forcing SSL there fails with "server does not support SSL connections".
const needsSSL = /neon\.tech|supabase\.|render\.com|amazonaws\.com|sslmode=require/i
  .test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

const q = (text, params) => pool.query(text, params);

// Seed taken from the printed "Weekly Etüt Schedule"
const SEED_SLOTS = [
  // Weekdays (day 1 = Monday ... 7 = Sunday)
  ...[['13:20', '14:00', ['A1', 'B2', 'A2', 'B1', 'A1-A2']],
      ['14:10', '14:50', ['A2', 'B1', 'A1', 'B2', 'B1-B2']],
      ['17:20', '18:00', ['B2', 'A1', 'B1', 'A2', 'A1-A2']],
      ['18:00', '18:30', ['B1', 'A2', 'B2', 'A1', 'B1-B2']]]
    .flatMap(([s, e, levels]) => levels.map((lvl, i) => ({ day: i + 1, start: s, end: e, level: lvl }))),
  // Weekend
  ...[['12:20', '13:00', ['A2', 'B2']],
      ['13:10', '13:50', ['A1', 'B1']],
      ['14:00', '14:40', ['B1', 'A1']],
      ['15:40', '16:20', ['B2', 'A1']],
      ['16:30', '17:10', ['B1', 'A2']]]
    .flatMap(([s, e, levels]) => levels.map((lvl, i) => ({ day: i + 6, start: s, end: e, level: lvl }))),
];

const DEFAULT_SETTINGS = {
  coordinator_name: 'Eğitim Koordinatörü',
  coordinator_phone: '',
  classroom_weekday: 'Washington (9th Floor)',
  classroom_weekend: 'Chicago (2nd Floor)',
  level_rule: 'own_next', // own | own_next | own_adjacent
  min_days_ahead: '1',
  sms_provider: 'log', // log | netgsm
  netgsm_usercode: '',
  netgsm_password: '',
  netgsm_header: '',
  site_url: '',
  admin_password: process.env.ADMIN_PASSWORD || 'EnglishTime2026!',
  /* Every template is written in PLAIN LETTERS, no Turkish characters.
   * An SMS holds 160 plain characters but only 70 with Turkish letters,
   * so "etudunuz" bills as one message where "etüdünüz" bills as three.
   * messaging.js strips any Turkish typed in here, but writing it plain
   * keeps the preview honest about the length. */

  sms_student_template:
    'Sayin {AD_SOYAD}, etut kaydiniz olusturuldu: {ETUTLER}. Sinif: {SINIF}. English Time {SUBE}',

  sms_teacher_template:
    '{HOCA_ADI}, yeni etut kaydi: {AD_SOYAD} ({TELEFON}) {SEVIYE}. {ETUTLER}. Konu: {KONU}',

  sms_coordinator_template:
    'Yeni etut kaydi: {AD_SOYAD} ({TELEFON}) {SEVIYE}. {ETUTLER}',

  sms_cancel_template:
    'Sayin {AD_SOYAD}, {TARIH} {GUN} {SAAT} etudunuz iptal edilmistir. English Time {SUBE}',

  sms_cancel_teacher_template:
    '{HOCA_ADI}, {TARIH} {GUN} {SAAT} etudu iptal edildi. {SAYI} ogrenciye bilgi verildi.',

  branch_name: 'Kizilay',
};

async function init() {
  await q(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS slots (
      id SERIAL PRIMARY KEY,
      day INT NOT NULL,                 -- 1 Monday ... 7 Sunday
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      level TEXT NOT NULL,              -- 'A1' or 'A1-A2'
      teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
      classroom TEXT NOT NULL DEFAULT '',
      capacity INT NOT NULL DEFAULT 0,  -- 0 = unlimited
      cancelled BOOLEAN NOT NULL DEFAULT FALSE,
      cancel_note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL,
      level TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS booking_slots (
      id SERIAL PRIMARY KEY,
      booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
      slot_id INT REFERENCES slots(id) ON DELETE SET NULL,
      slot_date DATE NOT NULL,
      day INT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      level TEXT NOT NULL, teacher_name TEXT NOT NULL DEFAULT ''
    );
    /* Per-DATE cancellations.
     *
     * Slots are weekly and recurring ("Wednesday 17:00, B1"), so the old
     * cancelled flag on the slot killed that time forever. A teacher off
     * sick this Wednesday needs the 3rd cancelled and the 10th left
     * alone, which is what this table records. */
    CREATE TABLE IF NOT EXISTS slot_cancellations (
      id SERIAL PRIMARY KEY,
      slot_id INT REFERENCES slots(id) ON DELETE CASCADE,
      slot_date DATE NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (slot_id, slot_date)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL,            -- sms | whatsapp
      recipient TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL,             -- logged | sent | failed
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }

  const { rows } = await q('SELECT COUNT(*)::int AS n FROM slots');
  if (rows[0].n === 0) {
    for (const s of SEED_SLOTS) {
      await q('INSERT INTO slots (day,start_time,end_time,level) VALUES ($1,$2,$3,$4)', [s.day, s.start, s.end, s.level]);
    }
    console.log('✅ Seeded schedule from the printed timetable');
  }
}

async function getSettings() {
  const { rows } = await q('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
async function setSetting(key, value) {
  await q('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value ?? '')]);
}

module.exports = { pool, q, init, getSettings, setSetting };
