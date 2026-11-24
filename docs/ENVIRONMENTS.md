# Environment setup (A3)

| | Local / CI | Staging | Production |
|---|---|---|---|
| Purpose | development, automated tests | Naveen/Anand acceptance, synthetic data | live |
| App | `npm run dev` / `next start` | Vercel project `madtown-inventory`, Preview/"staging" branch | same Vercel project, Production |
| DB | PostgreSQL 16 (`scripts/local-postgres.sh`) | Supabase project `madtown-inventory-staging` | Supabase project `madtown-inventory` (Pro, ap-south-1) |
| Auth | `AUTH_PROVIDER=local` | Supabase Google, hd=madtown.in | same |
| Photos | `.storage/` | Drive shared drive "Madtown Inventory – Staging" | Drive shared drive "Madtown Inventory" |
| Email | outbox (no sending) | Resend + `EMAIL_SANDBOX_TO` (all mail redirected) | Resend, inventory@madtown.in |
| Mirror | `.mirror/*.csv` | staging copy of the sheet | agreed mirror sheet (read-only) |
| Access | developer | Naveen, Anand, Siddharth (A3) | per Settings → Users |

## Local setup

```bash
npm ci
bash scripts/local-postgres.sh          # PostgreSQL 16 on 127.0.0.1:54322 (needs postgresql-16 installed)
cp .env.example .env.local              # then set the local values shown in docs/ENVIRONMENTS.md below
npm run db:reset && npm run db:seed     # migrations + synthetic users + synthetic sheet import
npm run dev                             # http://localhost:3000  (users: naveen@madtown.in etc., password from SEED_PASSWORD)
```

Local `.env.local` essentials: `APP_ENV=local`, `DATABASE_URL=postgres://app_server:app_server_local_only@127.0.0.1:54322/madtown_staging`,
`MIGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:54322/madtown_staging`, `AUTH_PROVIDER=local`, `ALLOW_LOCAL_AUTH=1`, `SESSION_SECRET=<random>`,
`CRON_SECRET=<random>`, `STORAGE_PROVIDER=supabase` (local disk only for a local machine), `EMAIL_PROVIDER=outbox`, `EMAIL_SANDBOX_TO=staging-inbox@madtown.in`, `MIRROR_PROVIDER=csv`.

## Tests

```bash
npm run typecheck && npm run lint
npx vitest run                    # unit + integration + RLS + concurrency + jobs + backup drill (uses DB madtown_test)
npx next build && npx playwright test   # E2E on a fresh madtown_e2e DB (Pixel 7, iPhone 13 viewport, desktop)
npm run rtm                       # regenerates docs/RTM.md from the reports
```

## Staging test data (A3)
Use only the synthetic fixture or an anonymised copy (names of borrowers may stay; remove phone/email). Never copy production secrets or contact data.
