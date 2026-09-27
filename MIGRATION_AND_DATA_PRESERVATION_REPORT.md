# MIGRATION AND DATA-PRESERVATION RECORD

**Gate: BLOCKED — NO ACCESS TO CURRENT LIVE KIZILAY DATABASE OR RESTORED BACKUP.** No real production backup, row count, hash, Coolify resource identity, Git commit or migration result has been asserted or fabricated.

## Staged additive migration

- Keep original v1 baseline and v2 hardening unchanged; append v3 `branch_categories_weekly_policy` and v4 `teenage_fifth_level` in `db.js` using existing startup advisory locking. v4 idempotently adds Teenage 5 where missing, including previously seeded candidate staging DBs.
- Add immutable database `branch_identity` sentinel. A preexisting legacy DB will not adopt itself automatically: it requires branch `kizilay` and runtime `KIZILAY_ADOPTION_APPROVED=YES`, supplied **only after** a verified backup and restored-copy migration checks. A mismatch between app branch and DB sentinel fails readiness before v1/v2/v3 migrations.
- Add per-branch subject/category presets, ordered levels, Student enrollments, grants, level change requests, dated category snapshot columns, recurrence eligibility mapping and per-student weekly overrides. Retain legacy `students.level`, `slots.level`, dated snapshots, original identities/IDs, cancellation history and hashed Admin credentials.
- On Kızılay v3 adoption, map existing General English levels and old combined levels into normalized tables without copying them into other branches. Existing admin settings remain intact; weekly cap initially blank means unlimited.
- On newly empty Keçiören and Pursaklar PostgreSQL databases, run the identical source with distinct branch variables and `SEED_DEFAULT_SCHEDULE=false`; presets are allowed but students, teachers, bookings and recurring slots must start at zero.

## Required RESTORED-COPY evidence to open gate

1. In Coolify, identify the exact existing Kızılay private PostgreSQL resource from the **currently running app's saved internal DATABASE_URL**, without copying secrets into documentation. Confirm the currently deployed code really corresponds to the ZIP baseline or supply the newest live source before migration.
2. Trigger a full database backup and confirm a real, nonempty artifact and recoverable off-server copy. Keep the previous running app, original DB and main domain untouched.
3. Create a **separate, private, disposable restored clone** with a distinguishable DB name such as `kizilay_restored_clone` (never Kızılay's production DB), then restore the backup into this clone. Restore operations overwrite their target: double-check the selected resource.
4. An authorized operator in the isolated staging environment runs `node scripts/snapshot-clone.js before /private/etut-before.json` with **the clone's own private DATABASE_URL**, `ETUT_RESTORED_CLONE=YES`, and `ETUT_CLONE_DATABASE_NAME_CONFIRM=<exact clone dbname>`. This creates a PII-safe digest/count baseline; do not publish the digest manifest.
5. Deploy the candidate only to a **private staging app pointed at this clone** with `BRANCH_CODE=kizilay`, current secret value preserved inside Coolify and `KIZILAY_ADOPTION_APPROVED=YES`. Re-run its startup migration by restarting **the staging app only**; v3/v4 must be idempotent. Never run `tests/integration.js` or `tests/upgrade-integration.js` on a restored real-data clone: those scripts delete test schemas.
6. Operator runs `node scripts/snapshot-clone.js compare /private/etut-before.json` with the same clone-only environment. Require PASS for every old-table row hash, counts, original settings and credentials; then manually inspect a representative anonymized mix of historical A1–C2/combined-level, booked/cancelled/completed/archived records and original Admin/Teacher/Student access. Investigate ANY failed row/hash comparison rather than weakening the assertion. Record the real result and source commit.
7. Run both destructive suites separately against **another completely disposable, empty test DB** whose actual database name includes `test`, `scratch` or `disposable`, with `ETUT_TEST_DESTRUCTIVE=YES`. Complete parallel booking/capacity test and compare branch identities.

## First production cutover rules

Only after owner business policy approval, PASS on both disposable-db suites, PASS on restored-copy comparison and a browser smoke test should Kızılay's existing Coolify app use the approved commit. Keep its exact existing DB resource, original `DATABASE_URL`, stable `SESSION_SECRET`, persisted Admin hash and original apex hostname. Before starting the final app, set branch identity explicitly. Log/compare important pre- and post-cutover counts.

**Rollback:** If a new app is unhealthy, stop only that branch and revert its app to last known commit. For Kızılay, first disable new writes / stop app, preserve a fresh post-incident backup **before** any DB restore, verify whether post-cutover bookings exist, and prefer safe forward repair of additive schema when possible. Never blindly restore a pre-cutover backup over newer bookings. For a fully approved destructive restoration, perform it on a private clone first, secure incident authorization and only then restore the exact production resource. Remove `KIZILAY_ADOPTION_APPROVED` afterward; the permanent DB sentinel guards subsequent restarts.

**Observed evidence this run:** source syntax/static/policy tests only; PostgreSQL, restored clone and live account checks were not available. Therefore zero production data preservation has been experimentally proven.
