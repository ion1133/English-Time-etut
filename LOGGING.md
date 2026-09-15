# Admin System Logs / Error Center

## Request IDs

Every incoming HTTP request receives a request ID. A safe proxy-provided ID is accepted when it matches the allowed format; otherwise the server generates `crypto.randomUUID()`. The value is returned as `X-Request-ID`.

Unexpected API failures return a safe response similar to:

```json
{"error":"Sunucu hatası.","request_id":"..."}
```

Public, Student and Teacher responses never receive server stack traces. The corresponding server error uses the same request ID in `system_logs`, so Admin can search the exact failure.

## What is logged

`system_logs` is for technical/diagnostic events. It supports `DEBUG`, `INFO`, `WARN`, `ERROR`, and `CRITICAL`, with category/source, HTTP method/route/status, role/user ID, action, message, error name/code, sanitized stack, JSON metadata and resolved state.

Important unexpected route/database/startup/process failures are logged when PostgreSQL is available. Security-relevant events such as failed Admin authentication can be WARN events. Successful business changes continue to use `audit_logs` so normal audit history is not duplicated as technical errors.

Browser runtime errors are sent through the rate-limited `/api/client-errors` endpoint from `public/common.js` for `window.error`/unhandled promise rejection handling. Expected form validation is not intentionally logged as an ERROR.

## What is deliberately not logged

The logger redacts sensitive-key values and applies text-level redaction as defense in depth. Do not intentionally store:

- passwords or password hashes
- password reset values
- session cookies
- authorization/bearer tokens
- `SESSION_SECRET`
- raw `DATABASE_URL` / database credentials
- API keys/tokens
- full raw Cookie headers

Phone-like metadata fields are masked to the final digits where applicable. Diagnostic code should prefer internal Student/Teacher database IDs rather than private contact data.

If PostgreSQL itself is unavailable during startup, database-backed logging may be impossible; the server always writes startup/process diagnostics to stdout/stderr so Coolify Runtime Logs remain the fallback.

## Admin interface

Admin → System Logs provides filtering/search and pagination. Admin can filter by severity/category/resolved state, free text and request ID; open a row for full sanitized diagnostic fields; copy request information; mark an item resolved/reopen it; and export filtered CSV data. Student and Teacher routes have no access to these Admin log endpoints.

## Diagnosing a failure

When a problem happens during testing:

1. note the request ID shown by the API/UI or the `X-Request-ID` response header;
2. open Admin → System Logs;
3. search that request ID;
4. open its detail and capture route/status/message/error code/stack/metadata;
5. send the request ID + screenshot/log detail with the steps that reproduced the problem.

This should normally make follow-up debugging possible without first inspecting the container internals.

## Test coverage

The included PostgreSQL suite deliberately triggers a gated test-only exception when `NODE_ENV=test` and `ETUT_ENABLE_TEST_ROUTES=1`; it verifies a safe 500 response, request-ID correlation, Admin lookup/stack visibility, resolve behavior and secret-string redaction. The gated endpoint does not exist in production.
