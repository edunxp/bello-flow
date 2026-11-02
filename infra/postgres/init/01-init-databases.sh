#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${BELLO_DEV_APP_PASSWORD:?BELLO_DEV_APP_PASSWORD is required}"
: "${BELLO_DEV_MIGRATOR_PASSWORD:?BELLO_DEV_MIGRATOR_PASSWORD is required}"
: "${BELLO_DEV_BOOTSTRAP_PASSWORD:?BELLO_DEV_BOOTSTRAP_PASSWORD is required}"
: "${BELLO_DEV_AUDIT_MAINTENANCE_PASSWORD:?BELLO_DEV_AUDIT_MAINTENANCE_PASSWORD is required}"
: "${BELLO_SHADOW_MIGRATOR_PASSWORD:?BELLO_SHADOW_MIGRATOR_PASSWORD is required}"
: "${BELLO_TEST_APP_PASSWORD:?BELLO_TEST_APP_PASSWORD is required}"
: "${BELLO_TEST_MIGRATOR_PASSWORD:?BELLO_TEST_MIGRATOR_PASSWORD is required}"
: "${BELLO_TEST_BOOTSTRAP_PASSWORD:?BELLO_TEST_BOOTSTRAP_PASSWORD is required}"
: "${BELLO_TEST_AUDIT_MAINTENANCE_PASSWORD:?BELLO_TEST_AUDIT_MAINTENANCE_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=dev_app_password="$BELLO_DEV_APP_PASSWORD" \
  --set=dev_migrator_password="$BELLO_DEV_MIGRATOR_PASSWORD" \
  --set=dev_bootstrap_password="$BELLO_DEV_BOOTSTRAP_PASSWORD" \
  --set=dev_audit_maintenance_password="$BELLO_DEV_AUDIT_MAINTENANCE_PASSWORD" \
  --set=shadow_migrator_password="$BELLO_SHADOW_MIGRATOR_PASSWORD" \
  --set=test_app_password="$BELLO_TEST_APP_PASSWORD" \
  --set=test_migrator_password="$BELLO_TEST_MIGRATOR_PASSWORD" \
  --set=test_bootstrap_password="$BELLO_TEST_BOOTSTRAP_PASSWORD" \
  --set=test_audit_maintenance_password="$BELLO_TEST_AUDIT_MAINTENANCE_PASSWORD" <<'SQL'
CREATE ROLE bello_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE bello_bootstrap_executor
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE bello_audit_maintenance
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE bello_dev_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'dev_app_password';

CREATE ROLE bello_dev_migrator
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'dev_migrator_password';

CREATE ROLE bello_dev_bootstrap
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'dev_bootstrap_password';

CREATE ROLE bello_dev_audit_maintenance
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'dev_audit_maintenance_password';

CREATE ROLE bello_shadow_migrator
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'shadow_migrator_password';

CREATE ROLE bello_test_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'test_app_password';

CREATE ROLE bello_test_migrator
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'test_migrator_password';

CREATE ROLE bello_test_bootstrap
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'test_bootstrap_password';

CREATE ROLE bello_test_audit_maintenance
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'test_audit_maintenance_password';

GRANT bello_runtime TO bello_dev_app, bello_test_app;
GRANT bello_bootstrap_executor TO bello_dev_bootstrap, bello_test_bootstrap;
GRANT bello_audit_maintenance
  TO bello_dev_audit_maintenance, bello_test_audit_maintenance;

CREATE DATABASE bello_dev;
CREATE DATABASE bello_shadow;
CREATE DATABASE bello_test;

REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE bello_dev FROM PUBLIC;
REVOKE ALL ON DATABASE bello_shadow FROM PUBLIC;
REVOKE ALL ON DATABASE bello_test FROM PUBLIC;

GRANT CONNECT ON DATABASE bello_dev
  TO bello_dev_app, bello_dev_migrator, bello_dev_bootstrap,
     bello_dev_audit_maintenance;
GRANT CONNECT ON DATABASE bello_shadow TO bello_shadow_migrator;
GRANT CONNECT ON DATABASE bello_test
  TO bello_test_app, bello_test_migrator, bello_test_bootstrap,
     bello_test_audit_maintenance;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname bello_dev <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public
  TO bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
GRANT USAGE, CREATE ON SCHEMA public TO bello_dev_migrator;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname bello_shadow <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO bello_shadow_migrator;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname bello_test <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public
  TO bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
GRANT USAGE, CREATE ON SCHEMA public TO bello_test_migrator;
SQL
