# Deployment guide (A3, NFR-007, OQ-S-11)

## 0. Accounts Madtown must own (Siddharth = collaborator) — NFR-007
- GitHub organisation/repository (Madtown), Vercel team (Madtown), two Supabase projects (staging, production), Google Workspace service
  account + shared drives, Resend account with the madtown.in domain verified (SPF/DKIM/DMARC), DNS for `inventory.madtown.in` (Naveen approves).

## 1. Supabase (each environment)
1. Create the project (region ap-south-1). Pro plan in production for daily backups (NFR-008).
2. Auth → Providers → Google: Workspace OAuth client restricted to madtown.in; set "Site URL" and redirect `https://<domain>/auth/callback`.
3. Apply migrations: `supabase link --project-ref <ref> && supabase db push` (the `…0000_local_supabase_shim.sql` file is a no-op on Supabase).
4. Data API: restrict exposed schemas to none or `graphql_public` only (the app talks to Postgres directly; RLS still protects all tables).
5. Database role for the app: use the pooler connection (`DATABASE_URL`) of a role that can `SET ROLE authenticated` and `service_role`, e.g.
   `create role app_server login password '…' noinherit; grant authenticated, service_role to app_server;`. Never use the service-role JWT in the app.
6. Settings to set in production: `split_enabled=false` until D-17 is approved; confirm every OPEN item in docs/OPEN_QUESTIONS.md.
7. First Owner login: insert Naveen's `users` row (Settings → Users needs one Owner first):
   `insert into public.people(name, person_type) values ('Naveen Pinapatruni','Staff'); insert into public.users(id, person_id, login_email, role) select '<auth uid>', id, 'naveen@madtown.in', 'Owner' from public.people where name='Naveen Pinapatruni';`

## 2. Google Drive and Sheets
- Service account (no domain-wide delegation needed) added as Content manager on the shared drive and Editor on the mirror spreadsheet.
- `GOOGLE_SERVICE_ACCOUNT_JSON_B64`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `MIRROR_SPREADSHEET_ID`. Protect every tab of the mirror so only the
  service account can edit (Data → Protect sheets; OQ-S-06). Share the mirror view-only with staff.

## 3. Vercel
- Import the GitHub repo; set env vars from `.env.example` per environment (Production / Preview). `CRON_SECRET` enables the hourly cron in `vercel.json` (Pro plan needed for hourly).
- Domains: `inventory.madtown.in` (prod), `staging.inventory.madtown.in` (preview branch `staging`). QR labels use `QR_BASE_URL/i/<ID>` — keep that path forever (A3).

## 4. Release procedure (A3: reviewed commits; A5: backup before release)
1. PR → CI (lint, typecheck, vitest against a disposable Postgres, playwright) → review → merge to `staging` → deploy preview → acceptance on staging.
2. Before production: take a logical backup `scripts/backup.sh "$PROD_DIRECT_URL"` and confirm the latest Supabase daily backup exists.
3. `supabase db push` (production) → merge to `main` → Vercel production deploy.
4. Rollback: Vercel "Instant rollback" to the previous deployment; database migrations are additive — if a migration must be undone, apply a
   forward fix migration, or restore from the pre-release backup into a new project and switch `DATABASE_URL` (docs/BACKUP_RESTORE.md).

## 5. Production import (MIG-015)
Dry-run in Import review on staging with the real CSVs until Naveen signs off the report → in production, Owner runs **FINAL** import once →
2-week parallel run, app is the only writer, sheet becomes the mirror → lock the old sheet (view only, section 11.1).
