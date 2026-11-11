# Same-day offboarding (NFR-006)

1. Settings → Users → **Offboard** next to the person. Effect is immediate: `users.active=false` and `session_version` bumps, so every open
   session and API call fails on the next request (tested: tests/e2e/auth.spec.ts, tests/integration/rls-matrix.test.ts).
2. Google Workspace admin: suspend the account (removes Google sign-in everywhere).
3. Check People → their profile: return all open loans or transfer them; hand over detached accessories; reassign reservations.
4. If they were an escalation recipient or in `bot_cc`, update Settings.
5. If they had developer/service access: rotate `SESSION_SECRET`, `CRON_SECRET`, the DB app role password, Drive service-account key, Resend key;
   remove them from GitHub, Vercel, Supabase and the shared drives.
6. Note the date and who did it (the deactivation itself is in the audit log).
