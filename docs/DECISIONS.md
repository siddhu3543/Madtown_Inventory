# Architecture decisions and decision log

Rule (Part A1): where the source is silent, ambiguous or contradictory, the build takes a **reversible, configurable default**, records it here, and the item stays **OPEN** until Naveen (product owner) confirms. Nothing here is a business decision made on Madtown's behalf.

Status key: **OPEN** = needs product-owner confirmation · **TECH** = technical decision within the developer's remit (Part A2/A4, section 10.1 "for Siddharth to decide") · **FIXED** = stated by the source.

## Architecture decision records (TECH)

| ID | Decision | Why |
|---|---|---|
| ADR-01 | Stack per Part A2: Next.js 15 App Router + TS, Tailwind, Supabase PostgreSQL + Auth, RLS, Vercel, Drive, Resend. | Agreed in A2; section 10.1 Option A. |
| ADR-02 | Local/CI database is native PostgreSQL 16 with a **Supabase shim migration** (`0000_local_supabase_shim.sql`: `auth` schema, `auth.uid()`, `auth.jwt()`, roles `anon`/`authenticated`/`service_role`). The shim is guarded and is a no-op on real Supabase. | No Docker daemon in the build workspace, so `supabase start` is unavailable. The shim reproduces exactly the primitives RLS policies use, so the same migrations and policies run unchanged on Supabase. |
| ADR-03 | The server talks to Postgres with `pg` and applies identity per transaction (`SET LOCAL ROLE authenticated` + `request.jwt.claims`), the same mechanism PostgREST uses. Browsers never receive a database key. | One enforcement path (RLS) for UI, API, exports and jobs; avoids exposing PostgREST so "guessed IDs / direct API" attacks hit the same policies (A5). |
| ADR-04 | Restricted financial fields live in **separate tables** (`item_financials`, `maintenance_costs`, `order_financials`, `wishlist_options`, `wishlist_financials`, `item_import_raw`) with `SELECT` policy `app.can_view_financials()`. | A5: RLS is row-level, so column hiding needs a separate table. |
| ADR-05 | A loan has one or more **loan_lines** (item, quantity, returned, lost). A Single item loan has one line; a kit loan has one line per kit part. A partial unique index on active lines of Single items makes a double check-out impossible at DB level. | FR-CHK-006, FR-KIT-004, FR-CHK-011, A5 race conditions. |
| ADR-06 | Counted items use **item_holdings** rows (holder person *or* location, status, quantity, optional loan). A deferred constraint trigger enforces `sum(quantity) = stock`; lost units are a holding row with status Lost (so "stock minus lost" = non-lost holdings, 6.6). | FR-CAT-006, 6.6 rule, R-06. |
| ADR-07 | Item ID allocation uses a monotonic counter table (`id_counters`), never `max(id)+1`, so deleted/retired IDs are never reused. | FR-CAT-001, MIG-002, AC-CAT-02. |
| ADR-08 | `AuthAdapter` with two providers: `supabase` (Google OAuth, staging/prod) and `local` (bcrypt password, **local/CI only**; refuses to start when `NODE_ENV=production` unless `ALLOW_LOCAL_AUTH=1` for the in-workspace staging build). Both enforce `@madtown.in`. | NFR-003, AC-NFR-01; testability without Google. |
| ADR-09 | Sessions are checked against `users.active` and `users.session_version` on every request; deactivating a user or bumping the version revokes access immediately. | NFR-006 same-day offboarding. |
| ADR-10 | Jobs are idempotent HTTP endpoints + a CLI runner; idempotency through `notifications_log.dedupe_key`. | Vercel Cron retries; avoid duplicate reminders. |
| ADR-11 | Photo bytes never enter the DB; `StorageAdapter` (Drive / LocalDisk, R2 & Supabase Storage slots). Photo row created `pending` before upload. | FR-PHO-004/008, NFR-002, A4 pending/retry. |
| ADR-12 | Kit IDs `KIT_NNN` (source 6.6 "proposed"), own QR `/k/KIT_NNN`. | FR-QR-001. |
| ADR-13 | Mirror implemented as nightly job + Owner "Sync now"; target sheet range protected (only the service account can edit). | OQ-S-06, A4. |
| ADR-14 | Email via Resend REST (OQ-S-07). Free tier 3,000 mails/month at time of writing — **verify pricing before quoting** (A7). | A2. |

## Decision log (interpretations, defaults and conflicts)

| ID | Topic | Source refs | Build default (configurable where noted) | Status |
|---|---|---|---|---|
| D-01 | Meaning of "Madtown" in Posession | 11.2, OQ-N-18 | Becomes holder **location "Office"** (name editable; Rushikonda to confirm). Status Available. | OPEN (OQ-N-18) |
| D-02 | Owner "Madtown" must be a `people` row but person_type enum has no organisation value | 6.2 owner_person_id, 6.4 | Added person_type value **Organisation** for the single Madtown row. | OPEN (minor schema extension) |
| D-03 | Item-level audit history visibility | FR-AUD-002, SCR-05, section 9 | Owner: global + item. Manager: item-level only. Team / Read-only: no audit diff (they see the item timeline of loans, repairs, incidents, photos, audits). | OPEN |
| D-04 | Who sees prices/costs | section 9 row 2, OQ-N-07 | Owner always. Manager **yes** ("to confirm"). Read-only **yes** ("accountant, to confirm"). Per-user override `users.finance_access` (on/off/role-default). Siddharth's developer account defaults to **off**. Settings → Roles. | OPEN (OQ-N-07) |
| D-05 | FR-CHK-007 says *warn* on overdue borrower; section 9 says *override a block* | FR-CHK-007, section 9 | Team member: **blocked**. Manager/Owner: warning dialog requiring a **recorded reason** to proceed. Setting `overdue_policy` = `block_team_override_manager` \| `warn_only`. | OPEN (OQ-N-06) |
| D-06 | "Override a block (double check-out)" vs FR-CHK-006 and G-01 (never two holders for one unit) | FR-CHK-006, section 9, G-01 | A Manager override **closes the stale open loan** (status Returned, reason "override: not physically with previous borrower", audit) and then creates the new loan. Two simultaneous active loans on one Single unit are never stored. For Counted items the override is "adjust stock with reason" (logged), not over-allocation. | OPEN |
| D-07 | Notes contain prices (e.g. MTMH_203 "Rs 21,999 incl GST") but notes are visible to Team; MIG says copy full notes | FR-CAT-012, 11.2 Notes, A5, NFR-004 | Full raw notes kept (restricted `item_import_raw`). The visible `notes` text is masked for non-finance roles at the DB view (`items_v`): `Rs 21,999` → `Rs ▒▒▒`. Same masking in CSV exports and the Sheets mirror (setting `mask_prices_in_notes`, default on). Purchase details parsed into `item_financials`. | OPEN |
| D-08 | To buy Notes hold vendor prices as text in Phase 1 | 11.4, FR-BUY-010 | Imported into `wishlist_items.notes` with the same masking for non-finance roles; options with prices go to restricted `wishlist_options`. | OPEN |
| D-09 | Condition values | FR-CON-001, OQ-N-16, C.2 | Enabled: **Good, Bad condition**. Fair and New exist but are **disabled** until Owner enables them (Settings). Ordering New > Good > Fair > Bad condition for "worse than" checks (FR-CHK-005). | OPEN (OQ-N-16) |
| D-10 | Lost units of Counted items | 6.6 "sum must equal stock minus lost", FR-LST-004 | Lost units are a holding row with status Lost and no holder; `sum(all holdings) = stock`; available = Available holdings only. | TECH |
| D-11 | Items held by a person with no loan (MIG-003 / OQ-N-19) | MIG-003, OQ-N-19 | Import as **open legacy loan, due date blank, To verify**. A mapping rule `custodian: true` (Import review screen) instead records the person as custodian holder without a loan. Reminders skip loans with no due date; they appear in "Legacy loans to confirm". | OPEN (OQ-N-19) |
| D-12 | Ownership from notes "after Naveen confirms" (MIG-004) | MIG-004, OQ-N-20, AC-CAT-04 | MTMH_115: owner **Anand** applied (the note itself records "per Naveen, 16 Oct 2026"). MTMH_187: owner stays Madtown, flagged **To verify: "Notes say Anand's Card — confirm owner"** until a mapping rule confirms. | OPEN (OQ-N-20) |
| D-13 | Default loan periods | FR-CHK-002, OQ-N-06 | Camera **2 days**, Tripod **7 days** (source proposal). All other Types: **7 days placeholder** shown as "not yet set by Owner". Owner edits in Settings. | OPEN (OQ-N-06) |
| D-14 | Mandatory photos | FR-CHK-003, G-03, OQ-N-08 | Check-out: ≥1 photo for **Camera, Lens, Drone** (source). Check-in: ≥1 photo for **Camera, Lens, Drone** (from G-03 "check-out and check-in photos exist for cameras and lenses"). Per-Type rules editable. | OPEN (OQ-N-08) |
| D-15 | Escalation | FR-LOAN-004, NTF-004 | After **3 days** overdue to the users configured as escalation recipients (seeded: Anand, Naveen). Days and recipients editable. | OPEN |
| D-16 | Reminder timing | NTF-001..003 | Due-soon when due time is within the next 24 h (hourly job, sent once). Due-today at **09:00 IST**. Overdue daily at **09:00 IST** until returned. Each bot email CC naveen@madtown.in (setting). | OPEN (A8) |
| D-17 | Counted → Single split suffix | FR-CAT-007, A4, OQ-S-05 | `MTMH_141-01`, `-02`, … (A4 proposal). Feature implemented; setting `split_enabled` default **on in staging, off in production** until approved. Parent stays as a group record (status Retired "Split into units"), history kept, child IDs never reused. | OPEN (A8) |
| D-18 | Due-date clock time | 6.5 due_at | Default due = check-out time + N days; user can change date and time. | TECH |
| D-19 | When is an item "Reserved" | 6.3 Status Reserved, FR-CHK-012 | Display status Reserved while an active reservation window covers *now* and the item is not out. Check-out by someone else during another person's reservation window warns; reservations cannot overlap (DB exclusion constraint). | TECH |
| D-20 | Owner deletion "only if created in error" | section 9, A5 | Owner can delete an item only if it has **no loans, repairs, incidents, audits or orders**; a reason is mandatory and the delete is audited. Otherwise the UI offers Retire. | OPEN |
| D-21 | Team member transfer/extend ("Own (extend once, to confirm)") | section 9 | Team: extend own loan **once** (setting `team_max_extensions = 1`); transfer own loan only to another active login user. Transfers to borrowers without login require Manager. | OPEN |
| D-22 | Missing items in asset value | FR-LST-008, FR-RPT-006 | Asset value excludes Lost, Retired and personally owned items; **Missing items are included but listed separately** ("at risk"). Items without a price are counted as "unpriced". | OPEN |
| D-23 | Sheets mirror layout | FR-RPT-009, AC-RPT-02 | Same 13 columns in the same order. Condition column shows `Lost` / `Repairing` when status is Lost / In repair (matching the current sheet convention), else the condition. Posession lists one name per unit for Counted items (e.g. `Madtown, Kittu`), `Lost` for lost items; "Madtown" is written for the Office location. To buy and Not yet sorted tabs mirrored too. Nightly **02:00 IST** (to confirm). | OPEN (A8) |
| D-24 | Missing photos view | FR-PHO-006, AC-PHO-03, FR-CAT-011 | Lists items whose stock image **or** latest photo is missing/invalid, with the reason (none, folder link, text "lost", text "Need replacement"). | TECH |
| D-25 | Developer access for Siddharth | A1, A3, section 2 | Role **Read-only** + `is_developer` flag: may view Import review / system status and run **staging** dry-run imports; no Owner powers; finance off by default. | FIXED by A1 (role) / OPEN (finance) |
| D-26 | Manager list | section 2, A1, OQ-N-01 | Seeded: Naveen = Owner; Anand = Manager; **Kittu = Manager (unconfirmed)** created as `people` only — no login until Naveen confirms. | OPEN (OQ-N-01) |
| D-27 | Verify-before-buy | FR-BUY-009 | Line flag `verify_first` + note; a line with an unverified flag cannot move to Approved/Ordered until someone records the verification (who/when/result). | TECH |
| D-28 | Write-off approval threshold | OQ-N-25 | All write-offs need Owner approval (no threshold). | OPEN (OQ-N-25) |
| D-29 | Who are "Managers" for NTF-005/006/007/014 | section 8 | Active users with role Manager; NTF-006/014 add Owner. | TECH |
| D-30 | Unsorted "SanDisk Extreme 128GB" possible duplicate | MIG-013 | Imported to unsorted with a duplicate warning linking MTMH_187; conversion blocked until marked "not a duplicate". | FIXED |
| D-31 | Legacy service year | MIG-005, AC-CON-03 | Service event stored with date 14 July, `year_to_verify = true`, year field empty (displayed "14 Jul (year to verify)"). | FIXED |
| D-32 | MTMH_106 holder vs vendor | C.1 | Holder Anand (sheet). Open Repair event in state **Sent for repair** (the note says "Sent for repair"), vendor and sent date unknown (blank, not guessed), issue text from the note, cause "lens cells shifted inside the carrier in transit", flagged To verify. | OPEN |
| D-33 | Weekly summary time | NTF-012 | Monday 09:00 IST (source "to confirm"). | OPEN |
| D-34 | Real sheet data | G-09, AC-CAT-01, AC-BUY-01 | The spec contains ~17 of 103 rows. Staging uses a **synthetic reconstruction** (`fixtures/sheet`) that reproduces all counts and quirks the spec documents. Acceptance must be re-run on the real export before sign-off. | OPEN (needs sheet export) |

## Open questions register

Every OQ from section 14 remains **OPEN** (Part A1). The build default for each is listed in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
