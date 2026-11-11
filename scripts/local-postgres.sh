#!/usr/bin/env bash
# Local / CI PostgreSQL 16 cluster (ADR-02). Not used in staging/production (Supabase).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT/.pgdata}"
PORT="${PGPORT:-54322}"
BIN=/usr/lib/postgresql/16/bin
RUNAS=""
if [ "$(id -u)" = "0" ]; then RUNAS="sudo -u postgres"; command -v sudo >/dev/null || RUNAS="runuser -u postgres --"; fi
if [ ! -d "$PGDATA" ]; then
  mkdir -p "$PGDATA"; chown -R postgres:postgres "$PGDATA" 2>/dev/null || true
  $RUNAS $BIN/initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  echo "timezone = 'UTC'" >> "$PGDATA/postgresql.conf"
  echo "listen_addresses = '127.0.0.1'" >> "$PGDATA/postgresql.conf"
  echo "max_connections = 200" >> "$PGDATA/postgresql.conf"
fi
if ! $RUNAS $BIN/pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  $RUNAS $BIN/pg_ctl -D "$PGDATA" -o "-p $PORT -k /tmp" -l "$PGDATA/server.log" start >/dev/null
  sleep 1
fi
for db in madtown_staging madtown_test madtown_e2e; do
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tc "select 1 from pg_database where datname='$db'" | grep -q 1 || \
    psql -h 127.0.0.1 -p "$PORT" -U postgres -qc "create database $db"
done
# application login role: not superuser, no BYPASSRLS; may only SET ROLE authenticated / service_role
psql -h 127.0.0.1 -p "$PORT" -U postgres -qc "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='app_server') then
    create role app_server login password 'app_server_local_only' nosuperuser nobypassrls noinherit;
  end if; end \$\$;"
echo "PostgreSQL running on 127.0.0.1:$PORT (databases madtown_staging, madtown_test)"
