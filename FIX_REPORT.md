# FIX REPORT — English Time Etüt 2.1.3

## Final verification

The corrected 2.1.3 build completed the full real PostgreSQL integration/concurrency suite with **75 PASS / 0 FAIL / 75 total** in 180.9 seconds. The previously failing Teacher reassignment, BUG-044 booked-slot edit propagation, capacity snapshot, booking-vs-recurring-edit, cancelled-booking propagation, System Log pagination, and Admin password/session-refresh cases all passed in the final run. Syntax checks and the 21/21 static regression suite also pass.


This report maps the supplied BUG-001…BUG-045 and GAP-001…GAP-010 register to the corrected source. “Static PASS” means the code/syntax/static regression check was executed in this build environment. PostgreSQL-dependent tests are implemented in `tests/integration.js` but could not be executed from the model sandbox because outbound arbitrary PostgreSQL TCP is unavailable; they must be run against the disposable test DB, not production. No item is marked runtime-PASS unless it was actually executed.

## Critical / functional bug register

| ID | Correction | Main files | Verification status |
|---|---|---|---|
| BUG-001 | Removed predictable Admin bootstrap fallback; historical unsafe value is rejection-only; startup hashes an acceptable bootstrap with scrypt and clears plaintext. | `db.js`, `server.js` | Static PASS; PG test included. |
| BUG-002 | Booking and Admin schedule mutations use the same schedule/occurrence transaction locking protocol. | `server.js` | Static PASS; concurrency PG test included. |
| BUG-003 | Multi-occurrence advisory locks are de-duplicated and sorted by date then numeric slot ID before acquisition. | `server.js` | Static PASS; reversed-order concurrency test included. |
| BUG-004 | Authenticated Student booking locks/uses the current Student row by `req.student.id`; it never recreates the Student from stale identity strings. | `server.js` | Static PASS; PG race test included. |
| BUG-005 | Student profile changes and Admin phone approval lock the Student row before deriving `identity_key`, with compatible ordering. | `server.js` | Static PASS; concurrent invariant test included. |
| BUG-006 | Approved phone changes increment `session_version`; old Student cookies/old phone identity cease authenticating. | `server.js` | Static PASS; PG/API test included. |
| BUG-007 | Recurring slot removal is soft archive (`active=false`, `deleted_at`); history FKs are hardened against destructive cascade. | `db.js`, `server.js`, `public/admin.js` | Static PASS; migration/archive PG test included. |
| BUG-008 | Recurring slot save plus optional dated cancel/restore is handled within one server transaction; Admin frontend sends one logical save and reloads canonical state. | `server.js`, `public/admin.js` | Static PASS; PG rollback/coherence coverage included. |
| BUG-009 | Added destructive real-PostgreSQL integration/concurrency suite plus non-DB static regression suite. | `tests/*`, `package.json`, `RUN_TESTS_WINDOWS.ps1` | Test infrastructure implemented; static suite PASS; PG execution pending external test DB. |
| BUG-010 | Added persistent `initial_schedule_seeded`; empty schedule after first install is not treated as a fresh database. Startup initialization is advisory-lock serialized. | `db.js` | Static PASS; restart/no-reseed PG test included. |
| BUG-011 | Weekday change creates a per-materialized-occurrence plan; a move into the past/collision freezes the already-materialized occurrence and lets the new recurring rule apply safely later rather than collapsing dates. | `server.js` | Static review PASS; PG edge test recommended in external run/manual smoke. |
| BUG-012 | Recurring edits enumerate future state from `slot_occurrences`, `booking_slots` and `slot_cancellations`, not only active bookings. | `server.js` | Static PASS; PG schedule suite included. |
| BUG-013 | Schedule edits update all preserved booking statuses for the affected future occurrence, retaining each row’s status. | `server.js` | Static PASS; cancelled-row PG test included. |
| BUG-014 | Added configurable `max_weeks_ahead` (default 6) and server-side booking-window validation. | `db.js`, `server.js`, Admin UI | Static PASS; boundary/far-future cases represented in suite design. |
| BUG-015 | New booking requires the occurrence start time still to be in the future (Turkey time), not merely that it has not ended. | `server.js` | Static PASS; PG/API coverage included. |
| BUG-016 | Rejects overlap among selections and against existing active Student bookings inside the booking transaction. | `server.js`, Student UI | Static PASS; PG/API overlap test included. |
| BUG-017 | Admin recurring-slot create/update rejects active Teacher time overlap server-side. | `server.js` | Static PASS; PG/API test included. |
| BUG-018 | Admin recurring-slot create/update rejects effective classroom time overlap server-side, including default classroom resolution. | `server.js` | Static PASS; PG/API test included. |
| BUG-019 | `teacher_id` must resolve to an existing active, non-archived Teacher before assignment. | `server.js` | Static PASS; inactive-Teacher PG/API test included. |
| BUG-020 | Added paginated/searchable Admin bookings and Students endpoints; full data is discoverable instead of relying on permanently truncated client lists. | `server.js`, `public/admin.js` | Static PASS; endpoint PG test coverage included. |
| BUG-021 | Added paginated notification endpoints using deterministic descending notification IDs and `before_id`. | `server.js`, panel JS | Static PASS; PG pagination coverage included. |
| BUG-022 | Added lightweight revision domains and `/sync-state`; Student/Teacher/Admin polling reloads expensive state only when relevant revisions change and avoids overlapping polls. | `db.js`, `server.js`, panel JS | Static PASS (`setInterval` regression check). |
| BUG-023 | Admin QR is not cache-busted/regenerated on every polling cycle; server permits private QR caching. | `server.js`, `public/admin.js` | Static PASS. |
| BUG-024 | Public and Student schedule refreshes prune selection keys that are no longer valid/bookable and update user state/message. | `public/app.js`, `public/student.js` | Static review PASS; browser runtime pending. |
| BUG-025 | Student panel detects new important cancellation/schedule/account notifications during sync and surfaces an immediate toast while refreshing affected data. | `public/student.js` | Static review PASS; browser runtime pending. |
| BUG-026 | `/healthz` is liveness; `/readyz` remains 503 until `db.init()` (including migrations/bootstrap/seed decisions) completes, then verifies DB connectivity. A real disposable-PostgreSQL run exposed and corrected the earlier race where bare `SELECT 1` prematurely marked readiness. Failed DB init retries with bounded delay and secure-bootstrap fatal misconfiguration exits. | `server.js`, `tests/static-audit.js` | External PG run reproduced readiness race; corrected in 2.1.1; static regression PASS; full PG rerun required. |
| BUG-027 | HTML/JS/CSS use `Cache-Control: no-cache, must-revalidate`; compatibility no longer depends on manually incrementing a `?v=` token. | `server.js` | Static PASS. |
| BUG-028 | Added per-IP Student-login and public-booking rate limits without victim-specific lockout. | `server.js` | Static PASS; rate-limit API test included. |
| BUG-029 | Public identity mismatch returns generic mismatch text and does not disclose the stored CEFR level. | `server.js` | Static PASS; API test included. |
| BUG-030 | Added `admin_session_version` to signed Admin session validation and increments it on password change. | `db.js`, `server.js` | Static PASS; API session test included. |
| BUG-031 | Disables `X-Powered-By`; adds CSP, nosniff, frame protection, Referrer Policy and Permissions Policy. | `server.js` | Static PASS; HTTP header test included. |
| BUG-032 | Mutation requests enforce same-origin Origin/Host (plus SameSite cookies); explicit cross-site requests are rejected. | `server.js` | Static PASS; API test included. |
| BUG-033 | Added strict semantic ISO-date validation with UTC round-trip and uses it on dated inputs. | `server.js` | Static PASS; impossible-date API test included. |
| BUG-034 | Central positive-integer validation prevents malformed numeric route IDs reaching PostgreSQL casts. | `server.js` | Static PASS; API test included. |
| BUG-035 | `teacher_id` is null/empty or a positive integer, then validated against an active Teacher. | `server.js` | Static PASS; API test included. |
| BUG-036 | Announcement audience is an explicit `all/students/teachers` enum; typos return 400 rather than widening to everyone. | `server.js` | Static PASS; API test included. |
| BUG-037 | Unknown `/api/...` paths are intercepted before page fallback and return JSON 404. | `server.js` | Static PASS; API test included. |
| BUG-038 | Product-facing panel timestamp formatting and server scheduling calculations explicitly use `Europe/Istanbul`. | `server.js`, `public/common.js`, panel JS | Static PASS; browser runtime pending. |
| BUG-039 | Teacher NEW count/highlight is calculated only when the current Teacher owns the occurrence; reassignment stops old own-highlight relevance. 2.1.3 fixes the SQL-DATE shift that left the booked occurrence assigned to the old Teacher on Windows. | `server.js`, `public/teacher.js` | 2.1.2 real PG failure reproduced; corrected in 2.1.3; final real PG rerun PASS. |
| BUG-040 | Teacher username changes increment `session_version`. | `server.js` | Static PASS; API session test included. |
| BUG-041 | Teacher/Student force-logout routes verify affected-row count and return 404 for nonexistent accounts. | `server.js` | Static review PASS; API test path included. |
| BUG-042 | Admin booking removal locks/selects a non-deleted booking first; nonexistent/already-deleted requests return 404 instead of false success. | `server.js` | Static review PASS; API test path included. |
| BUG-043 | Broadcast retrieval is bounded by account `created_at`, so newly created Student/Teacher accounts do not inherit earlier broadcasts. | `server.js` | Static review PASS; PG notification coverage included. |
| BUG-044 | Corrected invalid outer-join lock to `FOR UPDATE OF s`; 2.1.3 additionally fixes cross-platform DATE normalization that caused booked occurrence snapshots to miss Admin edits despite the route succeeding. | `server.js` | 2.1.2 route returned 200 but snapshot stayed stale; root cause corrected; final real PG rerun PASS. |
| BUG-045 | Required public `Etütlerim`/Teacher links and Student `+ Yeni Etüt` remain visible/reachable with a responsive mobile action row down to narrow layouts. | `public/index.html`, `public/student.html`, `public/styles.css` | Static PASS; real browser viewport run pending. |

## Functional / maintenance gaps

| ID | Correction | Verification status |
|---|---|---|
| GAP-001 | Admin Teacher management exposes read-only recurring assignments (day/time/level/classroom/capacity). | Static review PASS. |
| GAP-002 | Teacher panel has Today / Upcoming / Past / Weekly Program views while preserving the weekly calendar. | Static review PASS. |
| GAP-003 | Admin Student booking history uses paginated `/students/:id/bookings`; no fixed 20-row cutoff. | Static PASS. |
| GAP-004 | Public booking tile combines Teacher + classroom when both exist. | Static PASS. |
| GAP-005 | Added `schema_migrations`, transactional/idempotent migrations and startup migration serialization. | Static PASS; fresh/legacy PG tests included. |
| GAP-006 | Added SIGTERM/SIGINT graceful HTTP shutdown and PostgreSQL pool close with bounded force timeout. | Static PASS; process test included. |
| GAP-007 | Panel polling uses recursive/in-flight-safe refresh behavior rather than overlapping `setInterval` calls. | Static PASS. |
| GAP-008 | Added separate schedule/booking/account/notification revisions while retaining a compatibility data revision. | Static PASS. |
| GAP-009 | Legacy `messaging.js` remains dormant; active product does not re-enable SMS/WhatsApp/email. | Static review PASS. |
| GAP-010 | Client/server name validation accepts Unicode letters/combining marks plus apostrophe, hyphen and spaces. | Static PASS; Unicode API case included. |

## Additional hardening completed during final review

- Startup migration/seed operations are now globally serialized using a PostgreSQL advisory session lock.
- System-log message/stack text gets defense-in-depth redaction for PostgreSQL URLs, password/secret/token assignment strings, bearer authorization and cookie text—not only metadata-key redaction.
- Deactivating/archiving a Teacher now uses schedule locking, removes that Teacher from future recurring/materialized/booking snapshots, notifies affected viewers, and preserves past history.
- The test-only intentional-error endpoint is compiled into the same server file but exists only when `NODE_ENV=test` and `ETUT_ENABLE_TEST_ROUTES=1`; it is absent in production.

## Unexecuted environment-dependent verification

The corrected package contains the real PostgreSQL test suite, but this model execution sandbox cannot initiate arbitrary outbound PostgreSQL TCP connections even though the user verified the disposable DB is externally reachable. Full DB/concurrency and authenticated browser-flow results therefore remain **NOT EXECUTED HERE**, not silently marked PASS. The project handout explicitly defines a two-stage handoff for this situation; see `TEST_REPORT.md` and `RUN_TESTS_WINDOWS.ps1`.


## 2.1.2 verification-harness correction

The real PostgreSQL 2.1.1 run reached 33 PASS results and then hit HTTP 409 while cancelling the capacity-test booking. The dashboard immediately before cancellation verified that booking was active, and no intervening action changed it. The remaining controlled 409 branch is the “session already ended” rule. The fixture had been created for tomorrow at 08:00 and could become today-at-08:00 if a long test run crossed Europe/Istanbul midnight. The integration fixtures are now two calendar days ahead and the cancellation assertion includes the API response body on any future failure. No production cancellation behavior was weakened.


## 2.1.3 corrections from the 75-case PostgreSQL run

The 2.1.2 real PostgreSQL run completed all phases and produced **68 PASS / 7 FAIL**. The failures were not hidden or removed. Five schedule failures traced to one production cross-platform date bug: SQL `DATE` values represented as local-midnight JavaScript `Date` objects were passed through `toISOString()`, shifting Europe/Istanbul dates to the previous UTC day on Windows. This made future schedule mutation logic update a neighboring date instead of the booked occurrence. Version 2.1.3 preserves the local calendar date when the input is a `Date`, so Teacher reassignment, booked-slot time/classroom edits, capacity snapshot preservation, concurrent booking-vs-edit, and cancelled-row propagation operate on the intended occurrence.

Two additional real-runtime defects were fixed: Admin log pagination now respects `limit=1` instead of clamping to at least 10, and Admin overview now casts the TEXT `booking_slots.end_time` value to PostgreSQL `time` before comparing it with the current Istanbul time. The latter was the source of the 500 during the Admin-password session-version test, not the session-version refresh itself.

2.1.3 local verification: JavaScript syntax PASS; **21/21 static regression checks PASS**. The updated 75-case PostgreSQL suite was rerun against the disposable test database and passed **75/75**.
