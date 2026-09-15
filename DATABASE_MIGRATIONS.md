# Database migrations

The application runs migrations automatically from `db.js` during startup. No manual SQL is part of the normal Coolify deployment.

## Migration coordination

`db.init()` acquires a PostgreSQL advisory session lock before it checks/creates migration state, applies migrations, hashes legacy Admin credentials, makes the one-time initial-seed decision and performs compatibility backfills. This serializes initialization if more than one application replica starts at the same time. The lock is released in `finally`.

`schema_migrations(version, name, applied_at)` records applied versions. Each migration is executed in a transaction and inserts its version only after its statements succeed. Re-running startup is idempotent.

## Version 1 — `baseline_schema`

Creates missing original/core tables and adds columns/indexes that older deployments may lack using `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. It covers settings, Teachers, Students, recurring slots, bookings, booking-slot snapshots, dated occurrences/cancellations, internal notifications/read-state, phone-change workflow, lockouts, audit history and the dormant legacy messages table.

For an existing database it does not truncate tables or replace existing values.

## Version 2 — `production_hardening_and_logs`

Adds:

- `slots.active boolean default true`
- `slots.deleted_at timestamptz`
- performance indexes for active schedule, Student active-time overlap lookups, occurrences/cancellations by date and bookings by Student/date
- `system_logs` with request/severity/category/source/route/role/error/stack/metadata/resolution fields and diagnostic indexes

It also replaces the old recurring-slot foreign-key cascade behavior for `slot_occurrences`, `slot_cancellations` and legacy `teacher_notifications` with `ON DELETE RESTRICT`. Production routes no longer physically delete recurring slots; Admin removal archives them instead. This prevents a future accidental hard delete from cascading away occurrence history.

## Settings/default compatibility

After schema migrations, missing settings are inserted with `ON CONFLICT DO NOTHING`; production values are never overwritten. Added settings include:

- `max_weeks_ahead`
- `admin_session_version`
- `schedule_revision`
- `booking_revision`
- `account_revision`
- `notification_revision`
- `initial_schedule_seeded`

The initial weekly timetable is seeded only on a genuinely fresh installation. `initial_schedule_seeded=true` prevents an intentionally empty schedule from being repopulated on restart.

## Admin credential migration

If a secure Admin hash/salt does not exist, startup chooses an acceptable legacy plaintext bootstrap or `ADMIN_PASSWORD`, immediately hashes it with `scrypt`, stores hash/salt and clears the plaintext setting. The historical predictable default is rejected. Once a hash exists, the environment bootstrap does not silently replace it.

## Data-preserving compatibility backfills

Startup also performs idempotent compatibility backfills:

- creates/reuses Student profiles for legacy bookings that do not have `student_id`
- links legacy `booking_slots.student_id` from their parent booking
- fills missing Teacher/classroom/capacity booking snapshots from the recurring slot
- materializes occurrence snapshots for dated bookings that predate `slot_occurrences`

These backfills use existing records and do not delete booking history.

## Verification

The included destructive integration suite contains two independent migration scenarios:

1. a completely empty PostgreSQL schema, including restart/idempotency and no-reseed behavior;
2. a representative original-schema fixture populated with Teacher, Student, recurring slot, booking, cancelled booking, dated cancellation, notification and settings data, followed by startup of the corrected application and preservation checks.

Run only against a disposable database using `RUN_TESTS_WINDOWS.ps1` or `npm run test:integration` with `ETUT_TEST_DESTRUCTIVE=YES`.
