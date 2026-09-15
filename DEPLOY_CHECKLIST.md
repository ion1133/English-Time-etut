# Coolify deployment checklist

## Your first deployment with the new dedicated Etüt database

For this deployment, keep `english-time-etut-db` **Private** and set the Etüt application `DATABASE_URL` to that resource's **internal Postgres URL** in Coolify. Do not use the disposable `english-time-etut-test` URL and do not use the LinguaMetric database. Keep the same stable `SESSION_SECRET`; set a strong `ADMIN_PASSWORD` for the initial Admin bootstrap. The application will create/migrate its schema automatically on startup.

## Normal production deployment

1. Back up the existing production PostgreSQL database using your normal backup process.
2. Unzip this project and replace the project files in the existing GitHub repository.
3. Commit/push.
4. In Coolify, keep the existing Node/Railpack application and existing PostgreSQL resource.
5. Keep environment variables: `DATABASE_URL`, `NODE_ENV=production`, `PORT`, stable `SESSION_SECRET`, and `ADMIN_PASSWORD` if the database still needs its first secure Admin bootstrap.
6. Do **not** manually create/alter database tables and do not run SQL migrations by hand.
7. Redeploy the application.
8. Wait for `GET /readyz` to return HTTP 200. `/healthz` is liveness only and is not sufficient to declare the database ready.
9. Open `/admin`, `/teacher`, `/student` and `/` for the smoke test below.

No Redis, Firebase, Supabase, WebSockets, queue, second backend, separate frontend deployment, SMS, WhatsApp or email service is required.

## Required smoke test after redeploy

Use separate/private browser contexts for Admin, Teacher and Student. Verify Admin login; create/reset a temporary Teacher and verify Teacher login; create a Student booking from `/`; verify the same booking in Student/Teacher/Admin; cancel it from Student and confirm the seat frees while cancellation history remains; edit a future classroom/time and confirm affected panels update; reassign Teacher and confirm own-highlight moves; cancel and restore one dated occurrence; approve a temporary phone change and verify the old Student session/old phone no longer authenticate; deliberately reproduce any problem you find and copy its `X-Request-ID`/Admin System Log detail.

Also check public and Student navigation at narrow mobile widths, both light and dark themes, and confirm there are no unexplained browser-console exceptions or HTTP 500s.

## Temporary test database cleanup

The included destructive integration suite is for a disposable DB only. If you temporarily exposed a test PostgreSQL port/firewall rule, remove that rule and disable/delete the disposable database after testing. Never expose the production database merely to run this suite.

## If startup is not ready

- Check `/readyz` (503 means PostgreSQL/application readiness is not established).
- Check Coolify application logs; database-startup failures may occur before PostgreSQL-backed System Logs can be written.
- Confirm `DATABASE_URL`, `SESSION_SECRET`, and—only if there is no established Admin hash—`ADMIN_PASSWORD`.
- Do not manually patch production tables. Fix the deployment/configuration cause and redeploy.
