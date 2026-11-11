# Backup and restore (NFR-008, NFR-009, NFR-010, AC-NFR-03)

| Layer | What | Where | Retention |
|---|---|---|---|
| Daily DB backup (NFR-008) | Supabase managed backup (Pro) | Supabase | 7 days (Pro); PITR add-on extends |
| Pre-release dump (A5) | `scripts/backup.sh <url>` (pg_dump custom format, schemas public/app/auth) | Madtown Drive "Backups" | keep 30 days |
| Weekly export (NFR-009) | CSV + JSON of all business tables, job `weekly-export` (Sunday 02:00 IST) | Drive folder `backups/` via storage adapter | keep 12 weeks |
| Readable copy | Google Sheets mirror (nightly) | Mirror sheet | current |

## Restore drill (must be done and written up before go-live — AC-NFR-03)
1. In Supabase (production) → Database → Backups, choose yesterday's backup → **Restore to a new project** (never over production).
   Or, from a logical dump: `scripts/restore-to-staging.sh <dump> <STAGING_DIRECT_URL>` (refuses URLs containing "prod").
2. Point a Vercel preview deployment's `DATABASE_URL` at the restored database.
3. Verify: item count equals production; open 3 items, a loan, the audit log; run `select count(*) from audit_log`; confirm the holdings
   constraint (`update item_holdings set quantity = quantity + 1 …` must fail) and that a Team member still cannot read `item_financials`.
4. Record date, backup used, row counts, who checked, time taken, in the phase checklist.

**Local evidence:** `tests/integration/backup-restore.test.ts` performs the drill automatically (dump → restore → identical counts for 11 tables,
audit immutability, holdings constraint, ID counter, grants and RLS intact). Passed — see docs/TEST_REPORT.md. The Supabase drill above still has to be run by Madtown.
