# English Time Etüt System — production-hardened synchronized panels

## Final validation status

## 2.1.4 deployment lockfile hotfix

Coolify/Railpack deployment exposed an invalid transitive lockfile entry for `require-directory@2.1.2`, which does not exist on the public npm registry. The lockfile is restored to the published `require-directory@2.1.1` tarball and `^2.1.1` dependency selector, matching the original project's working lockfile. No application/runtime behavior changed in this hotfix.


**2.1.4 contains the deployment-only lockfile correction described below. The application code remains the 2.1.3 code that passed the complete real PostgreSQL integration/concurrency suite: 75/75 tests passed, 0 failed (180.9s).** Syntax checks also passed and the static regression suite is 21/21 PASS. The remaining required verification is the post-deployment browser/mobile smoke test in the real Coolify environment.


This project is one Node.js/Express application backed by one PostgreSQL database. PostgreSQL is the single source of truth for the public booking flow, Student Panel (`/student`), Teacher Panel (`/teacher`) and Admin Panel (`/admin`). SMS, WhatsApp and email are intentionally inactive; notifications are internal panel notifications only.

## Normal deployment

The intended deployment stays simple:

`GitHub → Coolify/Railpack → Node.js → existing PostgreSQL`

Required/expected environment variables:

- `DATABASE_URL` — PostgreSQL connection string.
- `NODE_ENV=production`.
- `PORT=3000` (or another Coolify-provided port).
- `SESSION_SECRET` — long stable random secret. Production startup refuses to run without it. Changing it invalidates all signed browser sessions.
- `ADMIN_PASSWORD` — required only when a database has no established Admin password hash yet (fresh install or legacy DB that still needs bootstrap migration). It must be at least 8 characters and cannot be the historical unsafe default. Once a secure hash exists, startup does not overwrite it from the environment.

No manual SQL is required. Versioned migrations run automatically during startup before `/readyz` reports success. Startup migration/seed work is serialized with a PostgreSQL advisory lock so multiple replicas cannot race the migration/initial-seed decision.

## Admin bootstrap and sessions

A fresh/legacy Admin bootstrap password is immediately hashed with Node `crypto.scrypt` during database initialization. Plaintext `admin_password` in `settings` is cleared during the same initialization. The historical predictable password is explicitly rejected and is never used as a fallback.

Admin sessions carry `admin_session_version`. Changing the Admin password increments that version, invalidating prior Admin cookies while issuing the current browser a refreshed session.

## Teacher accounts

Admin chooses a unique username. The system generates a strong temporary password on account creation/reset and shows it once; PostgreSQL stores only `scrypt` hash + salt. Teacher sessions last 12 hours.

Five failed Teacher login attempts temporarily lock the username for 15 minutes. Admin can unlock it, reset the password, force logout, disable/archive the account, or change the username. Password reset, username changes and relevant account-state changes invalidate previous Teacher sessions.

Teachers are read-only. They can see all etüts, with their own assignments highlighted, plus Student first name, surname, CEFR level and topic/request. Teacher APIs/UI do not expose Student phone numbers.

## Student access

There is intentionally no Student password in this release. Student identity is normalized:

`phone + first name + surname`

The saved CEFR level is additionally checked at login. This allows siblings using the same family phone number to remain separate profiles when their names differ. A successful booking/login creates a 30-day signed Student session.

Students can book eligible sessions, view history, cancel their own future/not-ended registration, edit allowed name fields and request a phone-number change. CEFR level remains Admin-controlled. Approved phone changes increment `session_version`, so old Student sessions and the old identity stop working.

## Scheduling/data-integrity behavior

- Booking and schedule mutations share PostgreSQL transaction/advisory-lock rules.
- Multi-slot occurrence locks are sorted deterministically by date + slot ID to avoid A→B/B→A deadlocks.
- Capacity is checked under the occurrence lock; simultaneous users cannot legitimately take the same final seat.
- Authenticated Student booking locks and uses the current Student row by ID instead of recreating identity from stale profile fields.
- Student overlap, Teacher overlap and classroom overlap are rejected server-side.
- Already-started sessions and dates beyond the configured `max_weeks_ahead` horizon are rejected server-side.
- One-date cancellation/restoration preserves the recurring template and booking rows.
- Recurring slot removal is a soft archive (`active=false`, `deleted_at`); historical joins are retained.
- Future materialized occurrence edits update active and cancelled booking snapshots coherently; past history remains frozen.
- Capacity reduction does not silently eject already-booked Students.
- Level changes with active future bookings require explicit Admin confirmation.
- Deactivating/archiving a Teacher removes that Teacher from future assignments/snapshots while preserving historical references.

## Synchronization

Student, Teacher and Admin panels use small revision/sync-state checks (`schedule`, `booking`, `account`, `notification`) rather than repeatedly downloading the entire dashboard. Frontend polling uses non-overlapping recursive scheduling/in-flight protection. High-priority cancellation/schedule/account notifications are surfaced while a panel is already open.

## System Logs / Error Center

Every HTTP request gets an `X-Request-ID`. Unexpected server failures are correlated to a structured PostgreSQL `system_logs` row where the database is available. Public/Student/Teacher 500 responses receive a safe error + request ID, never stack traces. Admin can filter/search logs, inspect sanitized stack/metadata, resolve/reopen entries and export CSV.

Sensitive keys and common secret-bearing text are redacted. Passwords, password hashes, cookies, authorization values, session secrets, database URLs/credentials and API keys must not be intentionally logged. Audit history (`audit_logs`) remains separate from technical system errors (`system_logs`).

## Health/readiness

- `/healthz` — process liveness. It can be HTTP 200 while PostgreSQL is temporarily unavailable.
- `/readyz` — application/database readiness. It is HTTP 200 only when PostgreSQL is reachable and the application can operate; use this for deployment readiness.

## Tests

Syntax/static checks (no database needed):

```bash
npm ci
npm run test:syntax
npm run test:static
```

The integration suite is intentionally destructive and must use **only a disposable PostgreSQL database**:

```bash
# PowerShell example
$env:ETUT_TEST_DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
$env:ETUT_TEST_DESTRUCTIVE="YES"
npm run test:integration
```

On Windows, `RUN_TESTS_WINDOWS.ps1` prompts for the disposable test URL and runs `npm ci`, syntax checks and the real PostgreSQL integration/concurrency suite. Never point it at production: it drops and recreates the test database's `public` schema.

See `TEST_REPORT.md`, `DATABASE_MIGRATIONS.md`, `LOGGING.md` and `DEPLOY_CHECKLIST.md` for the handoff details.


## 2.1.1 readiness correction

A disposable PostgreSQL test run found that `/readyz` could return 200 before startup migrations completed. Version 2.1.1 gates readiness on completed `db.init()` and adds a regression check. Re-run `RUN_TESTS_WINDOWS.ps1` against the disposable database before production deployment.


## 2.1.2 test-suite timing correction

A real PostgreSQL rerun passed 33 checks and exposed a midnight-sensitive test fixture: a booking created for “tomorrow 08:00” can become an already-ended “today 08:00” occurrence if the suite crosses Europe/Istanbul midnight. Version 2.1.2 moves main integration fixtures two calendar days ahead and improves failure diagnostics. This changes test timing only; production booking/cancellation policy is unchanged.


## 2.1.3 real-PostgreSQL correction

The 2.1.2 disposable PostgreSQL run completed **75 integration tests: 68 passed / 7 failed**. Five schedule-related failures shared one cross-platform root cause: PostgreSQL `DATE` values can be returned as local-midnight JavaScript `Date` objects on Windows; converting those with `toISOString()` shifted Europe/Istanbul calendar dates back one day, so Admin edits/reassignments/capacity changes targeted the wrong materialized occurrence. Version 2.1.3 preserves local calendar components for PostgreSQL DATE values.

The same run also exposed two independent defects: Admin system-log pagination forced a minimum page size of 10 even when `limit=1`, and Admin overview compared the TEXT `booking_slots.end_time` column directly with a PostgreSQL `time`, causing a 500 after an Admin password change when the refreshed session requested the overview. Both are corrected in 2.1.3.

Re-run `RUN_TESTS_WINDOWS.ps1` against **only the disposable `english-time-etut-test` database** before production deployment.
