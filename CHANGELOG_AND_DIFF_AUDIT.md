# SOURCE AUDIT, CHANGELOG AND DIFF ACCOUNTING

**Status:** `2.2.0-candidate.2` — staging candidate ONLY. No claim of production data verification or zero regressions.

**Owner-provided baseline:** `English-Time-etut-main(3).zip` (package 2.1.7).
**Baseline archive SHA-256:** `7bf6996d18f9d549d08c0d7162c9cbcbcd390234e574e2e281e617de8057c87a`.
**Comparison method:** extracted all 26 original files; computed bytewise SHA-256 for each original path against the current staged source tree; compared existing modules and reviewed their route/data responsibilities against the supplied master prompt and architecture handout. Original application framework, logging subsystem, CSP and inactive legacy messaging module remain unchanged.

## Original files changed (11)

- `db.js` — Add guarded immutable branch identity, additive v3 category/enrollment/level-request/quota tables, default settings, idempotent General English backfill, new-branch blank schedule and fresh branch name.
- `package-lock.json` — Keep package lock root/version metadata consistent without adding dependencies.
- `package.json` — Mark unapproved release as 2.2.0-candidate.2 and add gated upgrade test commands.
- `public/admin.html` — Add category management, per-week cap, date-specific occurrence occupancy, per-student course grants and overrides, request inbox.
- `public/admin.js` — Connect new Admin controls to authenticated API and keep existing administration flows.
- `public/student.html` — Expose personal courses, available categories, request-level form and week allowance presentation.
- `public/student.js` — Add TR/EN course/request UI, quota-aware selection/deselection and category badges.
- `public/styles.css` — Scope accessible filled yellow/black contrast to own-booked Teacher tiles and add small new form layout styling.
- `public/teacher.js` — Implement own-with-active-booking yellow fill, display category as well as level; preserve cancellation priority.
- `server.js` — Reuse the original Express routes and transaction/locking path; add server-enforced category eligibility/weekly quota, exact slot mapping and category snapshots, independent public HTTPS URL and extended Admin/Student response fields.
- `tests/integration.js` — Require unmistakable disposable test database name and opt into sentinel adoption only inside the isolated legacy-fixture suite.

## Original files byte-for-byte unchanged (15)

- `DATABASE_MIGRATIONS.md`
- `DEPLOY_CHECKLIST.md`
- `FIX_REPORT.md`
- `LOGGING.md`
- `README.md`
- `RUN_TESTS_WINDOWS.ps1`
- `TEST_REPORT.md`
- `messaging.js`
- `public/app.js`
- `public/common.js`
- `public/index.html`
- `public/logo.png`
- `public/teacher.html`
- `tests/fixtures/legacy-schema.sql`
- `tests/static-audit.js`

## New standalone files

- `upgrade-rules.js`: Istanbul week calculations; category-specific enrollment and eligibility; single transaction-bound weekly quota helper.
- `upgrade-routes.js`: additional authenticated Admin and Student category, course, grant, weekly override, occurrence roster and request endpoints.
- `tests/upgrade-unit.js`: 33 executable policy-level tests with no database requirement.
- `tests/upgrade-integration.js`: additional safety-gated, destructive **disposable-database-only** PostgreSQL tests of branch identity, category authorization, requests, 19 parallel bookings and quota, and a synthetic legacy fixture. **Written, not executed here.**
- `scripts/snapshot-clone.js`: read-only comparison of original row hashes and counts in a **private restored staging clone only**, guarded by its exact database name. **Written, not executed here.**
- `TEST_REPORT_NEW.md`, `PRODUCT_DECISIONS.md`, `MIGRATION_AND_DATA_PRESERVATION_REPORT.md`, `OWNER_DEPLOYMENT_INSTRUCTIONS.md`, `RELEASE_CHECKLIST.md`, `ENV_EXAMPLE_SAFE.txt`: delivery records and safe operator procedure.

## Kept intentionally unchanged

`messaging.js` remains inactive (no SMS, WhatsApp or email). The original HTML templates for the Teacher and public landing pages, `public/app.js`, `public/common.js`, logo, fixture, logging guidance, legacy report, migration notes and original static-audit suite remain byte-for-byte untouched. No new service, library or GitHub repository is required.

## Engineering coverage and material limitations

The original v2.1.7 project has a Node/Express browser/API monolith, PostgreSQL `pg` pool with serial startup migration, local Istanbul date helpers, authenticated Admin and Teacher cookies and legacy passwordless Student cookies. Kızılay must retain the exact current private PostgreSQL resource; each additional branch gets an independent DB and application from the same repository.

Implementation includes the major scoped backend and UI changes. **Not yet proven**: integration against an actual PostgreSQL instance, the original destructive suite against the modified app, any real-production-backup restoration/comparison, browser/UI automation, installed dependency integrity against the fresh candidate, authenticated Cloudflare/Coolify/Hetzner account configuration, and true absence of all bugs. The deployment gate is CLOSED pending the attached evidence and owner decisions. One unresolved product boundary is whether Junior/Teenage self-signup or independent activity-type modeling is desired; this staged code deliberately keeps public self-signup as legacy General English only. A new standalone student-password migration has NOT been added without approval.

## 2026-09-27 owner decision corrections (candidate.2)
- Default fixed levels are now A1–C2, Junior 1–6 and Teenage 1–5 (17 preset levels). Migration v4 adds Teenage 5 idempotently for any staging DB that already recorded v3.
- Student Panel now lists all active categories, including future Admin-created categories, while un-enrolled categories remain non-bookable pending Admin enrollment. Existing passwordless student login is unchanged.
- All branches begin with an unrestricted weekly cap; each branch Admin sets or changes its own cap using the Settings page. Individual student overrides follow the documented defaults.
- The changes above require fresh PostgreSQL and browser verification before any production cutover.

## 2026-09-29 staging hotfix — candidate.3

- Fixed the confirmed source bug in `db.js` legacy booking category backfill where an unescaped SQL `'-'` inside a JavaScript single-quoted SQL string was parsed into `NaN`, blocking DB initialization after migrations 3/4.
- Moved startup advisory-lock acquisition inside its `try/finally`, so an interrupted or failed lock request cannot leak a pooled connection on every retry.
- Preserved optional log status and user IDs as SQL NULL rather than 0 when absent.
- Added the `tests/init-query-shape.js` non-database startup-path regression (both already-upgraded and legacy-v3/v4 paths plus lock failure), and the `test:startup-mock` / `test:local` npm scripts; bumped package and lockfile root version to candidate.3.
- See `STAGING_HOTFIX_2026-09-29.md` for test evidence, blocked runtime tests and the *specific* existing-clone recovery workflow. Do not treat previous candidate.2 evidence as evidence of complete production readiness.
