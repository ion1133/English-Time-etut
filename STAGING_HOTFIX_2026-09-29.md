# English Time Etüt — staging hotfix, `2.2.0-candidate.3`

**Scope:** Repair the uploaded `2.2.0-candidate.2` source package. This is **staging-only**, not a production release or a claim that every workflow is verified against real PostgreSQL.

## Root cause confirmed from the operator's real failure

The deployed startup trace showed `TypeError: Cannot create property 'values' on number 'NaN'`, originating at `/app/db.js:543` in the legacy General English backfill, *after* database migrations 3 and 4 had been recorded. In candidate.2, that `client.query()` call used a **single-quoted JavaScript string containing an unescaped SQL single quote** in `string_to_array(level,'-')`. JavaScript legally interpreted this as subtracting two strings, producing `NaN`. PostgreSQL's Node client then received `NaN` instead of SQL text. That is why `node --check`, the source regex audit, and pure quota tests missed it.

**Fixed:** The entire SQL statement is now a JavaScript template string, retaining the SQL `'-'` separator and bound parameters. A new fake-PG startup regression test runs the real `db.init()` JavaScript through the already-migrated path **and** a simulated legacy v3/v4 adoption path; every `query` rejects a non-string SQL argument. The regression failed with `NaN` on the uploaded candidate.2 and passes on candidate.3.

## Other source improvements with regression evidence

1. **Startup advisory-lock connection cleanup:** When acquisition of the startup PG advisory lock throws before entry to the old `try/finally`, the reserved pool connection could leak on every startup retry. Acquisition is now inside `try`, and unlock is attempted only after a successful lock. Mock regression simulates failed lock acquisition and verifies the client gets released.
2. **Diagnostic log accuracy:** Absent `status_code` and `user_id` used to be converted by `Number(null)` into misleading `0` values. Optional numeric log fields now remain SQL `NULL` when absent. The startup mock verifies both parameters.
3. **Repeatable regression:** Added `npm run test:startup-mock` and `npm run test:local`; bumped *both* package manifest and lockfile root metadata to `2.2.0-candidate.3`. Added `.gitignore` for local secrets, generated reports, and dependencies.

A static AST inspection of the project's `db.js`, `server.js`, `upgrade-routes.js`, messaging, snapshot and test scripts found no other non-string arithmetic expressions in first arguments of SQL query calls. This is **not** a guarantee that every SQL statement or feature is correct at PostgreSQL runtime.

## Tests performed against these source bytes

| Verification | Observed result | Scope |
|---|---|---|
| `npm run test:syntax` | PASS | Node 22.16.0 parser for server, database, UI, snapshot and test scripts |
| `npm run test:static` | 21/21 PASS | Existing source-level security and regressions |
| `npm run test:upgrade:unit` | 33/33 PASS | Weekly policy/date/category logic, no database |
| `npm run test:startup-mock` | 3/3 PASS | 72 already-migrated query calls; 96 legacy-adoption calls; lock-failure cleanup |
| Live PostgreSQL, permissions, and booking-concurrency integration | **NOT RUN HERE** | Requires a completely separate disposable test DB. Both integration suites DROP its entire `public` schema. |
| Actual restored Kızılay clone snapshot comparison | **NOT RUN HERE** | Only operator's private Coolify container has access to `/private/etut-before.json` and `etut_staging_clone`. |
| Browser-based admin/student/teacher/manual acceptance | **NOT RUN HERE** | Requires reachable privately staged application and test accounts. |
| Fresh npm audit after patch | **NOT COMPLETED HERE** | Registry inaccessible from this sandbox. Operator's previous audit reported a remaining transitive `uuid@8.3.2` advisory under `exceljs@4.4.0` after normal `npm audit fix`. Do not use `npm audit fix --force` or an untested `uuid` override. |

Existing archived docs describe *historical* 2.1.x test runs; this status section is the controlling validation note for **candidate.3**.

## Specific safe continuation for the operator's current environment

The operator's screenshots showed a completed **pre-upgrade baseline** saved at `/private/etut-before.json` on the **staging app's persistent volume**; `etut_staging_clone` had subsequently recorded migrations 1–4 and `branch_identity='kizilay'`. Staging initialization failed at the bug addressed here; original selected record *counts* remained 15 students, 7 teachers, 19 bookings, 36 booking_slots. **Counts alone do not prove row-level preservation.**

**Do not take another `before` snapshot. Do not delete or overwrite `/private/etut-before.json`. Do not restore the clone to avoid the error—startup should resume safely against its already-migrated schema after installing this fix.**

1. On Windows, unpack this ZIP as project root and run `npm ci` then `npm run test:local`. Stop on a failure. Do not upload `node_modules` or `.env`.
2. **Stage only:** upload the ZIP's *contents* (not an enclosing folder) to the **`staging` branch** of the existing repository and commit. Verify that `package.json` reads `2.2.0-candidate.3`. Do **not** modify `main` or the existing Kızılay production app. In Coolify choose `english-time-etut:staging` only; keep `DATABASE_URL` pointing to the internal **`etut_staging_clone`** database; `BRANCH_CODE=kizilay`, existing verification variables, private `/private` volume, **no public domain** and `node server.js` as the start command. No credentials should be pasted into chat or GitHub. Deploy this new staging commit, forcing a clean build only if Coolify reuses the old image.
3. Check **Runtime Logs** for `Database ready`, not merely a deployment `Success` or listening port. From the running **staging application container** (not the PostgreSQL container), execute the **read-only** comparison: `node scripts/snapshot-clone.js compare /private/etut-before.json`. It must report `Restored-copy data-preservation comparison: PASS`. A FAIL is a release blocker; do not delete the manifest or relax the comparator. Repeat after restarting **staging only**. `GET /readyz` must return 200 after both starts.

**Separate gate before production:** Run `npm run test:integration` and `npm run test:upgrade:integration` against a NEW database whose name contains `test`/`scratch`/`disposable`, with `ETUT_TEST_DATABASE_URL` set to THAT resource and `ETUT_TEST_DESTRUCTIVE=YES`. The suites destroy the test DB's public schema. They must **never** be run on `etut_staging_clone`, Kızılay production, or either future branch DB. Resolve remaining package advisories in a separate reviewed patch, complete the actual staged browser and isolation checks, verify backup/rollback, then consider production.
