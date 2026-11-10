#!/usr/bin/env bash
set -Eeuo pipefail

if [[ -z ${PGSERVICE:-} ]]; then
  echo 'Informe um serviço PostgreSQL configurado para manutenção de auditoria.' >&2
  exit 64
fi

if result=$(psql --no-psqlrc --no-password --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --command '
    SELECT json_build_object(
      '\''operation'\'', '\''AUDIT_RETENTION'\'', '\''result'\'', '\''SUCCESS'\'',
      '\''cutoffAt'\'', cutoff_at, '\''removedCount'\'', removed_count
    ) FROM public.purge_expired_audit_events()
  ' 2>/dev/null); then
  printf '%s\n' "$result"
else
  printf '%s\n' '{"operation":"AUDIT_RETENTION","result":"FAILURE"}' >&2
  exit 1
fi
