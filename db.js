const { Pool } = require('pg');
const crypto = require('crypto');

if (!process.env.DATABASE_URL) {
  console.error('\n❌ DATABASE_URL is not set. Add the PostgreSQL connection string in Coolify.\n');
  process.exit(1);
}

const needsSSL = /neon\.tech|supabase\.|render\.com|amazonaws\.com|sslmode=require/i.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const q = (text, params) => pool.query(text, params);

const KNOWN_UNSAFE_ADMIN_PASSWORD = 'EnglishTime2026!';
const SEED_SLOTS = [
  ...[['13:20', '14:00', ['A1', 'B2', 'A2', 'B1', 'A1-A2']],
      ['14:10', '14:50', ['A2', 'B1', 'A1', 'B2', 'B1-B2']],
      ['17:20', '18:00', ['B2', 'A1', 'B1', 'A2', 'A1-A2']],
      ['18:00', '18:30', ['B1', 'A2', 'B2', 'A1', 'B1-B2']]]
    .flatMap(([s, e, levels]) => levels.map((level, i) => ({ day: i + 1, start: s, end: e, level }))),
  ...[['12:20', '13:00', ['A2', 'B2']],
      ['13:10', '13:50', ['A1', 'B1']],
      ['14:00', '14:40', ['B1', 'A1']],
      ['15:40', '16:20', ['B2', 'A1']],
      ['16:30', '17:10', ['B1', 'A2']]]
    .flatMap(([s, e, levels]) => levels.map((level, i) => ({ day: i + 6, start: s, end: e, level }))),
];

const DEFAULT_SETTINGS = {
  coordinator_name: 'Eğitim Koordinatörü',
  coordinator_phone: '',
  classroom_weekday: 'Washington (9th Floor)',
  classroom_weekend: 'Chicago (2nd Floor)',
  level_rule: 'own_next',
  min_days_ahead: '1',
  max_weeks_ahead: '6',
  branch_name: 'Kizilay',
  admin_password: '',
  admin_password_hash: '',
  admin_password_salt: '',
  admin_session_version: '1',
  panel_change_message: 'Program eğitim koordinatörü tarafından güncellendi.',
  data_revision: '1',
  schedule_revision: '1',
  booking_revision: '1',
  account_revision: '1',
  notification_revision: '1',
  initial_schedule_seeded: 'false',
  max_weekly_etuts: '', // Empty: grandfather existing Kızılay unlimited until Admin explicitly sets a cap.
  external_notifications_enabled: 'false',
  // Legacy SMS keys remain only so old databases can upgrade without data loss.
  // They are not read by the active application and external messaging is disabled.
  sms_provider: 'log', netgsm_usercode: '', netgsm_password: '', netgsm_header: '',
  vatan_api_id: '', vatan_api_key: '', vatan_sender: '',
  sms_student_template: '', sms_teacher_template: '', sms_coordinator_template: '',
  sms_cancel_template: '', sms_cancel_teacher_template: '',
};

function normalizeName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
}
function identityKey(phone, first, last) {
  return `${String(phone || '').replace(/\D/g, '')}|${normalizeName(first)}|${normalizeName(last)}`;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

async function runMigration(version, name, fn) {
  await tx(async client => {
    const { rows: [done] } = await client.query('SELECT version FROM schema_migrations WHERE version=$1', [version]);
    if (done) return;
    await fn(client);
    await client.query('INSERT INTO schema_migrations(version,name) VALUES($1,$2)', [version, name]);
  });
}

async function init() {
  // Serialize startup migrations/seed decisions across multiple app replicas.
  // The lock is session-scoped so it remains held while migration transactions
  // use their own pooled connections, and is always released in finally.
  const initLockClient = await pool.connect();
  const INIT_LOCK_KEY = 781144263;
  let lockAcquired = false;
  try {
  // Lock acquisition can fail during a transient database outage. Ensure the
  // reserved pool connection is released even when no lock was acquired.
  await initLockClient.query('SELECT pg_advisory_lock($1)', [INIT_LOCK_KEY]);
  lockAcquired = true;
  const { rows: [pre] } = await q("SELECT to_regclass('public.settings')::text AS settings_table");
  const hadExistingDatabase = !!pre?.settings_table;
  // Check branch ownership BEFORE modifying even a legacy database. This is a
  // separate, immutable DB sentinel, never client-controlled or based on a label.
  const branchCode = String(process.env.BRANCH_CODE || (process.env.NODE_ENV === 'production' ? '' : 'kizilay')).toLowerCase();
  if (!['kizilay','kecioren','pursaklar'].includes(branchCode)) throw new Error('BRANCH_CODE must be kizilay, kecioren or pursaklar.');
  const { rows: [ownershipTable] } = await q("SELECT to_regclass('public.branch_identity')::text AS table_name");
  if (ownershipTable?.table_name) {
    const { rows: owners } = await q('SELECT branch_code FROM branch_identity');
    if (owners.length !== 1 || owners[0].branch_code !== branchCode) throw new Error('BRANCH DATABASE MISMATCH. Startup refused before migrations.');
  } else if (hadExistingDatabase) {
    // Only a separately backed-up, confirmed legacy Kızılay DB may adopt a
    // sentinel. A new app pointed at a legacy DB is stopped, not auto-claimed.
    if (branchCode !== 'kizilay' || process.env.KIZILAY_ADOPTION_APPROVED !== 'YES') {
      throw new Error('LEGACY DATABASE NOT ADOPTED. Verified backup + restored-copy rehearsal and KIZILAY_ADOPTION_APPROVED=YES required.');
    }
    const { rows: [legacyIdentity] } = await q("SELECT value FROM settings WHERE key='branch_name'");
    if (!/k[ıi]z[ıi]lay/i.test(legacyIdentity?.value || '')) throw new Error('Legacy branch identity is inconsistent. Manual review required.');
  }

  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await runMigration(1, 'baseline_schema', async client => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');

      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT ''
      );
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS username TEXT;
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS password_salt TEXT NOT NULL DEFAULT '';
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      CREATE UNIQUE INDEX IF NOT EXISTS teachers_username_unique ON teachers (LOWER(username)) WHERE username IS NOT NULL;

      CREATE TABLE IF NOT EXISTS slots (
        id SERIAL PRIMARY KEY,
        day INT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        level TEXT NOT NULL,
        teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
        classroom TEXT NOT NULL DEFAULT '',
        capacity INT NOT NULL DEFAULT 0,
        cancelled BOOLEAN NOT NULL DEFAULT FALSE,
        cancel_note TEXT NOT NULL DEFAULT ''
      );
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        level TEXT NOT NULL,
        identity_key TEXT NOT NULL UNIQUE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        session_version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS students_phone_idx ON students(phone);

      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        level TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS student_id INT REFERENCES students(id) ON DELETE SET NULL;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS booking_slots (
        id SERIAL PRIMARY KEY,
        booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
        slot_id INT REFERENCES slots(id) ON DELETE SET NULL,
        slot_date DATE NOT NULL,
        day INT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        level TEXT NOT NULL,
        teacher_name TEXT NOT NULL DEFAULT ''
      );
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS student_id INT REFERENCES students(id) ON DELETE SET NULL;
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL;
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS classroom TEXT NOT NULL DEFAULT '';
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS capacity_snapshot INT NOT NULL DEFAULT 0;
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS cancel_note TEXT NOT NULL DEFAULT '';
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      CREATE INDEX IF NOT EXISTS booking_slots_occurrence_idx ON booking_slots(slot_id, slot_date, status);
      CREATE INDEX IF NOT EXISTS booking_slots_student_idx ON booking_slots(student_id, slot_date);

      CREATE TABLE IF NOT EXISTS slot_occurrences (
        id SERIAL PRIMARY KEY,
        slot_id INT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
        slot_date DATE NOT NULL,
        day INT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        level TEXT NOT NULL,
        teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
        teacher_name TEXT NOT NULL DEFAULT '',
        classroom TEXT NOT NULL DEFAULT '',
        capacity INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(slot_id, slot_date)
      );

      CREATE TABLE IF NOT EXISTS slot_cancellations (
        id SERIAL PRIMARY KEY,
        slot_id INT REFERENCES slots(id) ON DELETE CASCADE,
        slot_date DATE NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (slot_id, slot_date)
      );

      CREATE TABLE IF NOT EXISTS teacher_notifications (
        id SERIAL PRIMARY KEY,
        slot_id INT REFERENCES slots(id) ON DELETE CASCADE,
        slot_date DATE NOT NULL,
        kind TEXT NOT NULL DEFAULT 'booking',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (slot_id, slot_date, kind)
      );

      CREATE TABLE IF NOT EXISTS panel_notifications (
        id BIGSERIAL PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id INT,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'info',
        slot_id INT,
        slot_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS panel_notifications_target_idx ON panel_notifications(target_type, target_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id BIGINT REFERENCES panel_notifications(id) ON DELETE CASCADE,
        viewer_type TEXT NOT NULL,
        viewer_id INT NOT NULL,
        read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(notification_id, viewer_type, viewer_id)
      );

      CREATE TABLE IF NOT EXISTS phone_change_requests (
        id BIGSERIAL PRIMARY KEY,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        old_phone TEXT NOT NULL,
        new_phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );
      ALTER TABLE phone_change_requests DROP CONSTRAINT IF EXISTS phone_change_requests_student_id_status_key;
      CREATE UNIQUE INDEX IF NOT EXISTS phone_change_requests_one_pending ON phone_change_requests(student_id) WHERE status='pending';

      CREATE TABLE IF NOT EXISTS auth_lockouts (
        actor_type TEXT NOT NULL,
        actor_key TEXT NOT NULL,
        failed_count INT NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(actor_type, actor_key)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id INT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT '',
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  });

  await runMigration(2, 'production_hardening_and_logs', async client => {
    await client.query(`
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS slots_active_schedule_idx ON slots(active,day,start_time);

      CREATE INDEX IF NOT EXISTS booking_slots_student_active_time_idx ON booking_slots(student_id,slot_date,start_time,end_time) WHERE status='active';
      CREATE INDEX IF NOT EXISTS slot_occurrences_date_idx ON slot_occurrences(slot_date,slot_id);
      CREATE INDEX IF NOT EXISTS slot_cancellations_date_idx ON slot_cancellations(slot_date,slot_id);
      CREATE INDEX IF NOT EXISTS bookings_student_created_idx ON bookings(student_id,created_at DESC);

      CREATE TABLE IF NOT EXISTS system_logs (
        id BIGSERIAL PRIMARY KEY,
        request_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        severity TEXT NOT NULL DEFAULT 'INFO',
        category TEXT NOT NULL DEFAULT 'application',
        source TEXT NOT NULL DEFAULT 'server',
        environment TEXT NOT NULL DEFAULT '',
        http_method TEXT,
        route TEXT,
        status_code INT,
        user_role TEXT,
        user_id INT,
        action TEXT,
        message TEXT NOT NULL,
        error_name TEXT,
        error_code TEXT,
        stack_trace TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT
      );
      CREATE INDEX IF NOT EXISTS system_logs_created_idx ON system_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS system_logs_severity_idx ON system_logs(severity,created_at DESC);
      CREATE INDEX IF NOT EXISTS system_logs_request_idx ON system_logs(request_id) WHERE request_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS system_logs_category_idx ON system_logs(category,created_at DESC);
      CREATE INDEX IF NOT EXISTS system_logs_resolved_idx ON system_logs(resolved,created_at DESC);
      CREATE INDEX IF NOT EXISTS system_logs_route_idx ON system_logs(route,created_at DESC);
    `);

    // Prevent accidental physical slot deletion from cascading away history.
    await client.query('ALTER TABLE slot_occurrences DROP CONSTRAINT IF EXISTS slot_occurrences_slot_id_fkey');
    await client.query('ALTER TABLE slot_occurrences ADD CONSTRAINT slot_occurrences_slot_id_fkey FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE RESTRICT');
    await client.query('ALTER TABLE slot_cancellations DROP CONSTRAINT IF EXISTS slot_cancellations_slot_id_fkey');
    await client.query('ALTER TABLE slot_cancellations ADD CONSTRAINT slot_cancellations_slot_id_fkey FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE RESTRICT');
    await client.query('ALTER TABLE teacher_notifications DROP CONSTRAINT IF EXISTS teacher_notifications_slot_id_fkey');
    await client.query('ALTER TABLE teacher_notifications ADD CONSTRAINT teacher_notifications_slot_id_fkey FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE RESTRICT');
  });

  await runMigration(3, 'branch_categories_weekly_policy', async client => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS branch_identity (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        branch_code TEXT NOT NULL CHECK (branch_code IN ('kizilay','kecioren','pursaklar')),
        initialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS etut_categories (
        id SERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
        name_tr TEXT NOT NULL, name_en TEXT NOT NULL,
        requires_level BOOLEAN NOT NULL DEFAULT TRUE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        system_key TEXT UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS category_levels (
        id SERIAL PRIMARY KEY,
        category_id INT NOT NULL REFERENCES etut_categories(id) ON DELETE RESTRICT,
        code TEXT NOT NULL, label_tr TEXT NOT NULL, label_en TEXT NOT NULL,
        sort_order INT NOT NULL CHECK (sort_order BETWEEN 0 AND 999),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE(category_id,code), UNIQUE(id,category_id)
      );
      CREATE TABLE IF NOT EXISTS student_category_enrollments (
        student_id INT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
        category_id INT NOT NULL REFERENCES etut_categories(id) ON DELETE RESTRICT,
        primary_level_id INT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(student_id,category_id),
        FOREIGN KEY(primary_level_id,category_id) REFERENCES category_levels(id,category_id)
      );
      CREATE TABLE IF NOT EXISTS student_level_permissions (
        student_id INT NOT NULL,
        category_id INT NOT NULL,
        level_id INT NOT NULL,
        granted_by TEXT NOT NULL DEFAULT 'admin',
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        PRIMARY KEY(student_id,category_id,level_id),
        FOREIGN KEY(student_id,category_id) REFERENCES student_category_enrollments(student_id,category_id) ON DELETE RESTRICT,
        FOREIGN KEY(level_id,category_id) REFERENCES category_levels(id,category_id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS level_change_requests (
        id BIGSERIAL PRIMARY KEY,
        student_id INT NOT NULL,
        category_id INT NOT NULL,
        from_level_id INT NOT NULL,
        requested_level_id INT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded')),
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT,
        resolution_note TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(student_id,category_id) REFERENCES student_category_enrollments(student_id,category_id),
        FOREIGN KEY(from_level_id,category_id) REFERENCES category_levels(id,category_id),
        FOREIGN KEY(requested_level_id,category_id) REFERENCES category_levels(id,category_id),
        CHECK(from_level_id<>requested_level_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS level_request_one_pending ON level_change_requests(student_id,category_id) WHERE status='pending';
      CREATE INDEX IF NOT EXISTS level_request_inbox ON level_change_requests(status,requested_at DESC);
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS category_id INT REFERENCES etut_categories(id) ON DELETE RESTRICT;
      ALTER TABLE slot_occurrences ADD COLUMN IF NOT EXISTS category_id INT REFERENCES etut_categories(id) ON DELETE RESTRICT;
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS category_id INT REFERENCES etut_categories(id) ON DELETE RESTRICT;
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS category_name_snapshot TEXT;
      ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS level_codes_snapshot TEXT[];
      CREATE TABLE IF NOT EXISTS slot_level_eligibility (
        slot_id INT NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
        category_id INT NOT NULL REFERENCES etut_categories(id) ON DELETE RESTRICT,
        level_id INT NOT NULL,
        PRIMARY KEY(slot_id,level_id),
        FOREIGN KEY(level_id,category_id) REFERENCES category_levels(id,category_id)
      );
      CREATE INDEX IF NOT EXISTS booking_slots_quota_idx ON booking_slots(student_id,slot_date,status);
      CREATE TABLE IF NOT EXISTS student_booking_limits (
        student_id INT PRIMARY KEY REFERENCES students(id) ON DELETE RESTRICT,
        max_weekly_etuts INT NOT NULL CHECK(max_weekly_etuts BETWEEN 0 AND 100),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const presets = [
      ['general-english','General English','General English','general', ['A1','A2','B1','B2','C1','C2']],
      ['junior-english','Junior English','Junior English','junior', ['Junior 1','Junior 2','Junior 3','Junior 4','Junior 5','Junior 6']],
      ['teenage-english','Teenage English','Teenage English','teenage', ['Teenage 1','Teenage 2','Teenage 3','Teenage 4','Teenage 5']]
    ];
    for (const [slug,tr,en,system,codes] of presets) {
      const { rows: [category] } = await client.query(`INSERT INTO etut_categories(slug,name_tr,name_en,system_key)
         VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id`, [slug,tr,en,system]);
      for (let i=0;i<codes.length;i++) await client.query(`INSERT INTO category_levels(category_id,code,label_tr,label_en,sort_order)
         VALUES($1,$2,$2,$2,$3) ON CONFLICT(category_id,code) DO NOTHING`, [category.id,codes[i],i+1]);
    }
  });
  // Owner-approved extension: Teenage 1–5, including a safe idempotent upgrade
  // for any disposable staging database that already applied candidate v3.
  await runMigration(4, 'teenage_fifth_level', async client => {
    await client.query(`INSERT INTO category_levels(category_id,code,label_tr,label_en,sort_order)
      SELECT id, 'Teenage 5', 'Teenage 5', 'Teenage 5', 5 FROM etut_categories
      WHERE system_key='teenage' AND active=true
      ON CONFLICT(category_id,code) DO NOTHING`);
  });
  // An existing Kızılay DB can only get a sentinel under the explicit adoption
  // gate checked above; a NEW DB is claimed only with its configured code.
  await q('INSERT INTO branch_identity(singleton,branch_code) VALUES(TRUE,$1) ON CONFLICT(singleton) DO NOTHING', [branchCode]);
  const { rows: [owner] } = await q('SELECT branch_code FROM branch_identity WHERE singleton=TRUE');
  if (owner?.branch_code !== branchCode) throw new Error('BRANCH DATABASE MISMATCH after initialization.');

  // Add defaults after migrations without overwriting production values.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const newBranchName=String(process.env.BRANCH_NAME || (branchCode === 'kecioren' ? 'Keçiören' : branchCode === 'pursaklar' ? 'Pursaklar' : 'Kızılay')).trim();
    const initialValue = key === 'branch_name' && !hadExistingDatabase ? newBranchName : value;
    await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, initialValue]);
  }

  // Secure Admin bootstrap/migration. A known historical fallback is never accepted.
  await tx(async client => {
    const st = await getSettings(client);
    if (!st.admin_password_hash || !st.admin_password_salt) {
      const legacy = String(st.admin_password || '');
      const envBootstrap = String(process.env.ADMIN_PASSWORD || '');
      const candidate = legacy && legacy !== KNOWN_UNSAFE_ADMIN_PASSWORD ? legacy : envBootstrap;
      if (!candidate || candidate === KNOWN_UNSAFE_ADMIN_PASSWORD || candidate.length < 8) {
        throw new Error('Secure Admin bootstrap required: set ADMIN_PASSWORD (8+ chars, not the historical default) for this deployment.');
      }
      const hp = hashPassword(candidate);
      await setSetting('admin_password_hash', hp.hash, client);
      await setSetting('admin_password_salt', hp.salt, client);
      await setSetting('admin_password', '', client);
    } else if (st.admin_password) {
      await setSetting('admin_password', '', client);
    }
  });

  // Seed only a genuinely fresh installation. Existing deployments that intentionally
  // have zero slots are marked seeded and stay empty across restarts.
  await tx(async client => {
    const st = await getSettings(client);
    if (st.initial_schedule_seeded !== 'true') {
      const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int AS n FROM slots');
      if (!hadExistingDatabase && n === 0 && process.env.SEED_DEFAULT_SCHEDULE !== 'false' && branchCode === 'kizilay') {
        for (const s of SEED_SLOTS) {
          await client.query('INSERT INTO slots (day,start_time,end_time,level) VALUES ($1,$2,$3,$4)', [s.day, s.start, s.end, s.level]);
        }
        console.log('✅ Seeded weekly etüt schedule');
      }
      await setSetting('initial_schedule_seeded', 'true', client);
    }
  });

  // Backfill student profiles for older bookings. Identity intentionally includes
  // normalized name so siblings may share a family phone number.
  const { rows: legacy } = await q(`SELECT DISTINCT first_name,last_name,phone,level
    FROM bookings WHERE student_id IS NULL ORDER BY phone`);
  for (const b of legacy) {
    const key = identityKey(b.phone, b.first_name, b.last_name);
    const { rows: [student] } = await q(`
      INSERT INTO students(first_name,last_name,phone,level,identity_key)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(identity_key) DO UPDATE SET updated_at=students.updated_at
      RETURNING id`, [b.first_name, b.last_name, b.phone, b.level, key]);
    await q(`UPDATE bookings SET student_id=$1 WHERE student_id IS NULL AND phone=$2
      AND LOWER(first_name)=LOWER($3) AND LOWER(last_name)=LOWER($4)`, [student.id, b.phone, b.first_name, b.last_name]);
  }
  await q(`UPDATE booking_slots bs SET student_id=b.student_id
    FROM bookings b WHERE bs.booking_id=b.id AND bs.student_id IS NULL`);

  await q(`UPDATE booking_slots bs SET
      teacher_id = COALESCE(bs.teacher_id, s.teacher_id),
      classroom = CASE WHEN bs.classroom='' THEN s.classroom ELSE bs.classroom END,
      capacity_snapshot = CASE WHEN bs.capacity_snapshot=0 THEN s.capacity ELSE bs.capacity_snapshot END
    FROM slots s WHERE bs.slot_id=s.id`);

  await q(`
    INSERT INTO slot_occurrences(slot_id,slot_date,day,start_time,end_time,level,teacher_id,teacher_name,classroom,capacity)
    SELECT bs.slot_id, bs.slot_date, MIN(bs.day), MIN(bs.start_time), MIN(bs.end_time), MIN(bs.level),
           MIN(bs.teacher_id), MIN(bs.teacher_name), MIN(bs.classroom), MAX(bs.capacity_snapshot)
      FROM booking_slots bs
     WHERE bs.slot_id IS NOT NULL
     GROUP BY bs.slot_id, bs.slot_date
    ON CONFLICT(slot_id,slot_date) DO NOTHING
  `);

  // Safe idempotent legacy General English backfill. Never rewrite the legacy
  // level text or old historical snapshots, and never enroll unrelated subjects.
  await tx(async client => {
    const { rows: [general] } = await client.query("SELECT id FROM etut_categories WHERE system_key='general'");
    if (!general) throw new Error('General English preset missing');
    await client.query(`INSERT INTO student_category_enrollments(student_id,category_id,primary_level_id)
      SELECT s.id,$1,l.id FROM students s JOIN category_levels l ON l.category_id=$1 AND l.code=s.level
      ON CONFLICT(student_id,category_id) DO NOTHING`, [general.id]);
    await client.query('UPDATE slots SET category_id=$1 WHERE category_id IS NULL',[general.id]);
    await client.query('UPDATE slot_occurrences SET category_id=s.category_id FROM slots s WHERE slot_occurrences.slot_id=s.id AND slot_occurrences.category_id IS NULL');
    await client.query(`UPDATE booking_slots SET category_id=$1, category_name_snapshot=COALESCE(category_name_snapshot,$2), level_codes_snapshot=COALESCE(level_codes_snapshot,string_to_array(level,'-')) WHERE category_id IS NULL`, [general.id,'General English']);
    await client.query(`INSERT INTO slot_level_eligibility(slot_id,category_id,level_id)
      SELECT s.id,$1,cl.id FROM slots s JOIN category_levels cl ON cl.category_id=$1 AND cl.code=ANY(string_to_array(s.level,'-'))
      WHERE s.category_id=$1 ON CONFLICT DO NOTHING`,[general.id]);
  });
  } finally {
    try { if (lockAcquired) await initLockClient.query('SELECT pg_advisory_unlock($1)', [INIT_LOCK_KEY]); }
    finally { initLockClient.release(); }
  }
}

async function getSettings(client = pool) {
  const { rows } = await client.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
async function setSetting(key, value, client = pool) {
  await client.query(`INSERT INTO settings(key,value) VALUES($1,$2)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [key, String(value ?? '')]);
}
async function bumpRevisions(client = pool, domains = []) {
  const clean = [...new Set(domains)].filter(x => ['schedule','booking','account','notification'].includes(x));
  const keys = ['data_revision', ...clean.map(x => `${x}_revision`)];
  const out = {};
  for (const key of keys) {
    const { rows: [row] } = await client.query(`
      INSERT INTO settings(key,value) VALUES($1,'2')
      ON CONFLICT(key) DO UPDATE SET value=((CASE WHEN settings.value ~ '^[0-9]+$' THEN settings.value ELSE '1' END)::bigint+1)::text
      RETURNING value`, [key]);
    out[key] = Number(row.value);
  }
  return out;
}
async function bumpRevision(client = pool) {
  const r = await bumpRevisions(client, ['schedule','booking','account','notification']);
  return r.data_revision;
}
async function getSyncState(client = pool) {
  const st = await getSettings(client);
  return {
    schedule_revision: Number(st.schedule_revision || 1),
    booking_revision: Number(st.booking_revision || 1),
    account_revision: Number(st.account_revision || 1),
    notification_revision: Number(st.notification_revision || 1),
  };
}

function redactText(value) {
  let s = String(value ?? '');
  // Defense in depth: redact common secret-bearing text even when a secret was
  // embedded in an error string rather than supplied under a sensitive key.
  s = s.replace(/postgres(?:ql)?:\/\/([^:@\s/]+):([^@\s/]+)@/gi, 'postgresql://$1:[redacted]@');
  s = s.replace(/\b(authorization\s*[:=]\s*bearer)\s+[^\s,;]+/gi, '$1 [redacted]');
  s = s.replace(/\b(cookie\s*[:=])\s*[^\r\n]+/gi, '$1 [redacted]');
  s = s.replace(/\b(password|passwd|session_secret|admin_password|database_url|api[_-]?key|token)\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]');
  return s;
}
function sanitizeForLog(value, depth = 0) {
  if (depth > 5) return '[max-depth]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') { const s=redactText(value); return s.length > 2000 ? `${s.slice(0, 2000)}…` : s; }
  if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitizeForLog(v, depth + 1));
  if (typeof value !== 'object') return String(value);
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 80)) {
    if (/(password|passwd|secret|cookie|authorization|token|session|database_url|api[_-]?key|credential)/i.test(k)) out[k] = '[redacted]';
    else if (/phone/i.test(k)) {
      const digits = String(v || '').replace(/\D/g, '');
      out[k] = digits ? `***${digits.slice(-4)}` : '';
    } else out[k] = sanitizeForLog(v, depth + 1);
  }
  return out;
}
// Omitted fields must be stored as SQL NULL, not misleading numeric zeros.
function integerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
async function logSystem(entry = {}, client = pool) {
  const severity = ['DEBUG','INFO','WARN','ERROR','CRITICAL'].includes(String(entry.severity || '').toUpperCase()) ? String(entry.severity).toUpperCase() : 'INFO';
  const metadata = sanitizeForLog(entry.metadata || {});
  const params = [
    entry.request_id || null, severity, redactText(entry.category || 'application').slice(0,80), redactText(entry.source || 'server').slice(0,80),
    redactText(entry.environment || process.env.NODE_ENV || '').slice(0,40), entry.http_method || null, entry.route ? redactText(entry.route).slice(0,1000) : null,
    integerOrNull(entry.status_code), entry.user_role || null,
    integerOrNull(entry.user_id), entry.action ? redactText(entry.action).slice(0,200) : null,
    redactText(entry.message || 'Unspecified log event').slice(0,4000), entry.error_name ? redactText(entry.error_name).slice(0,200) : null, entry.error_code ? redactText(entry.error_code).slice(0,200) : null,
    entry.stack_trace ? redactText(entry.stack_trace).slice(0,20000) : null, JSON.stringify(metadata), !!entry.resolved,
  ];
  const { rows: [row] } = await client.query(`INSERT INTO system_logs(
    request_id,severity,category,source,environment,http_method,route,status_code,user_role,user_id,action,message,error_name,error_code,stack_trace,metadata,resolved)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17) RETURNING id`, params);
  return row?.id;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
async function close() { await pool.end(); }

module.exports = {
  pool, q, init, getSettings, setSetting, bumpRevision, bumpRevisions, getSyncState,
  tx, identityKey, sanitizeForLog, redactText, logSystem, close, KNOWN_UNSAFE_ADMIN_PASSWORD,
};
