#!/usr/bin/env bash
# NFR-010 / AC-NFR-03: restore a logical dump into a STAGING (never production) database, then show row counts.
# Supabase-managed daily backups are restored from the Supabase dashboard into a new/staging project (docs/BACKUP_RESTORE.md);
# this script covers the logical dumps taken before each release.
# Usage: scripts/restore-to-staging.sh <dump file> <STAGING_DATABASE_URL>
set -euo pipefail
DUMP="${1:?dump}"; URL="${2:?staging url}"
case "$URL" in *prod*|*production*) echo "Refusing: target looks like production"; exit 1;; esac
psql "$URL" -q -v ON_ERROR_STOP=1 -c "drop schema if exists app cascade; drop schema if exists auth cascade; drop schema if exists public cascade; create schema public;
  create extension if not exists pgcrypto; create extension if not exists pg_trgm; create extension if not exists btree_gist;
  do \$\$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  end \$\$;"
LIST="$(mktemp)"
pg_restore -l "$DUMP" | grep -v -E "SCHEMA - public |^;.*SCHEMA public" > "$LIST"
pg_restore --no-owner --exit-on-error -L "$LIST" -d "$URL" "$DUMP"
rm -f "$LIST"
# privileges are part of the migrations; re-apply the grant/RLS migration statements that pg_restore skipped
psql "$URL" -q -v ON_ERROR_STOP=1 -c "grant usage on schema public, app, auth to authenticated, service_role;"
psql "$URL" -c "select 'items' t, count(*) from public.items union all select 'loans', count(*) from public.loans union all select 'audit_log', count(*) from public.audit_log"
