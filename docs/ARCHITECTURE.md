# Madtown Inventory — Architecture

Status: v0.1 (build baseline, pending Naveen's v1.0 approval per Part A1).
Sources: *Madtown Inventory — Complete Requirements & Technical Implementation Specification* (Part A addendum + Part B = Draft v0.1, 97 pages).
Every requirement ID referenced here is traced in [`RTM.md`](RTM.md). Decisions and conflicts are in [`DECISIONS.md`](DECISIONS.md).

## 1. System context

```mermaid
flowchart LR
  subgraph Users
    O[Owner - Naveen]:::u
    M[Managers - Anand, Kittu?]:::u
    T[Team members]:::u
    R[Read-only - accountant / Siddharth dev]:::u
  end
  B[Borrowers without login<br/>Chiru, Purushotham, Nagi, Samuel]:::b
  subgraph Vercel
    APP[Next.js App Router PWA<br/>server components + route handlers]
    CRON[Vercel Cron -> /api/cron/*]
  end
  subgraph Supabase
    AUTH[Supabase Auth<br/>Google, hd=madtown.in]
    PG[(PostgreSQL 16<br/>RLS + triggers)]
  end
  GD[(Google Drive<br/>shared drive, 1 folder / item)]
  GS[(Google Sheet mirror<br/>read-only)]
  RS[Resend<br/>inventory@madtown.in]
  SL[Slack webhook - Phase 2]
  WA[WhatsApp via Graham Bell - Phase 3]
  Users -->|HTTPS| APP
  APP --> AUTH
  APP -->|pg, SET ROLE authenticated + JWT claims| PG
  CRON --> APP
  APP -->|StorageAdapter| GD
  APP -->|MirrorAdapter| GS
  APP -->|EmailAdapter| RS --> B
  APP -.->|ChatAdapter| SL
  APP -.->|MessagingAdapter| WA
  classDef u fill:#eef,stroke:#88a
  classDef b fill:#fee,stroke:#a88
```

## 2. Stack (Part A2, agreed proposal)

| Layer | Choice | Notes |
|---|---|---|
| Web | Next.js 15 App Router + TypeScript | Server components for reads, route handlers / server actions for writes. Mobile-first PWA (manifest + hand-written service worker). |
| UI | Tailwind CSS 4 + native accessible elements (`<dialog>`, `<details>`, labelled inputs) | 16 px minimum text on mobile (NFR-024), high-contrast palette for sunlight, 48 px touch targets (NFR-011). |
| DB | PostgreSQL 16 (Supabase in staging/prod) | Migrations in `supabase/migrations`, Supabase CLI compatible. |
| Auth | Supabase Auth (Google, `@madtown.in`) in staging/prod; **local password provider** only for local/CI | Both behind `AuthAdapter`. Domain checked in app *and* DB constraint (`users.login_email ~ '@madtown\.in$'`). |
| AuthZ | PostgreSQL RLS + server-side checks | Each request runs in a transaction: `SET LOCAL ROLE authenticated; set_config('request.jwt.claims', …)` — identical to how PostgREST applies Supabase JWTs, so `auth.uid()` policies behave the same locally and on Supabase. |
| Photos | `StorageAdapter`: `GoogleDriveStorage` (prod), `LocalDiskStorage` (local/CI) | DB stores provider + file id + thumbnail ref + checksum, never bytes (FR-PHO-004, NFR-017/018, FR-PHO-008). R2 / Supabase Storage plug in via the same interface. |
| Email | `EmailAdapter`: `ResendEmail` (prod), `OutboxEmail` (local/staging sandbox) | Staging redirects every recipient to `EMAIL_SANDBOX_TO` and records it in `notifications_log` (A3). |
| Sheets mirror | `MirrorAdapter`: `GoogleSheetsMirror` (prod), `CsvMirror` (local) | One-way, nightly + Owner manual sync (A4, FR-RPT-009). |
| QR | `qrcode` (generation), `@zxing/browser` + native `BarcodeDetector` (scanning) | Stable path `/i/<ID>` and `/k/<KIT>`; base URL from `QR_BASE_URL` (A3: stable redirect path). |
| Jobs | Route handlers under `/api/cron/*` guarded by `CRON_SECRET`; scheduled by `vercel.json` crons; `npm run job <name>` locally | All jobs idempotent via `notifications_log.dedupe_key` unique index. |
| Tests | Vitest (unit + DB integration + RLS), Playwright (E2E, mobile viewport) | Integration tests run against a real PostgreSQL 16 with the same migrations. |

## 3. Request / authorization flow

```mermaid
sequenceDiagram
  participant Br as Browser
  participant N as Next.js server
  participant A as AuthAdapter
  participant P as PostgreSQL
  Br->>N: request + session cookie
  N->>A: getSession()
  A-->>N: {userId} or null
  N->>P: BEGIN; SET LOCAL ROLE authenticated;<br/>set_config('request.jwt.claims', {"sub":userId}); set_config('app.source','App')
  N->>P: app.current_user_ctx()  -- checks users.active + session_version (NFR-006)
  N->>P: queries / service SQL (RLS filters rows, column-split tables hide finance)
  P-->>N: rows (audit triggers write audit_log in same txn)
  N->>P: COMMIT
  N-->>Br: HTML / JSON
```

* The application database login (`app_server`) is **not** a superuser and has **no BYPASSRLS**; it can only `SET ROLE authenticated` (or `service_role` for cron/import jobs, which use their own code path and tag `app.source = 'Sync'|'Import'|'Job'`).
* Business invariants live in the database (constraints, constraint triggers, row locks), not only in the UI (A5):
  * one active loan line per Single item — partial unique index;
  * counted holdings `sum(quantity) = stock` — deferred constraint trigger;
  * holdings never negative — CHECK;
  * check-out blocked when `status <> 'Available'` — enforced inside `app.checkout()` with `SELECT … FOR UPDATE`;
  * reservations cannot overlap for the same item — exclusion constraint (`btree_gist`).
* Financial data (purchase price, repair cost, order amount, option prices, asset value, invoice photos, raw legacy notes) lives in separate tables (`item_financials`, `maintenance_costs`, `order_financials`, `wishlist_options`, `item_import_raw`) whose RLS SELECT policy is `app.can_view_financials()`. Item notes are served to non-finance roles through `items_v`, which masks `Rs <amount>` patterns (decision D-07). This satisfies A5 "not through API responses, exports, browser network calls or guessed IDs".

## 4. Modules and code layout

```
src/
  app/                    Next.js routes (screens SCR-01..23, API, cron)
    (app)/                authenticated shell: dashboard, items, scan, loans, people, kits, repairs,
                          lost, to-buy, orders, walkthrough, reports, audit, import, unsorted, settings
    i/[id], k/[id]        stable QR redirect paths (FR-QR-001)
    api/                  JSON endpoints (photos upload, search, offline sync, exports, cron)
  lib/
    db.ts                 pool + withUser()/withService() RLS transactions
    auth/                 AuthAdapter: local + supabase; domain rule
    services/             one file per module (catalog, loans, kits, repairs, incidents, buy, audits,
                          photos, reports, notifications, mirror, importer, settings, people)
    adapters/             storage (drive/local), email (resend/outbox), mirror (sheets/csv), chat (slack), messaging (whatsapp stub)
    format.ts             IST dates "16 Oct 2026", Rs currency (NFR-020)
    permissions.ts        role matrix (section 9) mirrored for UI; DB is authoritative
  components/             UI building blocks
public/sw.js              service worker (NFR-013 cache, NFR-014 queue relay)
supabase/migrations/      ordered SQL; 0000 shim is skipped on real Supabase
scripts/                  migrate, seed, import-sheet, run-job, backup/restore, generate-rtm
fixtures/sheet/           SYNTHETIC reconstruction of the 3 tabs (see fixtures/README.md)
tests/unit, tests/integration, tests/e2e
```

## 5. Environments (A3)

| | Local / CI (this workspace) | Staging | Production |
|---|---|---|---|
| App | `next build && next start` | Vercel preview/staging project | Vercel production |
| DB | PostgreSQL 16 cluster in `.pgdata/`, DB `madtown_staging` (+ `madtown_test`) | Supabase staging project | Supabase production project |
| Auth | local provider (`AUTH_PROVIDER=local`) | Supabase Auth Google, `hd=madtown.in` | same |
| Storage | `LocalDiskStorage` → `.storage/` | Drive shared drive *Madtown Inventory – Staging* | Drive shared drive *Madtown Inventory* |
| Email | Outbox (sandbox) | Resend + `EMAIL_SANDBOX_TO` redirect | Resend, verified `inventory@madtown.in` |
| Mirror | CSV files `.mirror/` | Staging copy of sheet | Agreed production mirror sheet |
| Data | synthetic fixture | synthetic/anonymised (A3) | real import (once, MIG-015) |

Secrets only via environment variables (`.env.local` is git-ignored; `.env.example` documents every variable). See `docs/ENVIRONMENTS.md` and `docs/DEPLOYMENT.md`.

## 6. Offline (NFR-013 Phase 1, NFR-014 Phase 2)

* Service worker caches the app shell, the item index JSON (`/api/items/index`) and visited item pages (stale-while-revalidate). Scanning and lookup work from cache; mutating screens show "You are offline — this action needs a connection" (Phase 1 behaviour).
* Phase 2 queue: check-out / check-in submissions made offline are stored in IndexedDB (`mt-offline-queue`) with a client UUID and client timestamp, shown as **Pending — not confirmed**. On reconnect they are POSTed to `/api/offline/sync`; the server validates with server time (server wins). A rejected action (e.g. double check-out created offline) is recorded in `sync_conflicts` and notified to Managers (NFR-014). Nothing queued is shown as final until the server confirms (A8).

## 7. Photos pipeline (FR-PHO-002..008, A4)

1. Browser captures from camera (`<input capture>` / getUserMedia), compresses to 1600 px longest side JPEG q0.82 and 320 px thumbnail.
2. Photo record is created first in state `pending` (so check-out rules can count it) and the bytes upload in the background; failures stay `failed` with retry from IndexedDB and are shown as **Evidence incomplete** on the loan, dashboard and item.
3. Server stores via `StorageAdapter.put(folder=itemId)` → returns provider file id; computes SHA-256 checksum; stores thumbnail.
4. Historical photos are never overwritten; promoting a check-in photo to Latest only moves `items.latest_photo_id` (FR-PHO-005).

## 8. Notifications (section 8)

`notifications_log` is both the delivery history and the idempotency ledger (`dedupe_key` unique: e.g. `NTF-003:<loan>:<IST date>`). Jobs: `reminders` (hourly; NTF-001..004), `weekly-missing` (NTF-007), `repairs-overdue` (NTF-008), `upkeep-due` (NTF-009), `orders-overdue` (NTF-011), `weekly-summary` (NTF-012 / FR-RPT-008), `mirror` (nightly, FR-RPT-009), `weekly-export` (NFR-009). Immediate events (NTF-005, 006, 010, 011 delivered, 013, 014) are sent by the service that causes them, after commit. All bot mail CCs `naveen@madtown.in` (configurable, section 8 standing rule).

## 9. Audit (FR-AUD-001/002, NFR-015/016, G-08)

A generic `AFTER INSERT/UPDATE/DELETE` trigger (`app.audit_trigger`) on every business table writes `audit_log(actor, at, action, table, record_id, before_json, after_json, source, reason)` in the same transaction. Business actions (check-out, check-in, transfer, import, sync) write an additional semantic row. `audit_log` has no UPDATE/DELETE grant for any application role and a trigger that raises on UPDATE/DELETE/TRUNCATE; only Owner can read it globally; Managers read item-scoped entries via `app.item_audit(item_id)` (permission matrix section 9). Secrets are never audited (auth tables are not audited; settings marked secret are excluded).

## 10. Phase gating (A6)

All Phase 1 and Phase 2 features are implemented. Phase 3 items are either implemented where self-contained (FR-CON-009 TCO, FR-AUD-007 quick notes, FR-RPT-006 asset value at purchase price) or present as disabled adapters with a visible "Phase 3 — roadmap" badge (WhatsApp, Google Calendar, project codes, depreciation, insurance, multi-location, vendor directory). Phase badges are shown in navigation and screen headers.
