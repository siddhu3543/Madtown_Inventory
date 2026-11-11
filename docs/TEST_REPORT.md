# Test report — build 0.1.0 (10 Nov 2026)

Per Part A6, a feature is only "tested" when an automated test or documented manual test actually ran. Everything below ran in the build workspace on 10 Nov 2026. The raw reports are `test-results/vitest.json` and `test-results/e2e.json`. Per-requirement status is in `docs/RTM.md`.

## Environment under test ("in-workspace staging")
- PostgreSQL 16.15 with the 7 project migrations (Supabase shim, ADR-02). App login role `app_server`: not superuser, no BYPASSRLS.
- Next.js 15.5 **production build** (`next build && next start`), local auth provider, local disk storage, email outbox with sandbox redirect, CSV mirror.
- Data: **synthetic** reconstruction of the 3 sheet tabs (fixtures/README.md) plus 6 synthetic test logins.
- Browsers: Chromium (Playwright 1.63) emulating Pixel 7, iPhone 13 (viewport and UA) and desktop. WebKit and real devices were not available.
- **Not tested here:** Supabase Auth/Google, Google Drive, Google Sheets API, Resend delivery, Vercel cron. The build workspace cannot reach those services and no accounts exist yet (KNOWN_ISSUES K-01..K-06).

## Commands and final results

| Command | Result |
|---|---|
| `npx prettier --check` (src, tests, scripts) | All files formatted |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | 0 errors |
| `npx vitest run` | **118 / 118 passed** (10 files) |
| `npx next build` | Compiled, 52 routes |
| `npx playwright test` | **36 / 36 passed** (android 14, iphone 3, desktop 19) |
| Import dry-run of the fixture | succeeded: 103 items, 25 to-buy, 10 unsorted, 0 errors, 91 warnings (per-row report) |
| Mobile overflow sweep (24 screens, Pixel 7) | 0 screens with horizontal scrolling |

### Suites
| Suite | Tests | Covers |
|---|---|---|
| unit/core | 14 | domain rule (AC-NFR-01), IST/Rs formats (NFR-020), QR parsing, label ranges, error mapping |
| unit/importer | 11 | every MIG rule and 11.2–11.4 mapping, fixture statistics |
| integration/workflows | 21 | IDs, check-out/in, photos, overdue block/override, extensions, transfer, back-dating, kits, lost/found, write-off, guards, audit, finance hiding |
| integration/concurrency | 3 | 10 simultaneous check-outs of one item → exactly 1; last counted unit; concurrent ID allocation |
| integration/import-acceptance | 29 | AC-CAT-01..05, AC-PHO-01/03, AC-CON-01/03, AC-LST-01/02, AC-LOAN-02/03, AC-KIT-03, AC-BUY-01, AC-CHK-01..05, AC-AUD-01 on imported data |
| integration/rls-matrix | 17 | direct database requests as Owner, Manager, Team member, Read-only, developer, anonymous (A5) |
| integration/jobs | 7 | AC-LOAN-01 timing with a simulated clock, escalation day 3, reminder counts, weekly summary/missing/repair overdue, AC-RPT-02 mirror |
| integration/phase2-extras, remaining | 15 | split, reservations, verify-first, photo promotion, walkthrough corrections, reports, schedules, TCO, detached accessories, storage adapter |
| integration/backup-restore | 1 | NFR-010 drill: dump → restore → identical counts in 11 tables, constraints, grants and RLS intact |
| e2e (Playwright) | 36 | real browser flows for every Phase 1 AC plus kits, procurement, found, walkthrough, repairs, offline queue, photo retry, offboarding, NFR-024 |

## Defects found by testing, fixed and retested

| # | Found by | Defect | Fix | Retest |
|---|---|---|---|---|
| 1 | integration/workflows (first run) | Deferred holdings constraint trigger ran as the calling user and failed with "permission denied for function check_item_holdings" | Trigger function made SECURITY DEFINER | 24/24 pass |
| 2 | design review before tests | Workflow-field guard depended on a session flag that a direct API caller could in principle set | Guard now checks `current_user` (`authenticated` blocked; definer workflows allowed) | rls-matrix + workflows pass |
| 3 | import inspection of staging data | MTMH_115, owned and held by Anand, was imported as an open loan to its own owner | An owner holding their own item is now recorded as custodian | unit test "owner holding their own item" |
| 4 | integration/backup-restore | Restore failed ("schema public already exists"); restored DB also lost grants | Restore list filters the schema entry; privileges kept in dump and restore | drill passes, grants/RLS asserted |
| 5 | e2e AC-LST-03 | "Marked as found" confirmation vanished because the form unmounts once the item is Available | Redirect with a page-level confirmation banner | pass |
| 6 | e2e AC-CHK-03 | Browser `max` on quantity blocked submission, so the server's "only 1 available" message never showed | Removed client max; server is authoritative | pass |
| 7 | e2e offline | Check-out page not in the offline cache; a server-rendered `client_uuid` could be reused by a cached page | SW caches `/items/<id>/checkout`; UUID generated at queue time only | pass |
| 8 | e2e offboarding | Offboard confirmation lost on re-render | Redirect banner | pass |
| 9 | e2e offline | Queue banner updated only every 5 s | Event-driven update on enqueue/sync | pass |
| 10 | visual check (Pixel 7) | Item page wider than the phone (grid min-width), long "To verify" badges and two tables forced horizontal scrolling | `minmax(0,1fr)` grid, wrapping badges, section-level horizontal scroll | 0 overflowing screens of 24 |
| 11 | e2e NFR-024 (new check) | Small buttons 15.2 px and secondary text 14 px on phones (< 16 px) | 16 px minimum at phone widths | pass |
| 12 | visual check | Dashboard tile "Out now" (items) next to a list "Out now" counting loans (19 vs 21) | List renamed "Open loans" | — |
| 13 | e2e audit | Role-restricted page threw → generic production error page | Redirect to /forbidden with explanation | pass |
| 14 | code review | Walkthrough bulk-Missing caught a DB error inside the transaction (would abort it); walkthrough count correction would drop units already recorded Lost | Removed catch (only offered while open); Lost/In-repair holdings preserved | phase2-extras pass |
| 15 | code review | "To-buy from defect" swallowed an error inside a transaction | Manager-only update path; no swallowed errors | remaining.test pass |
| 16 | test defects | backdate test used a time before check-out; matchers asserted messages instead of codes | tests corrected | pass |

## Measurements
- Search "FX3" over 103 items: < 50 ms server-side (AC-CAT-03 requires < 1 s).
- `/i/MTMH_104` → item page rendered: 0.3–1.4 s in emulation (AC-QR-02 requires < 2 s; real phones on 4G still to test).

## Manual checks done
- Screenshots of the dashboard, item, check-out, labels and to-buy screens at Pixel 7 and desktop sizes; label sheet boxes measure 25 mm.

## What must still be tested by Madtown (section 13: tester Naveen or Anand)
1. Re-run the whole suite and the acceptance list on **the real sheet export** (D-34).
2. Deploy to Madtown's Supabase + Vercel staging and run `npx playwright test` against it.
3. Google sign-in with a madtown.in and a non-madtown account (AC-NFR-01 live).
4. Photo upload to the Drive shared drive; Sheets mirror write and protection; a real reminder email to the sandbox inbox.
5. AC-QR-02 on a real iPhone and Android phone; sunlight readability.
6. AC-NFR-03 restore from a Supabase daily backup into staging.
7. Phase 1 exit test: a real shoot run entirely through the app (section 12).
