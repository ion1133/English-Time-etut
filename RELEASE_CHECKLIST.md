# RELEASE GO / NO-GO CHECKLIST

Any unchecked line means **NO PRODUCTION CUTOVER**. A staging candidate is not an approved production release.

### Source and policy

- [x] Owner confirmed Admin-adjustable weekly cap without a forced default, fixed A1–C2 / Teenage 1–5 / Junior 1–6 categories, dynamic Admin-added categories visible in Student Panel, and retention of passwordless Student login. Other business-rule defaults are documented; QA gate remains closed.
- [ ] Current LIVE Kızılay deployed source/commit/version confirmed to match modified baseline; merge newer fixes if not.
- [ ] Full file diff reviewed; no accidental secret/PII; source and lockfile frozen to one approved SHA.
- [ ] Clean internet-connected `npm ci`, `npm audit`, syntax 100%, original static 21/21 and upgrade unit 33/33.

### Data migration, isolation and concurrency

- [ ] Exact existing Kızılay app and private DB resource verified in Coolify; NEVER select `english-time-etut-test` or unrelated DB.
- [ ] Current full DB backup created, nonempty and **restored successfully** into a separate private disposable clone; at least one off-server copy secure.
- [ ] Read-only `snapshot-clone.js before` recorded on clone BEFORE migration; new v3 migration/restart twice; `compare` PASS, old Admin hash/settings intact.
- [ ] Original and extended destructive suites run against a **different EMPTY disposable TEST DB ONLY**; all tests green, including exactly 17 fixed levels (6+5+6), Admin-changeable cap, dynamic category visibility and Admin-only category enrollment. Re-run concurrency after each fix.
- [ ] At least 19 simultaneous same-student booking calls cannot exceed quota; last-seat contention does not overbook; no deadlocks; mixed Sunday/Monday policy correct.
- [ ] Bad Keçiören/Pursaklar DB assignment results in `/readyz` 503 without modifying data. New blank KEC/PUR databases contain zero teachers/students/bookings/slots.

### Deployment and per-branch smoke

- [ ] Real Hetzner server capacity/public IPv4 verified; Cloudflare current TLS/proxy and apex DNS recorded.
- [ ] Stage on one GitHub branch/commit before any production auto-deploy; deploy Keçiören first, then Pursaklar; NO public database ports.
- [ ] Each subdomain valid HTTPS and `/readyz` returns HTTP 200 `{"ok":true}` only for correct private DB.
- [ ] Admin/Teacher/Student/public login, real browser mobile+desktop TR/EN, Admin course+level change inbox, exact-date roster, quota/deselection, cancellation and Teacher yellow-filled/black text verified with synthetic accounts on EACH NEW branch.
- [ ] KEC synthetic Teacher/Student/booking absent in PUR and KIZ; PUR synthetic records absent in KEC and KIZ.
- [ ] Kızılay backup-copy gate PASS immediately before KIZ cutover; existing DB/SESSION_SECRET/apex retained; historical booked/cancelled/completed records and Admin hash/login crosschecked after deploy.
- [ ] Kızılay new subdomain added as SECOND host (apex not redirected), original QR links verified.
- [ ] Each DB backup schedule and remote/off-server retention checked; remove any temporary public 5432/5433 firewall or DB mapping; errors/logs observed during cutover.
- [ ] Previous Git SHA/image and separate current DB backups available; rollback has clear owner and protection for post-cutover transactions.
