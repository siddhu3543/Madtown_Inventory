# Changelog

## 0.1.0 — 10 Nov 2026 (build baseline, pending Naveen's v1.0 approval)
- Architecture, data model, decision log, open-question register and traceability matrix (docs/).
- Database: 7 Supabase-compatible migrations — schema for all section 6 entities, workflow functions, RLS for every table, finance split tables, append-only audit log, double-checkout and holdings constraints, reference data.
- Phase 1 MVP: login (@madtown.in), roles, catalog/search/filters/saved views, item add/edit/retire/delete-in-error, QR labels and scanning, check-out/check-in with photos and due dates, transfers, extensions, back-dating, partial returns, borrowers without login, parent links and missing parts, lost/missing records, audit log, email reminders/escalation, dashboard, Sheets mirror, backups/export, unsorted items, sheet import with per-row report, settings.
- Phase 2: maintenance lifecycle and schedules, incidents and resolutions with Owner write-off, kits with checklists, reservations, to-buy with approvals and options, orders with receive-to-stock, walkthrough audits with variance and corrections, reports (loans, repairs, utilisation, pick list), weekly summary, offline queue, Counted→Single split (proposal), Slack adapter (disabled).
- Phase 3 built early: total cost of ownership, walkthrough quick notes, asset value at purchase price. Rest on the roadmap.
- Tests: unit, integration (DB, RLS matrix, concurrency, jobs, import acceptance, backup drill) and Playwright E2E on mobile and desktop.
