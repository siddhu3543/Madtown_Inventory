# Madtown Inventory

Mobile-first installable web app that replaces the Google Sheet "Inventory: Madtown" as the live record of Madtown's production equipment: what Madtown owns, where each item is, who has it, its condition, and what needs repairing or buying.

Built from *Madtown Inventory — Complete Requirements & Technical Implementation Specification* (Part A addendum + Draft v0.1). Status: **build baseline 0.1.0, awaiting Naveen's v1.0 approval** (Part A1). Every requirement ID is traced in [docs/RTM.md](docs/RTM.md).

## What is in here

| Area | Where |
|---|---|
| Architecture and decisions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) (ADRs + decision log D-01..D-34) |
| Data model and ER diagram (NFR-021) | [docs/DATA_MODEL.md](docs/DATA_MODEL.md), `supabase/migrations/` |
| Open questions with build defaults | [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — all OPEN |
| Traceability matrix | [docs/RTM.md](docs/RTM.md), [docs/rtm.csv](docs/rtm.csv) (`npm run rtm`) |
| Test report | [docs/TEST_REPORT.md](docs/TEST_REPORT.md) |
| Environments / local setup | [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) |
| Deployment, ownership, rollback | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Backup and restore | [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) |
| Offboarding | [docs/OFFBOARDING.md](docs/OFFBOARDING.md) |
| User guide | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) |
| Known issues | [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) |
| Synthetic sheet fixture | [fixtures/README.md](fixtures/README.md) |

## Stack (Part A2)
Next.js 15 (App Router, TypeScript) · Tailwind CSS 4 · PostgreSQL / Supabase with Row Level Security and SECURITY DEFINER workflow functions · Supabase Auth (Google, @madtown.in) · Google Drive (photos, behind a storage adapter) · Resend (email) · Google Sheets one-way mirror · Vercel (hosting + cron) · Vitest + Playwright.

## Quick start (local)
```bash
npm ci
bash scripts/local-postgres.sh                # PostgreSQL 16 on :54322
cp .env.example .env.local                    # set local values (see docs/ENVIRONMENTS.md)
npm run db:reset && npm run db:seed           # migrations + synthetic users + import of the synthetic sheet
npm run dev                                   # http://localhost:3000
```
Seeded logins (local only, password `SEED_PASSWORD`, default `madtown-staging-123`): naveen@madtown.in (Owner), anand@madtown.in (Manager), team.tester@madtown.in (Team member), accounts.tester@madtown.in (Read-only), siddharth.dev@madtown.in (Read-only + developer).

## Checks
```bash
npm run lint && npm run typecheck
npx vitest run                      # unit, integration, RLS matrix, concurrency, jobs, import acceptance, backup drill
npx next build && npx playwright test
npm run rtm
```

## Handover notes
- **The database is the enforcement point.** Business rules (double check-out, counted quantities, approvals, audit immutability, finance visibility) live in `supabase/migrations/`. UI checks in `src/lib/permissions.ts` only hide controls.
- **Workflow functions** `app.checkout`, `app.checkin`, … are the only way to change status, holder or stock. Direct updates by end users are rejected by trigger.
- **Requests run as the user**: `withUser()` in `src/lib/db.ts` sets `role authenticated` and the JWT claims per transaction, exactly like Supabase's Data API, so RLS applies everywhere. Jobs and import use `withService()`.
- **Adapters**: storage (`src/lib/adapters/storage.ts`), email/Slack/WhatsApp (`adapters/email.ts`), mirror (`services/mirror.ts`). Swap by environment variables; no data changes.
- **Jobs**: one hourly cron `/api/cron/all` (vercel.json); every job is idempotent via `notifications_log.dedupe_key`.
- **Staging copy for testing changes** (NFR-021): Supabase staging project + Vercel preview, seeded with the synthetic fixture (`npm run db:seed` against staging).
- **What is not done** is listed in docs/KNOWN_ISSUES.md — notably deployment to Madtown's own accounts and the import of the real sheet.

Madtown owns the code, accounts, data and photos (NFR-007).
