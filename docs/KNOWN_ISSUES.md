# Known issues and limitations (honest status)

| # | Issue | Impact | Next step |
|---|---|---|---|
| K-01 | **Not deployed to Madtown staging.** Verification ran on an in-workspace staging (PostgreSQL 16 with a Supabase-compatible shim + the production Next.js build). | "Verified in staging" means this environment, not Vercel/Supabase. | Create the Madtown accounts (docs/DEPLOYMENT.md), deploy, re-run E2E with `PLAYWRIGHT_BASE_URL`. |
| K-02 | **Real sheet not supplied.** Import and acceptance tests use a synthetic reconstruction (fixtures/README.md). | Real-data surprises are possible. | Export the 3 tabs as CSV; dry-run; review warnings with Naveen and Anand. |
| K-03 | Google sign-in (Supabase adapter) written but not exercised. | AC-NFR-01 proven for the local provider and domain rule only. | Test on Supabase staging with a madtown.in and a gmail.com account. |
| K-04 | Google Drive storage adapter and Google Sheets mirror writer not exercised against Google (egress to Google is blocked in the build workspace). | Photos/mirror verified with local disk and CSV targets. | Configure service account; upload a photo; run Sync now; check protection. |
| K-05 | Resend email not exercised; staging uses the outbox. | Delivery, SPF/DKIM/DMARC unverified. | Verify domain, set `RESEND_API_KEY`, send a test reminder to the sandbox inbox. |
| K-06 | Camera QR decoding needs real devices; E2E emulates Pixel 7 / iPhone 13 viewports in Chromium only (WebKit not installed). | AC-QR-02 timing measured in emulation (≈0.3–1.4 s). | Scan MTMH_104 on a real iPhone and Android phone. |
| K-07 | All section 14 questions are OPEN; defaults are configurable (docs/OPEN_QUESTIONS.md). | Behaviour may change after answers. | Naveen to review DECISIONS.md / OPEN_QUESTIONS.md. |
| K-08 | Phase 3 items not built: WhatsApp (Graham Bell), Google Calendar sync, project codes linked to Nick Fury/CRM, depreciation, insurance reports, multi-location reporting, vendor directory, yearly storage review. Built early: TCO, quick notes, asset value at purchase price. | Shown as roadmap. | Agree per feature (section 12). |
| K-09 | `model_numbers_proposed.csv` (MIG-016) not available; cross-check not run. | Model numbers come from the sheet only. | Add the file and compare before import. |
| K-10 | Error monitoring service not selected (A2). Logs are structured JSON on stdout; failed jobs recorded in `job_runs` and logged as errors. | No alerting yet. | Choose a service with Naveen (e.g. Sentry) and add the DSN. |
| K-11 | Hourly reminders need Vercel Pro cron (Hobby allows daily). | On Hobby, reminders would be once a day. | Use Pro, or an external scheduler calling `/api/cron/all`. |
| K-12 | Offline queue covers check-out and check-in only; photos taken offline cannot be attached to a queued check-out (photo records need the server). A queued camera check-out will therefore be rejected (PHOTO_REQUIRED) and flagged. | Matches A8 "confirm offline actions allowed". | Decide which offline actions are allowed (A8). |
| K-13 | `npm audit` reports advisories in transitive dev dependencies. | Dev tooling only. | Review before production. |
