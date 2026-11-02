#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <dev|test>" >&2
  exit 64
}

[[ $# -eq 1 ]] || usage

case "$1" in
  dev)
    target_database='bello_dev'
    runtime_login='bello_dev_app'
    migrator_login='bello_dev_migrator'
    bootstrap_login='bello_dev_bootstrap'
    maintenance_login='bello_dev_audit_maintenance'
    ;;
  test)
    target_database='bello_test'
    runtime_login='bello_test_app'
    migrator_login='bello_test_migrator'
    bootstrap_login='bello_test_bootstrap'
    maintenance_login='bello_test_audit_maintenance'
    ;;
  *) usage ;;
esac

for command_name in psql createuser; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 69
  }
done

admin_user="${PGUSER:-${POSTGRES_USER:-}}"
admin_database="${PGDATABASE:-${POSTGRES_DB:-postgres}}"
[[ -n "$admin_user" ]] || {
  echo 'PGUSER or POSTGRES_USER is required' >&2
  exit 64
}

psql_admin=(
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align
  --username "$admin_user" --dbname "$admin_database"
)
psql_target=(
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align
  --username "$admin_user" --dbname "$target_database"
)

scalar_admin() {
  "${psql_admin[@]}" --command "$1" | tr -d '[:space:]'
}

role_exists() {
  [[ "$(scalar_admin "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '$1');")" == 't' ]]
}

assert_role_shape() {
  local role_name="$1"
  local expected_login="$2"
  local actual
  actual="$(scalar_admin "
    SELECT pg_catalog.concat_ws('|', rolcanlogin, rolsuper, rolcreatedb,
      rolcreaterole, rolreplication, rolbypassrls)
    FROM pg_catalog.pg_roles
    WHERE rolname = '$role_name';
  ")"
  [[ "$actual" == "$expected_login|f|f|f|f|f" ]] || {
    echo "Unsafe or unexpected attributes for role: $role_name" >&2
    exit 65
  }
}

assert_no_unexpected_memberships() {
  local member_name="$1"
  local allowed_role="${2:-}"
  local unexpected
  unexpected="$("${psql_admin[@]}" --command "
    SELECT parent.rolname
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
    WHERE member.rolname = '$member_name'
      AND ('$allowed_role' = '' OR parent.rolname <> '$allowed_role')
    ORDER BY parent.rolname;
  ")"
  [[ -z "${unexpected//[[:space:]]/}" ]] || {
    echo "Unexpected membership for role $member_name: $unexpected" >&2
    exit 65
  }
}

assert_no_unexpected_capability_members() {
  local capability="$1"
  local allowed_csv="$2"
  local unexpected
  unexpected="$("${psql_admin[@]}" --command "
    SELECT member.rolname
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
    WHERE parent.rolname = '$capability'
      AND NOT (member.rolname = ANY (pg_catalog.string_to_array('$allowed_csv', ',')))
    ORDER BY member.rolname;
  ")"
  [[ -z "${unexpected//[[:space:]]/}" ]] || {
    echo "Unexpected member of capability $capability: $unexpected" >&2
    exit 65
  }
}

echo 'Validating administrative connection and target before changes...'

[[ "$(scalar_admin 'SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user;')" == 't' ]] || {
  echo 'The administrative connection must use a PostgreSQL superuser' >&2
  exit 77
}

[[ "$(scalar_admin "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = '$target_database');")" == 't' ]] || {
  echo "Target database does not exist: $target_database" >&2
  exit 65
}

system_identifier="$(scalar_admin 'SELECT system_identifier FROM pg_catalog.pg_control_system();')"
[[ "$system_identifier" =~ ^[0-9]+$ ]] || {
  echo 'Could not determine the PostgreSQL system identifier' >&2
  exit 65
}

for required_login in "$runtime_login" "$migrator_login"; do
  role_exists "$required_login" || {
    echo "Expected existing login is missing: $required_login" >&2
    exit 65
  }
  assert_role_shape "$required_login" t
done

assert_no_unexpected_memberships "$runtime_login" bello_runtime
assert_no_unexpected_memberships "$migrator_login"

for capability in bello_runtime bello_bootstrap_executor bello_audit_maintenance; do
  if role_exists "$capability"; then
    assert_role_shape "$capability" f
    assert_no_unexpected_memberships "$capability"
  fi
done

if role_exists bello_runtime; then
  assert_no_unexpected_capability_members \
    bello_runtime 'bello_dev_app,bello_test_app'
fi
if role_exists bello_bootstrap_executor; then
  assert_no_unexpected_capability_members \
    bello_bootstrap_executor 'bello_dev_bootstrap,bello_test_bootstrap'
fi
if role_exists bello_audit_maintenance; then
  assert_no_unexpected_capability_members \
    bello_audit_maintenance \
    'bello_dev_audit_maintenance,bello_test_audit_maintenance'
fi

for optional_login in "$bootstrap_login" "$maintenance_login"; do
  if role_exists "$optional_login"; then
    assert_role_shape "$optional_login" t
    password_present="$(scalar_admin "
      SELECT rolpassword IS NOT NULL
      FROM pg_catalog.pg_authid
      WHERE rolname = '$optional_login';
    ")"
    [[ "$password_present" == 't' ]] || {
      echo "Existing login has no password; refusing to replace it: $optional_login" >&2
      exit 65
    }
  fi
done
assert_no_unexpected_memberships "$bootstrap_login" bello_bootstrap_executor
assert_no_unexpected_memberships "$maintenance_login" bello_audit_maintenance

[[ "$(scalar_admin "SELECT pg_catalog.has_database_privilege('public', '$target_database', 'CONNECT');")" == 'f' ]] || {
  echo "PUBLIC unexpectedly has CONNECT on $target_database" >&2
  exit 65
}

public_schema_privileges="$("${psql_target[@]}" --command "
  SELECT pg_catalog.has_schema_privilege('public', 'public', 'USAGE'),
         pg_catalog.has_schema_privilege('public', 'public', 'CREATE');
")"
[[ "${public_schema_privileges//[[:space:]]/}" == 'f|f' ]] || {
  echo "PUBLIC unexpectedly has privileges on $target_database.public" >&2
  exit 65
}

confirmation_token="$system_identifier:$target_database"
echo "Cluster system_identifier: $system_identifier"
echo "Target database: $target_database"
echo "Existing data will be preserved; only F1-A.1 roles and grants may be added."
[[ -t 0 && -t 1 ]] || {
  echo 'An interactive TTY is required for confirmation and password prompts' >&2
  exit 64
}
read -r -p "Type '$confirmation_token' to authorize provisioning: " confirmation
[[ "$confirmation" == "$confirmation_token" ]] || {
  echo 'Authorization confirmation did not match; no changes were made' >&2
  exit 64
}

create_capability_if_missing() {
  local role_name="$1"
  if role_exists "$role_name"; then
    echo "Preserved existing capability role: $role_name"
    return
  fi
  "${psql_admin[@]}" --command "
    CREATE ROLE $role_name
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  " >/dev/null
  echo "Created capability role: $role_name"
}

create_login_if_missing() {
  local role_name="$1"
  if role_exists "$role_name"; then
    echo "Preserved existing login and password: $role_name"
    return
  fi
  echo "Set a new password for $role_name (input is not echoed)."
  createuser --username "$admin_user" \
    --pwprompt --login --no-superuser --no-createdb --no-createrole \
    --no-replication --no-bypassrls "$role_name"
  echo "Created login: $role_name"
}

create_capability_if_missing bello_runtime
create_capability_if_missing bello_bootstrap_executor
create_capability_if_missing bello_audit_maintenance
create_login_if_missing "$bootstrap_login"
create_login_if_missing "$maintenance_login"

"${psql_admin[@]}" --command "
  GRANT bello_runtime TO $runtime_login;
  GRANT bello_bootstrap_executor TO $bootstrap_login;
  GRANT bello_audit_maintenance TO $maintenance_login;
  GRANT CONNECT ON DATABASE $target_database
    TO $runtime_login, $bootstrap_login, $maintenance_login;
" >/dev/null

"${psql_target[@]}" --command "
  GRANT USAGE ON SCHEMA public
    TO bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
" >/dev/null

for capability in bello_runtime bello_bootstrap_executor bello_audit_maintenance; do
  assert_role_shape "$capability" f
  assert_no_unexpected_memberships "$capability"
done
for login in "$runtime_login" "$bootstrap_login" "$maintenance_login"; do
  assert_role_shape "$login" t
done
assert_no_unexpected_memberships "$runtime_login" bello_runtime
assert_no_unexpected_memberships "$bootstrap_login" bello_bootstrap_executor
assert_no_unexpected_memberships "$maintenance_login" bello_audit_maintenance

echo 'Provisioning completed. Effective verification:'
"${psql_admin[@]}" --command "
  SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls
  FROM pg_catalog.pg_roles
  WHERE rolname IN (
    'bello_runtime', 'bello_bootstrap_executor', 'bello_audit_maintenance',
    '$runtime_login', '$bootstrap_login', '$maintenance_login'
  )
  ORDER BY rolname;

  SELECT member.rolname AS login, parent.rolname AS capability
  FROM pg_catalog.pg_auth_members AS membership
  JOIN pg_catalog.pg_roles AS parent ON parent.oid = membership.roleid
  JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
  WHERE member.rolname IN ('$runtime_login', '$bootstrap_login', '$maintenance_login')
  ORDER BY member.rolname, parent.rolname;

  SELECT role_name,
         pg_catalog.has_database_privilege(role_name, '$target_database', 'CONNECT')
           AS can_connect
  FROM (VALUES
    ('$runtime_login'), ('$bootstrap_login'), ('$maintenance_login')
  ) AS selected_roles(role_name)
  ORDER BY role_name;
"

"${psql_target[@]}" --command "
  SELECT role_name,
         pg_catalog.has_schema_privilege(role_name, 'public', 'USAGE')
           AS has_schema_usage
  FROM (VALUES
    ('bello_runtime'),
    ('bello_bootstrap_executor'),
    ('bello_audit_maintenance')
  ) AS selected_roles(role_name)
  ORDER BY role_name;
"
