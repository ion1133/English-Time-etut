# ENGLISH TIME ETÜT — BEGINNER-FRIENDLY THREE-BRANCH DEPLOYMENT

**CURRENT STATUS: DO NOT DEPLOY THIS CANDIDATE TO LIVE KIZILAY OR ALL THREE BRANCHES.** Owner's main business-rule answers are incorporated, but a real PostgreSQL run, restored-copy migration, browser verification and any source-version reconciliation have not yet passed. This guide is the exact intended release order AFTER they have passed. Existing applications/data have **not** been touched by this package.

## A. Who does what

**Already prepared locally in this package:** additive source changes, branch routing/sentinel, test runners, private-clone comparison script, templates for all three dashboards and a repository-root ZIP. **Not done and requiring your account/operator action:** real production backup and clone restoration, PostgreSQL staged test run, source/commit verification, DNS edits, new databases/apps, certificates, Coolify variables, deployment, mobile/desktop smoke and rollback rehearsal. No AI has authenticated access to your Cloudflare, Hetzner, GitHub or Coolify accounts here.

The work should still use your **one existing Hetzner server and single GitHub repository**. No terminal commands or public PostgreSQL port are needed for your routine dashboard steps; an isolated staging test runner/operator is needed for the destructive automated suites and digest comparison before release. Never send real passwords or `DATABASE_URL` in chats, GitHub commits or screenshots.

## B. What the three sites look like WHEN approved and deployed

- Kızılay: `https://kizilay.ankara-englishtimeetut.com` and the unchanged original `https://ankara-englishtimeetut.com` alias.
- Keçiören: `https://kecioren.ankara-englishtimeetut.com`.
- Pursaklar: `https://pursaklar.ankara-englishtimeetut.com`.

Every hostname provides `/admin`, `/teacher`, `/student`, `/readyz`, and the public booking page `/`. One identical **approved Git commit** serves three independently configured Coolify apps; **each has its own private PostgreSQL resource** and its own accounts/settings/notifications.

## C. Stage 0 — record evidence before touching production

1. Open Coolify → existing English Time project → your **currently live Etüt Kızılay app**. Record app name, currently deployed Git commit, domain, Node/runtime version, and linked DB resource name. Check the saved runtime variable `DATABASE_URL` yourself to determine the EXACT existing production database. Hide its password; never assume the similarly named test DB is production. Confirm the live source still matches the uploaded v2.1.7 baseline; if not, this candidate must be rebased on your newest live source.
2. Open Hetzner Console → your existing server. Read the **current** public IPv4; check measured RAM/CPU/disk spare capacity for two additional Node apps + two private PostgreSQL databases and their backups. Check that existing HTTPS works through inbound TCP 80/443; retain existing firewall and SSH rules. Do **not** publish/open TCP 5432 or 5433.
3. Open Cloudflare → `ankara-englishtimeetut.com` zone. Save a reference to the currently working main-domain DNS, SSL/TLS mode and proxy toggle; keep them unchanged. Do not assume remembered server IPs or DNS mode are correct.

## D. Stage 1 — protect every existing Kızılay student and booking (REQUIRED GATE)

1. Coolify → **the verified EXISTING Kızılay production PostgreSQL database** → Backups. Confirm automated backup schedule, run **Backup Now**, inspect its execution log, obtain a nonempty backup and protect at least one copy OFF the VM. Never select the old test DB. Backup docs are listed below.
2. Create a **new PRIVATE disposable restored-clone database**, clearly named like `kizilay_restored_clone`, with no published port. Restore the saved Kızılay backup **to this clone only** using Coolify's database restore/import action. Import overwrites the selected target; verify target name twice.
3. An authorized staging operator on your existing infrastructure prepares a private test runner with Node >=20 and PostgreSQL network access, executes `npm ci` / `npm audit`, syntax/static/unit suite, captures old-row counts/digests with `scripts/snapshot-clone.js before`, runs v3 migrations and staging restarts **twice only on the clone**, and runs `scripts/snapshot-clone.js compare`. Detailed exact environment and command names are in `MIGRATION_AND_DATA_PRESERVATION_REPORT.md` and `TEST_REPORT_NEW.md`. Do **not** run the destructive integration suites on this clone or against Kızılay production.
4. Separately, run the original and extended destructive suites against a **different entirely disposable empty TEST DB**. Require real test output including 19 simultaneous same-student booking calls and branch-mismatch fail-closed behavior. Save reports and the backup for rollback. **If any test or restored-copy comparison fails, stop.** There is no production-safe bypass.

## E. Stage 2 — one GitHub repository, staging first

1. From an **approved and freshly tested** version of this repository-root ZIP, select/extract **the files inside the ZIP** and upload them to your existing GitHub repo's root. GitHub should display `package.json`, `server.js`, `db.js`, `public/`, `tests/`, `scripts/` immediately at top level, not one extra folder. Never upload `.env`, database passwords or backups.
2. Prefer a separate `staging` Git branch or temporarily disable automatic Kızılay redeploy while new branches are proven. Keep a Git tag or exact previous Kızılay commit for application rollback. Verify `package.json` and `package-lock.json` have the same approved version.
3. Configure all **three apps to the exact same approved commit**, but retain the old live Kızılay application/commit until its migration gate is green.

## F. Stage 3 — three Cloudflare records, no other DNS edits

Open Cloudflare → your existing domain → DNS → Records. Create these names as `A` records and set Content to the **verified current Hetzner public IPv4**, TTL Auto:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `kizilay` | verified current Hetzner public IPv4 | match the proven working policy |
| A | `kecioren` | same verified IP | match proven TLS issuance/proxy policy |
| A | `pursaklar` | same verified IP | match proven TLS issuance/proxy policy |

If the existing setup uses a verified wildcard/CNAME instead, preserve that proven pattern and avoid conflicting duplicate records. Do **not** edit existing main-domain (`@`) or MX records. Have Coolify obtain valid origin HTTPS certificates for each new hostname; temporarily DNS-only can help validation if your existing setup allows it. Restore intended proxy policy after cert verification. Keep existing Cloudflare SSL/TLS configuration unchanged; use Full (strict) **only when origin certs are valid for the new hostnames**. Never try to fix a 525/526 error by globally switching to Flexible.

## G. Stage 4 — create TWO new private DBs, then TWO new apps

Coolify → existing English Time project/environment → Add Resource → PostgreSQL (prefer same major version as current proven production, for example 17). Create and Start:

- `english-time-etut-kecioren-db` — **Public Access OFF**; capture its own **Internal Connection URL** privately.
- `english-time-etut-pursaklar-db` — a **different** private resource; copy its different Internal Connection URL privately.

Leave the EXISTING Kızılay database untouched; do not duplicate real Kızılay people/bookings into either new DB. The DBs need network connectivity to their matching app through Coolify's internal network. Never guess DB internal hostnames or substitute public server IP.

Now Coolify → Add Resource → Application → select your single existing GitHub repository and **the approved staging commit/branch**. Create one new app named `english-time-etut-kecioren` with Keçiören's private DB URL and one named `english-time-etut-pursaklar` with Pursaklar's URL. Keep internal listener `PORT=3000`, existing working Node/Railpack build method from root `package.json`, the same code commit, but **independent runtime secrets and Admin passwords**.

Open each new app → Environment Variables: enter exactly the corresponding branch's variable NAMES from `ENV_EXAMPLE_SAFE.txt` and supply strong real values inside Coolify only. Set **Build time OFF / Runtime ON** for `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD` and the other app runtime variables to avoid leaking credentials into build layers or breaking `npm ci` under `NODE_ENV=production`. Never copy Kızılay's `DATABASE_URL` or `SESSION_SECRET` into the new apps.

Open the application's General → Domains. Associate only its own hostname with Coolify's reverse proxy. For an app listening internally on port 3000, documented Coolify setups accept a domain entry such as `https://kecioren.ankara-englishtimeetut.com:3000` (internal routing annotation, **not** a browser URL); use the equivalent Pursaklar hostname. Validate against the existing working Coolify version/routing mode, keeping container 3000 unexposed publicly. Enable an HTTP health check with GET `/readyz` on **container port 3000**, if available.

**First deploy Keçiören ONLY.** Confirm `https://kecioren.ankara-englishtimeetut.com/readyz` yields exactly HTTP 200 `{"ok":true}`, app logs show new version and DB ready, and initial students/teachers/bookings/slots are all ZERO. Its public `/`, `/admin`, `/teacher`, `/student` must load; log into its own Admin, create synthetic Teacher/Student accounts, set its desired weekly cap in Admin Settings, add a class, book, cancel, grant extra level and approve/reject a level request. Test Turkish/English and mobile/desktop. If all pass, repeat separately for Pursaklar using ONLY its private DB. Confirm test records from one new branch NEVER appear in the other or in unchanged Kızılay.

## H. Stage 5 — upgrade EXISTING Kızılay ONLY after its restored-copy gate PASS

1. Repeat fresh Kızılay production Backup Now immediately before release. Record exact old Git commit, important table counts, old runtime URL identity, hashed Admin login and current `SESSION_SECRET` as an unchanged private reference.
2. In EXISTING Kızılay Coolify application, switch ONLY its source commit to the approved verified commit. Keep its existing database resource, exact `DATABASE_URL`, stable `SESSION_SECRET`, persisted Admin hash and original main domain untouched. Enter Kızılay's nonsecret identity variables per `ENV_EXAMPLE_SAFE.txt`, plus the **temporary** `KIZILAY_ADOPTION_APPROVED=YES` only after the clone test was PASS. Never set Kız approval in a new branch.
3. Deploy this SINGLE app in a monitored release window. Verify the unchanged old apex domain first, HTTP 200 `{"ok":true}` on `/readyz`, historical Student/Teacher/Admin login and real existing sample records including cancellations, teacher assignment and combined levels. Do not proceed if counts/history differ from pre-deployment snapshot.
4. After the apex still works, attach the NEW `kizilay.ankara-englishtimeetut.com` as an ADDITIONAL domain in Kızılay's existing Coolify app (the equivalent `https://kizilay.ankara-englishtimeetut.com:3000` route if used by your version); validate independent HTTPS. Keep the old apex alias during transition to protect existing QR codes/bookmarks. Remove the temporary KIZ adoption flag after the permanent DB sentinel is verified.

## I. After all three are verified — backups, monitoring and rollback

Schedule **SEPARATE backups for all three** private databases, verify actual execution and off-server restore capability; monitor application and DB logs independently. Remove any leftover temporary test/public DB mapping or old public 5433 firewall allowance. Enable normal per-app GitHub redeploys from the same approved source only when the three branch smoke checks succeed.

**Rollback of a new empty branch:** stop its selected app and return to its preceding commit; investigate its own DB without touching either other branch. **Rollback of existing Kızılay:** stop new writes, preserve a *fresh post-incident backup* for any bookings made after cutover, revert the app to the previous known commit if compatible with additive schema, and verify readiness. Never blindly replace Kızılay's DB with the older backup: that could erase new bookings. If a DB restore becomes necessary, first prove it on a different private restore target and get explicit approval for handling post-cutover transactions. Keep the original verified backup protected throughout.

## Official help references for dashboard pages

- Coolify DB backups: https://coolify.io/docs/databases/backups
- Coolify DB restore: https://coolify.io/docs/databases/restore
- Coolify domain routing: https://coolify.io/docs/core/networking/domains
- Coolify runtime variables: https://coolify.io/docs/applications/configuration/environment-variables
- Coolify health checks: https://coolify.io/docs/applications/configuration/health-checks
- Cloudflare new subdomain records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/
- Cloudflare SSL Full (strict): https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
- Hetzner firewall guidance: https://docs.hetzner.com/cloud/firewalls/getting-started/creating-a-firewall/

These links reproduce the official reference destinations in the owner's uploaded playbook; do not assume dashboard labels or resource configurations were authenticated or verified here.
