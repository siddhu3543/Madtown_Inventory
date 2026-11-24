# Changelog

## Unreleased — two roles, photo uploads, mandatory borrower details (24 Nov 2026)
- **Roles: Admin and Staff only.** Owner and Manager become Admin; Team member and Read-only become Staff (migration
  `20261124000100_admin_staff_roles.sql` converts existing accounts). Admin sees and does everything. Staff run the desk:
  find/scan items, check out to any borrower (adding a new borrower), check in, report damage/loss, take photos.
  Every other page, export and database write is Admin-only — enforced in the database (workflow functions and RLS), the
  pages (`requireUser(["Admin"])`) and the menu. Purchase prices are Admin-only. Staff see a desk-focused dashboard.
- **Photo uploads fixed.** On Vercel the default store was the server's local disk, which is read-only, so every upload
  failed. Photos now go to a private Supabase Storage bucket (`item-photos`, created on first upload); a failed upload
  shows the reason instead of "retrying" forever. Settings shows which store is in use.
- **Check-out / check-in: borrower details are mandatory.** Check-out needs the borrower (no default), a new borrower's
  name + email + phone, an existing borrower's missing email/phone, purpose, due date and condition. Check-in needs the
  condition, Yes/No on damage and on missing parts (with a description when Yes), return notes, and where a lost item was
  last seen. Checked in the browser, the server (form and offline sync) and the database. Staff can record contact
  details but never see them.
- Forms keep what was typed when the server reports an error (React 19 cleared them after every submit).

## Unreleased — sheet import fixes (23 Nov 2026)
- Import review accepts one Excel workbook (.xlsx) with the tabs Sheet1, To buy and Not yet sorted; tabs are found by name or by their headers. One file per tab (CSV or .xlsx) still works.
- Real-sheet fixes: Stock written as 1.0 / 20.0, dates like "2026-10-16 00:00:00" or 16/10/2026, several photo links in one cell ("Previous photo: …" kept as history), new item types (e.g. Hard Disk) created instead of forced to Accessory, Posession text such as "Not at office, …" no longer creates fake people, free-text To buy / Not yet sorted statuses mapped (original text kept).
- Re-import: "Replace data from earlier imports" swaps what an earlier import created (for example the synthetic seed data); it stops if those items already have records made in the app. Without it, the error says what to do.
- Preview (dry-run) now runs with the same item-ID rules as a real import; errors are explained in words.
- Mapping rules for the real sheet are bundled with the app (src/lib/importer/mapping-rules.json), so the import no longer reads a file from disk at run time (which fails on Vercel).

## Unreleased — UI/UX redesign (visual layer only)
- New design system: light-first tokens with dark theme (OS default, switchable in the profile menu), one radius scale, soft shadows, restyled buttons/inputs/cards/badges/tables/tabs/alerts/toasts/dialogs (src/app/globals.css, src/components/ui.tsx). Existing class names and colour tokens are kept, so every module inherits the new look.
- App shell: grouped, collapsible sidebar (icon-rail mode with tooltips), mobile drawer, header with global search, always-visible Scan action, sync indicator and profile menu. Role-based link visibility unchanged; every route kept.
- Dashboard rebuilt: KPI tiles (test ids unchanged), attention list, status distribution, availability by type, procurement stages, recent loan activity — all from existing data.
- Items: sortable table on desktop that becomes a card list on phones, saved-view chips, filter panel with active-filter chips, paging (50/page), Export CSV and Add item kept.
- Forms: sectioned item form, sticky action bars, in-page confirmation dialog (replaces window.confirm), success toasts, inline error alerts; login, scanner, photo capture, error/forbidden/offline/404 pages redesigned.
- Added dependency: lucide-react (icons). No schema, server-action, API or permission changes.
- Test change: tests/e2e/auth.spec.ts now clicks the in-page "Confirm" button instead of accepting a native dialog.

## 0.1.0 — 10 Nov 2026 (build baseline, pending Naveen's v1.0 approval)
- Architecture, data model, decision log, open-question register and traceability matrix (docs/).
- Database: 7 Supabase-compatible migrations — schema for all section 6 entities, workflow functions, RLS for every table, finance split tables, append-only audit log, double-checkout and holdings constraints, reference data.
- Phase 1 MVP: login (@madtown.in), roles, catalog/search/filters/saved views, item add/edit/retire/delete-in-error, QR labels and scanning, check-out/check-in with photos and due dates, transfers, extensions, back-dating, partial returns, borrowers without login, parent links and missing parts, lost/missing records, audit log, email reminders/escalation, dashboard, Sheets mirror, backups/export, unsorted items, sheet import with per-row report, settings.
- Phase 2: maintenance lifecycle and schedules, incidents and resolutions with Owner write-off, kits with checklists, reservations, to-buy with approvals and options, orders with receive-to-stock, walkthrough audits with variance and corrections, reports (loans, repairs, utilisation, pick list), weekly summary, offline queue, Counted→Single split (proposal), Slack adapter (disabled).
- Phase 3 built early: total cost of ownership, walkthrough quick notes, asset value at purchase price. Rest on the roadmap.
- Tests: unit, integration (DB, RLS matrix, concurrency, jobs, import acceptance, backup drill) and Playwright E2E on mobile and desktop.
