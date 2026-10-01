# TEST REPORT — 2.2.0-candidate.2 (2026-09-24)

**Status:** PRE-PRODUCTION; results apply ONLY to local source/static checks. Do not interpret any unexecuted suite as passing.

| Check | Actual result | Meaning |
|---|---|---|
| Baseline ZIP original package version / inventory | 2.1.7, 26 original files | Baseline identified from uploaded source; SHA in source audit. |
| JavaScript syntax (`npm run test:syntax`) | **PASS** | Node parser passed all original and new source/test scripts included in command. |
| Original source static audit (`npm run test:static`) | **PASS 21/21** | Original regex/source-level guards, NOT behavioral Postgres proof. |
| New policy unit suite (`npm run test:upgrade:unit`) | **PASS 33/33** | Mock-query checks of Istanbul calendar weeks, category grants and policy; NOT a live transaction test. |
| Clean candidate `npm ci` | **BLOCKED** | Network registry unavailable; offline retry failed `ENOTCACHED` for `zip-stream-4.1.1.tgz`. No dependencies were added; lockfile version updated. Re-run in connected isolated CI/staging. |
| `npm audit --omit=dev` | **BLOCKED** | Registry DNS/network error EAI_AGAIN, so vulnerabilities have NOT been ruled out. |
| Original destructive PostgreSQL `npm run test:integration` | **NOT RUN** | PostgreSQL server and an isolated disposable DB unavailable in this environment. Original 75/75 from an older narrative is NOT applicable. |
| New destructive PostgreSQL `npm run test:upgrade:integration` | **NOT RUN** | Added tests for clean new branches, immutable sentinel, private account boundaries, quota with 19 parallel same-identity calls, permissions, level requests and legacy synthetic fixture; needs an actual disposable PostgreSQL instance. |
| Restored actual Kızılay backup comparison | **NOT RUN — REQUIRED** | No authenticated Coolify/live data or restored backup provided; script is included. |
| Real browser UI smoke at 1440px and 390px | **BLOCKED** | Attempted Chromium/Playwright against local mock HTTP fixture; browser returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` for localhost. No assertion of visual/browser success. |
| Three real DNS / HTTPS / branch isolation deployments | **NOT RUN — OWNER ACTION** | No account access was provided and production deployment is not authorized until evidence gates pass. |

## Safe test execution after providing isolated staging infrastructure

From a clean checkout on a network-connected runner with Node >=20:

1. `npm ci` and `npm audit --omit=dev` (investigate reported advisories; never blindly `--force`).
2. `npm run test:syntax && npm run test:static && npm run test:upgrade:unit`.
3. Create a fresh, **disposable**, private PostgreSQL database with `test`/`scratch`/`disposable` in its DB NAME. Set `ETUT_TEST_DATABASE_URL` to that exact DB's private URL and `ETUT_TEST_DESTRUCTIVE=YES` only in the isolated runner. Run `npm run test:integration`, followed by `npm run test:upgrade:integration`. Both scripts DROP public schema. Never point them at branch DBs or a restored backup copy.
4. Use a different restored-copy database for `scripts/snapshot-clone.js before` / `compare`, where neither destructive suite is ever run. Require PASS after migration twice. Then execute authenticated mobile/desktop UI smoke flows against *private test accounts* on staged branches.
5. Record actual complete command outputs, deployment commit, test count, transaction concurrency outcomes and any defects; no production cutover before evidence is green.

## Known limitations for review

- No proof of syntactically correct **PostgreSQL-executed v3 DDL** or exact migration preservation without executing on a private disposable DB and restored clone.
- No proof of CSS/browser event behavior beyond static source review. UI automation was attempted and blocked by the local browser policy.
- Security choice for passwordless Student login and interpretation of public Junior/Teenage signup vs activity types remain awaiting owner approval.
- The baseline v2.1.7 system contains historical docs (`TEST_REPORT.md`) describing previous releases; do not treat them as current test evidence.

## 2026-09-27 candidate.2 update
Owner-approved preset change and category-catalog UI were applied. Syntax/static/unit results must be rerun for this exact package and recorded separately below. PostgreSQL integration, clone comparison and browser checks remain **not executed**.

**Rerun on 2026-09-27 for candidate.2:** Node v22.16.0 `npm run test:syntax` **PASS**, `npm run test:static` **21/21 PASS**, `npm run test:upgrade:unit` **33/33 PASS**. These are the actual completed checks for candidate.2; PostgreSQL integration, fresh `npm ci`, production clone preservation, and browser regressions **remain unverified**. The updated fixed-category DB preset and visual catalog require those tests before release.

## 2026-09-29 — candidate.3 corrective review (supersedes candidate.2 for this patch)

The user-provided candidate.2 was reproduced failing in a fake-PG startup execution: JavaScript evaluated the `db.js` General English booking backfill's malformed SQL string to numeric `NaN`, passed it to `client.query`, and caused the same class of error as the private staging runtime trace. Replaced the statement with a template string. Improved advisory-lock cleanup and optional numeric log fidelity; added `tests/init-query-shape.js`. All these are documented in `STAGING_HOTFIX_2026-09-29.md`.

Executed on Node v22.16.0 against the extracted user-provided installed dependencies: `npm run test:local` **PASS**: syntax (all scripted files including the new test), static audit **21/21**, upgrade policy **33/33**, fake-PG startup regression **3/3** (72 previously migrated query calls, 96 simulated v3/v4 adoption calls, and simulated failed-lock cleanup). Clean dependency fetch / independent fresh npm audit was blocked by this sandbox's inaccessible npm registry; the user's separate Windows report showed the ExcelJS/uuid transitive advisory still needs assessment. **No actual PostgreSQL integration or restored-private-clone compare was run in this environment, so release remains BLOCKED pending those operator checks.**
