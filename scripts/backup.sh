#!/usr/bin/env bash
# NFR-008/010 helper. Production daily backups are Supabase's managed backups; this script makes an extra logical
# dump (before each release, A5) and is what the restore drill uses. Usage: scripts/backup.sh <DATABASE_URL> [outdir]
set -euo pipefail
URL="${1:?database url}"; OUT="${2:-backups}"; mkdir -p "$OUT"
F="$OUT/madtown-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --schema=public --schema=app --schema=auth "$URL" -f "$F"
echo "$F"
