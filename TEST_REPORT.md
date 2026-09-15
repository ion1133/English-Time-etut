# TEST REPORT — English Time Etüt 2.1.3

## FINAL EXTERNAL POSTGRESQL VALIDATION — PASS

The complete 2.1.3 destructive integration/concurrency suite was executed by the user against the disposable PostgreSQL test database on 2026-09-15. Result: **75 passed / 0 failed / 75 total** in **180.9 seconds**.

The successful run covered fresh-database initialization, versioned migrations, upgrade from the representative legacy schema, secure Admin bootstrap migration, capacity races, reversed multi-slot locking, duplicate-Student races, Student/Teacher/Admin authentication and session invalidation, booking horizon/start-time rules, Student/Teacher/classroom overlap prevention, Teacher reassignment, BUG-044 booked recurring-slot editing, capacity snapshot preservation, level-change confirmation, dated cancel/restore, booking-vs-cancel serialization, booking-vs-recurring-edit serialization, cancelled-booking snapshot propagation, archive/history preservation, phone-change identity invariants, inactive-Teacher enforcement, request-ID/System Log behavior, pagination/filtering, security headers, origin protection, rate limiting, readiness/liveness failure semantics, graceful shutdown, and uncaught-exception exit behavior.

The same run also executed `npm ci` successfully and reported **5 moderate npm audit advisories**. No forced dependency upgrade was applied because `npm audit fix --force` may introduce breaking changes. JavaScript syntax checks passed before the integration suite.

**Final automated runtime status:** PostgreSQL integration/concurrency **PASS (75/75)**; syntax **PASS**; static regression **21/21 PASS**. Authenticated browser/device smoke testing remains a post-deployment verification step in the real Coolify environment, as defined in `DEPLOY_CHECKLIST.md`.



## 2.1.3 correction cycle — real PostgreSQL 2.1.2 result

The user executed the complete 2.1.2 suite against the disposable PostgreSQL database. Result: **68 passed / 7 failed / 75 total** in 184.3 seconds. Fresh migrations, legacy upgrade, capacity race protection, reversed multi-slot locking, duplicate-Student race prevention, Student/Teacher auth/session controls, overlap checks, dated cancel/restore, archive/history preservation, structured logging, rate limits, readiness failure semantics and graceful shutdown all reached real PostgreSQL PASS results.

The seven failures reduced to three root causes now corrected in 2.1.3:

1. **Cross-platform PostgreSQL DATE normalization** — five failures (Teacher reassignment highlight, BUG-044 booked-slot edit propagation, capacity snapshot preservation, booking-vs-recurring-edit coherence, and cancelled-booking snapshot propagation) all showed future occurrences remaining on their old snapshot. On Windows/Europe-Istanbul, PostgreSQL DATE can be represented as local-midnight `Date`; `toISOString().slice(0,10)` converts that instant to the previous UTC calendar day. The Admin edit transaction therefore locked/materialized/updated the wrong date. `dateISO(Date)` now preserves local year/month/day calendar components instead of treating a SQL DATE as a UTC instant.
2. **Admin log page-size clamp** — `/api/admin/logs?limit=1` was forced to a minimum of 10. The endpoint now honors limits from 1 through 100.
3. **Admin overview TEXT/time comparison** — `booking_slots.end_time` is stored as TEXT, but overview compared it directly to `$2::time`, which PostgreSQL rejects. It now explicitly casts `bs.end_time::time`, eliminating the 500 seen immediately after the Admin password-session refresh test.

Local verification for 2.1.3: `npm run test:syntax` **PASS** and `npm run test:static` **21/21 PASS**. A full disposable-PostgreSQL rerun is required to verify all 75 integration cases after these corrections.

The same dependency install reported **5 moderate npm audit advisories**. No automatic `npm audit fix --force` was applied because that can introduce breaking dependency changes; the advisories should be reviewed separately after functional acceptance.

## 2.1.2 test-fixture timing correction

A second real PostgreSQL run passed **33 tests** before stopping at Student cancellation with HTTP 409. The immediately preceding dashboard assertion proved the target booking row was still `active`, and the cancellation route has only two controlled 409 branches: already-cancelled or session-ended. No operation between those assertions mutates that row, so the remaining 409 path was the time check. The suite had created the capacity fixture for “tomorrow at 08:00”; if a long run crosses Istanbul midnight, that fixture becomes “today at 08:00” and is correctly treated by production code as completed.

Version 2.1.2 fixes the **test harness**, not the production cancellation rule: main API fixtures are now placed two Istanbul calendar days ahead, making the suite stable across midnight. The cancellation assertion also prints the response body on failure for direct diagnostics. Production cancellation semantics remain unchanged: a Student may cancel an active session until that occurrence has ended.

Observed user-run result before this correction: **33 passed / 1 failed**, with fresh migrations, legacy upgrade, security headers, API validation, capacity race, multi-slot deadlock prevention, duplicate-Student race prevention, CEFR checks, started/cancelled occurrence checks, login privacy, duplicate booking checks, and booking-horizon checks all passing against PostgreSQL 17.

## Build environment

- Node.js: `v22.16.0`
- npm: `10.9.2`
- Target runtime: Node.js >= 20
- Target database: PostgreSQL 17 / standard PostgreSQL-compatible server
- Application architecture: Express + `pg`, one Node service, one PostgreSQL source of truth

## External disposable PostgreSQL run — correction cycle 1

The first user-run PostgreSQL suite reached the disposable PostgreSQL 17 database successfully and exposed a real readiness race: `/readyz` returned HTTP 200 after a bare `SELECT 1` even while `db.init()` migrations were still running. The harness therefore began querying `schema_migrations`, `settings`, and migrated columns before initialization finished. That single readiness defect produced the observed migration/table/login failures.

Correction in 2.1.1: `/readyz` now returns 503 while `dbReady` is false and only returns 200 after `db.init()` has completed successfully. If the live DB later fails, readiness is reset to false and initialization/recovery is scheduled. A static regression check was added so a bare DB connection cannot again be mistaken for completed application readiness.

The full PostgreSQL suite must now be rerun against the disposable database; later phases were not reached reliably in the first run because the readiness race invalidated the harness timing.

## Executed in this build environment

### JavaScript syntax

`npm run test:syntax` — **PASS**

Checked:

- `server.js`
- `db.js`
- `messaging.js`
- `public/common.js`
- `public/app.js`
- `public/student.js`
- `public/teacher.js`
- `public/admin.js`
- `tests/integration.js`
- `tests/static-audit.js`

### Static regression audit

`npm run test:static` — **21/21 PASS**

The executed static checks cover the unsafe Admin fallback pattern, production soft archive, BUG-044 `FOR UPDATE OF s`, deterministic occurrence-lock sorting, authenticated Student ID locking, Student/Admin/Teacher session-version mutations, mobile critical links, Teacher+classroom public rendering, non-overlapping polling pattern, Teacher phone privacy in frontend code, API JSON 404 ordering, secret redaction, versioned migration/startup lock presence and removal of the old hard Admin result truncation limits.

### Archive/source checks

- No production `DELETE FROM slots` route remains; slot removal is archive/soft-delete.
- No `setInterval(...)` remains in Student/Teacher/Admin polling code.
- No mobile CSS rule hides required `.toplink` actions.
- `FOR UPDATE` on the schedule outer join explicitly targets `s`.
- The historical unsafe Admin password string appears only as a rejection sentinel and an integration-test negative case; it is not a bootstrap fallback.

## Not executable in this model sandbox

### Dependency install / npm advisory network

A complete `npm ci` could not be performed in this sandbox because the required npm registry/cache access is unavailable here. No `node_modules` directory is included in the deployment ZIP. Coolify/Railpack should install dependencies from `package-lock.json` during the normal build.

`npm audit` network advisory results are therefore **NOT AVAILABLE HERE**.

### Real PostgreSQL integration/concurrency suite

Status: **NOT EXECUTED HERE**.

Reason: this model execution sandbox cannot open arbitrary outbound PostgreSQL TCP connections. The user separately verified the disposable PostgreSQL 17 test server is externally reachable on its temporary port, but the sandbox network policy still prevents direct DB use.

The complete destructive suite is included as `tests/integration.js` and is designed for a disposable database only. It covers:

- fresh DB initialization, versioned migrations, Admin bootstrap hash/plaintext removal, idempotent second startup and no schedule reseed after intentional emptying;
- upgrade from a populated representative original schema without losing Teacher/Student/slot/booking/cancelled-booking/dated-cancellation/notification/settings data;
- real capacity races (20 concurrent attempts for one final seat), reversed multi-slot order, duplicate-Student race, booking vs Admin cancellation and Student profile vs phone-approval race;
- Student login/cancel/rebook/overlap/phone-session behavior and sibling shared-phone identity;
- Teacher lockout/unlock/reset/username-session behavior, read-only permissions and no Student phone exposure;
- BUG-044 real PostgreSQL schedule edit plus classroom/time/capacity/level/cancel/restore/archive behavior;
- inactive Teacher rejection and future assignment cleanup;
- same-origin protection, security headers, invalid date/ID/audience/API-404 handling and rate limits;
- request-ID/error-log correlation, Admin log search/detail/resolve and secret redaction;
- `/healthz`, `/readyz`, DB-unavailable readiness and SIGTERM shutdown behavior.

Run it only against a disposable DB:

```powershell
.\RUN_TESTS_WINDOWS.ps1
```

or manually:

```powershell
$env:ETUT_TEST_DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
$env:ETUT_TEST_DESTRUCTIVE="YES"
npm ci
npm run test:all
```

The suite drops/recreates the `public` schema multiple times. **Never point it at production.**

### Real authenticated browser suite

Status: **NOT EXECUTED HERE**.

Chromium is present in the sandbox, but the application cannot be booted here without installed npm dependencies and a reachable PostgreSQL runtime, so it would be misleading to call authenticated Student/Teacher/Admin browser flows PASS.

After deployment, perform the Stage-2 smoke test in `DEPLOY_CHECKLIST.md`, including widths 320/360/390/430/768/900/1024+/desktop where practical, both light/dark themes, public required links, Student `+ Yeni Etüt`, Teacher Today/Upcoming/Past/Weekly, Admin System Logs, schedule changes/cancellations and browser console/network checks.

## Current result summary

- Syntax checks: **PASS**
- Static regression checks: **21/21 PASS**
- PostgreSQL integration tests: **PASS — 75/75 external disposable-PostgreSQL run**
- Repeated concurrency tests: **PASS — included in the 75/75 external PostgreSQL run**
- Authenticated browser tests: **NOT AVAILABLE IN MODEL SANDBOX**
- npm advisory audit: **NOT AVAILABLE IN MODEL SANDBOX**
- Known static blockers after final review: **NONE IDENTIFIED**

This report intentionally does not claim that unexecuted runtime tests passed. If the disposable-database suite reports any failure, that result should be treated as a blocker and the specific failure output/request ID should be used for the next correction.
