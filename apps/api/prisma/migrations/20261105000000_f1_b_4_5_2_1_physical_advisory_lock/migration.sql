BEGIN;

DO $prerequisites$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bello_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bello_bootstrap_executor')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bello_audit_maintenance') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Required Bello capability roles are not provisioned',
      HINT = 'Provision roles with the environment administration procedure before running Prisma Migrate.';
  END IF;
END
$prerequisites$;

DO $historical_cancelled_attempts$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.password_recovery_delivery_attempt
    WHERE state = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_CANCELLED_ATTEMPT_CORRELATION_REQUIRED',
      DETAIL = 'Existing CANCELLED delivery attempts have no verifiable cancellation operation.',
      HINT = 'Do not invent operation identifiers; resolve provenance before applying this migration.',
      ERRCODE = 'P0001';
  END IF;
END
$historical_cancelled_attempts$;

ALTER TABLE public.password_reset_operation
  DROP CONSTRAINT password_reset_operation_state_check,
  DROP CONSTRAINT password_reset_operation_terminal_state_check;

ALTER TABLE public.password_reset_operation
  ADD CONSTRAINT password_reset_operation_state_check CHECK (
    state IN (
      'STARTED',
      'UNKNOWN',
      'COMPLETED',
      'REJECTED',
      'NOT_FOUND',
      'INCONSISTENT'
    )
  ),
  ADD CONSTRAINT password_reset_operation_terminal_state_check CHECK (
    (state IN ('STARTED', 'UNKNOWN') AND terminal_at IS NULL)
    OR
    (
      state IN ('COMPLETED', 'REJECTED', 'NOT_FOUND', 'INCONSISTENT')
      AND terminal_at IS NOT NULL
    )
  );

ALTER TABLE public.password_recovery_delivery_attempt
  ADD COLUMN cancelled_operation_id UUID,
  ADD CONSTRAINT password_recovery_delivery_attempt_cancelled_operation_version_check CHECK (
    cancelled_operation_id IS NULL
    OR (pg_catalog.uuid_extract_version(cancelled_operation_id) = 4) IS TRUE
  ),
  ADD CONSTRAINT password_recovery_delivery_attempt_cancellation_check CHECK (
    (state = 'CANCELLED' AND cancelled_operation_id IS NOT NULL)
    OR (state <> 'CANCELLED' AND cancelled_operation_id IS NULL)
  );

CREATE INDEX password_recovery_delivery_attempt_cancelled_operation_idx
  ON public.password_recovery_delivery_attempt (cancelled_operation_id);

CREATE FUNCTION public.auth_account_advisory_lock_key(account_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_digest BYTEA;
  v_first_byte INTEGER;
BEGIN
  IF account_id IS NULL
     OR (pg_catalog.uuid_extract_version(account_id) = 4) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_AUTH_INVALID_ACCOUNT_ID',
      ERRCODE = '22023';
  END IF;

  v_digest := pg_catalog.sha256(
    pg_catalog.convert_to(
      'bello:auth:account:' || pg_catalog.lower(account_id::TEXT),
      'UTF8'
    )
  );
  v_first_byte := pg_catalog.get_byte(v_digest, 0);

  RETURN
    (v_first_byte - CASE WHEN v_first_byte >= 128 THEN 256 ELSE 0 END)::BIGINT
      * 72057594037927936
    + pg_catalog.get_byte(v_digest, 1)::BIGINT * 281474976710656
    + pg_catalog.get_byte(v_digest, 2)::BIGINT * 1099511627776
    + pg_catalog.get_byte(v_digest, 3)::BIGINT * 4294967296
    + pg_catalog.get_byte(v_digest, 4)::BIGINT * 16777216
    + pg_catalog.get_byte(v_digest, 5)::BIGINT * 65536
    + pg_catalog.get_byte(v_digest, 6)::BIGINT * 256
    + pg_catalog.get_byte(v_digest, 7)::BIGINT;
END
$function$;

CREATE FUNCTION public.acquire_auth_account_advisory_xact_lock(account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF account_id IS NULL
     OR (pg_catalog.uuid_extract_version(account_id) = 4) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_AUTH_INVALID_ACCOUNT_ID',
      ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    public.auth_account_advisory_lock_key(account_id)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.auth_account_advisory_lock_key(UUID)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.acquire_auth_account_advisory_xact_lock(UUID)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.acquire_auth_account_advisory_xact_lock(UUID)
  TO bello_runtime;

COMMIT;
