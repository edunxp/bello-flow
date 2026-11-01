#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${BELLO_DEV_APP_PASSWORD:?BELLO_DEV_APP_PASSWORD is required}"
: "${BELLO_DEV_MIGRATOR_PASSWORD:?BELLO_DEV_MIGRATOR_PASSWORD is required}"
: "${BELLO_SHADOW_MIGRATOR_PASSWORD:?BELLO_SHADOW_MIGRATOR_PASSWORD is required}"
: "${BELLO_TEST_APP_PASSWORD:?BELLO_TEST_APP_PASSWORD is required}"
: "${BELLO_TEST_MIGRATOR_PASSWORD:?BELLO_TEST_MIGRATOR_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=dev_app_password="$BELLO_DEV_APP_PASSWORD" \
  --set=dev_migrator_password="$BELLO_DEV_MIGRATOR_PASSWORD" \
  --set=shadow_migrator_password="$BELLO_SHADOW_MIGRATOR_PASSWORD" \
  --set=test_app_password="$BELLO_TEST_APP_PASSWORD" \
  --set=test_migrator_password="$BELLO_TEST_MIGRATOR_PASSWORD" <<'SQL'
CREATE ROLE bello_dev_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'dev_app_password';

CREATE ROLE bello_dev_migrator
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'dev_migrator_password';

CREATE ROLE bello_shadow_migrator
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'shadow_migrator_password';

CREATE ROLE bello_test_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'test_app_password';

CREATE ROLE bello_test_migrator
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'test_migrator_password';

CREATE DATABASE bello_dev;
CREATE DATABASE bello_shadow;
CREATE DATABASE bello_test;

REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE bello_dev FROM PUBLIC;
REVOKE ALL ON DATABASE bello_shadow FROM PUBLIC;
REVOKE ALL ON DATABASE bello_test FROM PUBLIC;

GRANT CONNECT ON DATABASE bello_dev TO bello_dev_app, bello_dev_migrator;
GRANT CONNECT ON DATABASE bello_shadow TO bello_shadow_migrator;
GRANT CONNECT ON DATABASE bello_test TO bello_test_app, bello_test_migrator;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname bello_dev <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bello_dev_app;
GRANT USAGE, CREATE ON SCHEMA public TO bello_dev_migrator;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname bello_shadow <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO bello_shadow_migrator;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname bello_test <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bello_test_app;
GRANT USAGE, CREATE ON SCHEMA public TO bello_test_migrator;
SQL
