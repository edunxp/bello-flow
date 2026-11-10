#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
container=$(docker run --detach --pull=never --network=none --user=postgres \
  --tmpfs /drill:rw,exec,mode=1777 --entrypoint sleep postgres:18.6-bookworm infinity)
trap 'docker rm -f "$container" >/dev/null' EXIT

{
  printf '%s\n' 'CREATE ROLE bello_runtime; CREATE ROLE bello_bootstrap_executor; CREATE ROLE bello_audit_maintenance;'
  for migration in "$repo_root"/apps/api/prisma/migrations/*/migration.sql; do
    cat "$migration"
    printf '\n'
  done
} | docker exec -i "$container" sh -eu -c '
  cd /drill
  mkdir sockets archive
  initdb -D source --auth=trust --no-instructions >/dev/null
  cat >> source/postgresql.conf <<EOF
listen_addresses = '\'''\''
unix_socket_directories = '\''/drill/sockets'\''
archive_mode = on
archive_command = '\''test -f /drill/archive/%f || cp %p /drill/archive/%f'\''
EOF
  cat > maintenance.conf <<EOF
[drill_maintenance]
host=/drill/sockets
dbname=postgres
user=bello_drill_maintenance
EOF
  pg_ctl -D source -l source.log -w start >/dev/null
  psql -X -q -v ON_ERROR_STOP=1 -h /drill/sockets -d postgres
'

docker exec -i "$container" bash -se <<'DRILL'
set -Eeuo pipefail
cd /drill
export PGHOST=/drill/sockets PGDATABASE=postgres
sql() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }

sql <<'SQL'
CREATE ROLE bello_drill_maintenance LOGIN IN ROLE bello_audit_maintenance;
INSERT INTO account (id, first_name, last_name, email, email_key,
  email_verified_at, status, created_at)
VALUES ('6a270376-4a98-48a0-bb1b-011f66b2e1b1', 'Synthetic', 'Admin',
  'restore@example.invalid', 'restore@example.invalid', now(), 'ACTIVE', now());
INSERT INTO workspace (id, name, time_zone)
VALUES ('40f9bb4c-d607-48e2-a22e-a0c5634744b7', 'Synthetic baseline', 'UTC');
INSERT INTO workspace_membership (workspace_id, account_id, role)
SELECT w.id, a.id, 'ADMIN' FROM workspace w CROSS JOIN account a;
INSERT INTO board (id, workspace_id, name, description)
SELECT '8bf9bc56-bc03-4081-a4df-7a39989a64e3', id, 'Synthetic board', ''
FROM workspace;
INSERT INTO board_membership (workspace_id, board_id, account_id, role)
SELECT b.workspace_id, b.id, a.id, 'ADMIN' FROM board b CROSS JOIN account a;
INSERT INTO auth_session (id, account_id, token_hash, created_at, last_activity_at,
  absolute_expires_at, created_operation_id)
SELECT gen_random_uuid(), id, sha256('synthetic-restore-drill'::bytea),
  now(), now(), now() + interval '168 hours', gen_random_uuid()
FROM account;
INSERT INTO audit_event (id, occurred_at, origin, scope, operation, result,
  entity_type, correlation_id, operation_id, sequence)
SELECT gen_random_uuid(), now() - age, 'HTTP', 'WORKSPACE', operation,
  'SUCCESS', 'WORKSPACE', gen_random_uuid(), gen_random_uuid(), 1
FROM (VALUES (interval '25 months', 'EXPIRED_FIXTURE'),
             (interval '23 months', 'RETAINED_FIXTURE')) AS events(age, operation);
SQL

pg_basebackup --pgdata=restored --wal-method=stream --checkpoint=fast
pg_verifybackup restored

sql <<'SQL'
BEGIN;
UPDATE workspace SET name = 'Synthetic recovered';
UPDATE auth_session SET revoked_at = now(), revocation_reason = 'LOGOUT',
  revoked_operation_id = gen_random_uuid();
INSERT INTO audit_event (id, occurred_at, origin, scope, operation, result,
  entity_type, entity_id, correlation_id, operation_id, sequence, context, after_data)
SELECT gen_random_uuid(), now(), 'USER', 'WORKSPACE', 'WORKSPACE_UPDATED',
  'SUCCESS', 'WORKSPACE', id, gen_random_uuid(), gen_random_uuid(), 1,
  jsonb_build_object('workspaceId', id),
  '{"name":"Synthetic recovered","fixtureExcluded":"internal"}'
FROM workspace;
COMMIT;
SQL

restore_started=$SECONDS
segment=$(sql -c "SELECT pg_walfile_name(pg_create_restore_point('bello_drill'));")
sql -c 'SELECT pg_switch_wal();' >/dev/null
for ((attempt=0; attempt<60; attempt++)); do
  if [[ -f "source/pg_wal/archive_status/$segment.done" ]]; then
    break
  fi
  sleep 1
done
test -s "archive/$segment"
test -f "source/pg_wal/archive_status/$segment.done"
sql -c "UPDATE workspace SET name = 'Synthetic after recovery target';"
pg_ctl -D source -w stop >/dev/null

cat >> restored/postgresql.conf <<'CONFIG'
archive_mode = off
restore_command = 'cp /drill/archive/%f %p'
recovery_target_name = 'bello_drill'
recovery_target_action = 'promote'
CONFIG
touch restored/recovery.signal
pg_ctl -D restored -l restored.log -w -t 60 start >/dev/null
for ((attempt=0; attempt<60; attempt++)); do
  if [[ $(sql -c 'SELECT pg_is_in_recovery();') == f ]]; then
    break
  fi
  sleep 1
done

test "$(sql -c "SELECT NOT pg_is_in_recovery() AND
  EXISTS (SELECT 1 FROM workspace WHERE name = 'Synthetic recovered') AND
  EXISTS (SELECT 1 FROM audit_event a JOIN workspace w ON a.entity_id = w.id
          WHERE a.operation = 'WORKSPACE_UPDATED') AND
  EXISTS (SELECT 1 FROM board_membership bm
    JOIN workspace_membership wm USING (workspace_id, account_id)
    JOIN auth_session s USING (account_id)
    WHERE bm.role = 'ADMIN' AND wm.role = 'ADMIN'
      AND s.revoked_at IS NOT NULL AND s.revocation_reason = 'LOGOUT') AND
  NOT has_column_privilege('bello_runtime', 'audit_event', 'before_data', 'SELECT') AND
  NOT has_table_privilege('bello_runtime', 'audit_event', 'DELETE') AND
  NOT has_function_privilege('bello_runtime', 'purge_expired_audit_events()', 'EXECUTE') AND
  NOT has_table_privilege('bello_audit_maintenance', 'audit_event', 'DELETE');")" = t
test "$(sql -c 'SET ROLE bello_audit_maintenance;
  SELECT removed_count FROM purge_expired_audit_events();')" = 1
test "$(sql -c "SELECT
  NOT EXISTS (SELECT 1 FROM audit_event WHERE operation = 'EXPIRED_FIXTURE') AND
  EXISTS (SELECT 1 FROM audit_event WHERE operation = 'RETAINED_FIXTURE') AND
  EXISTS (SELECT 1 FROM audit_event WHERE operation = 'WORKSPACE_UPDATED');")" = t
test "$(sql -c 'SET ROLE bello_audit_maintenance;
  SELECT removed_count FROM purge_expired_audit_events();')" = 0
query_args="'6a270376-4a98-48a0-bb1b-011f66b2e1b1', 'GOVERNANCE',
  '40f9bb4c-d607-48e2-a22e-a0c5634744b7', NULL, NULL, NULL, NULL,
  'WORKSPACE', NULL, 'WORKSPACE_UPDATED', 'SUCCESS', NULL, NULL, NULL, 5, 0"
test "$(sql -c "SET ROLE bello_runtime;
  SELECT e->'afterData' = jsonb_build_object('name', 'Synthetic recovered')
  FROM query_audit_events($query_args) e;")" = t
if sql -c "SET ROLE bello_audit_maintenance; SELECT query_audit_events($query_args);" \
  >/dev/null 2>&1; then
  echo 'Unexpected query privilege for maintenance' >&2
  exit 1
fi
sql -c "UPDATE workspace_membership SET role = 'MEMBER';"
test "$(sql -c "SET ROLE bello_runtime;
  SELECT e = jsonb_build_object('denied', TRUE) FROM query_audit_events($query_args) e;")" = t
printf 'PASS restore target, workspace/audit change, session revocation, memberships, audit privileges and retention (%ss)\n' \
  "$((SECONDS - restore_started))"
DRILL

retention=$(docker exec -i -e PGSERVICE=drill_maintenance -e PGSERVICEFILE=/drill/maintenance.conf \
  "$container" bash -s < "$repo_root/scripts/audit-retention.sh")
[[ "$retention" == *'"result" : "SUCCESS"'* && "$retention" == *'"removedCount" : 0'* ]]
echo 'PASS executor de manutenção com conexão separada'
