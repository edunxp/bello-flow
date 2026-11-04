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

ALTER TABLE public.password_credential
  ADD COLUMN changed_operation_id UUID;

ALTER TABLE public.password_credential
  ADD CONSTRAINT password_credential_changed_operation_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(changed_operation_id) = 4) IS TRUE
  ) NOT VALID;

DO $backfill_preconditions$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.bootstrap_state) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.bootstrap_state
       WHERE singleton_id = 1
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_CREDENTIAL_BACKFILL_INCONSISTENT_BOOTSTRAP_STATE',
      ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.password_credential AS credential
    LEFT JOIN public.bootstrap_state AS state
      ON state.singleton_id = 1
     AND state.status = 'COMPLETED'
     AND state.initial_account_id = credential.account_id
     AND state.operation_id IS NOT NULL
     AND (pg_catalog.uuid_extract_version(state.operation_id) = 4) IS TRUE
    WHERE state.operation_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_CREDENTIAL_BACKFILL_ORIGIN_NOT_PROVEN',
      ERRCODE = 'P0001';
  END IF;
END
$backfill_preconditions$;

UPDATE public.password_credential AS credential
SET changed_operation_id = state.operation_id
FROM public.bootstrap_state AS state
WHERE state.singleton_id = 1
  AND state.status = 'COMPLETED'
  AND state.initial_account_id = credential.account_id
  AND state.operation_id IS NOT NULL;

DO $backfill_postconditions$
DECLARE
  v_credential_count BIGINT;
  v_correlated_count BIGINT;
  v_distinct_operation_count BIGINT;
BEGIN
  SELECT
    pg_catalog.count(*),
    pg_catalog.count(changed_operation_id),
    pg_catalog.count(DISTINCT changed_operation_id)
  INTO
    v_credential_count,
    v_correlated_count,
    v_distinct_operation_count
  FROM public.password_credential;

  IF v_credential_count <> v_correlated_count
     OR v_correlated_count <> v_distinct_operation_count THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_CREDENTIAL_BACKFILL_INCOMPLETE',
      ERRCODE = 'P0001';
  END IF;
END
$backfill_postconditions$;

ALTER TABLE public.password_credential
  VALIDATE CONSTRAINT password_credential_changed_operation_id_version_check;
ALTER TABLE public.password_credential
  ALTER COLUMN changed_operation_id SET NOT NULL;
CREATE UNIQUE INDEX password_credential_changed_operation_id_key
  ON public.password_credential (changed_operation_id);

CREATE TABLE public.password_recovery_request (
  recovery_request_id UUID NOT NULL,
  account_id UUID,
  state VARCHAR(20) NOT NULL,
  received_at TIMESTAMPTZ(6) NOT NULL,
  updated_at TIMESTAMPTZ(6) NOT NULL,
  terminal_at TIMESTAMPTZ(6),
  current_attempt_number SMALLINT NOT NULL,
  cancelled_operation_id UUID,
  CONSTRAINT password_recovery_request_pkey PRIMARY KEY (recovery_request_id),
  CONSTRAINT password_recovery_request_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(recovery_request_id) = 4) IS TRUE
  ),
  CONSTRAINT password_recovery_request_account_id_version_check CHECK (
    account_id IS NULL
    OR (pg_catalog.uuid_extract_version(account_id) = 4) IS TRUE
  ),
  CONSTRAINT password_recovery_request_cancelled_operation_version_check CHECK (
    cancelled_operation_id IS NULL
    OR (pg_catalog.uuid_extract_version(cancelled_operation_id) = 4) IS TRUE
  ),
  CONSTRAINT password_recovery_request_state_check CHECK (
    state IN (
      'RECEIVED',
      'SUPPRESSED',
      'PENDING',
      'PREPARING',
      'PREPARED',
      'SENDING',
      'SENT',
      'FAILED',
      'UNKNOWN',
      'CANCELLED'
    )
  ),
  CONSTRAINT password_recovery_request_time_check CHECK (
    updated_at >= received_at
    AND (terminal_at IS NULL OR terminal_at >= received_at)
  ),
  CONSTRAINT password_recovery_request_attempt_number_check CHECK (
    current_attempt_number BETWEEN 0 AND 3
  ),
  CONSTRAINT password_recovery_request_anonymous_state_check CHECK (
    account_id IS NOT NULL OR state IN ('RECEIVED', 'SUPPRESSED')
  ),
  CONSTRAINT password_recovery_request_terminal_state_check CHECK (
    (
      state IN ('RECEIVED', 'PENDING', 'PREPARING', 'PREPARED', 'SENDING')
      AND terminal_at IS NULL
    )
    OR
    (
      state IN ('SUPPRESSED', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED')
      AND terminal_at IS NOT NULL
    )
  ),
  CONSTRAINT password_recovery_request_cancellation_check CHECK (
    (state = 'CANCELLED' AND cancelled_operation_id IS NOT NULL)
    OR (state <> 'CANCELLED' AND cancelled_operation_id IS NULL)
  ),
  CONSTRAINT password_recovery_request_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX password_recovery_request_account_received_idx
  ON public.password_recovery_request (
    account_id,
    received_at DESC,
    recovery_request_id
  );
CREATE INDEX password_recovery_request_state_updated_idx
  ON public.password_recovery_request (state, updated_at, recovery_request_id);
CREATE INDEX password_recovery_request_cancelled_operation_idx
  ON public.password_recovery_request (cancelled_operation_id);

CREATE TABLE public.password_recovery_delivery_attempt (
  delivery_attempt_id UUID NOT NULL,
  recovery_request_id UUID NOT NULL,
  attempt_number SMALLINT NOT NULL,
  state VARCHAR(20) NOT NULL,
  scheduled_at TIMESTAMPTZ(6) NOT NULL,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ(6),
  sending_confirmed_at TIMESTAMPTZ(6),
  accepted_at TIMESTAMPTZ(6),
  terminal_at TIMESTAMPTZ(6),
  failure_class VARCHAR(30),
  CONSTRAINT password_recovery_delivery_attempt_pkey
    PRIMARY KEY (delivery_attempt_id),
  CONSTRAINT password_recovery_delivery_attempt_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(delivery_attempt_id) = 4) IS TRUE
  ),
  CONSTRAINT password_recovery_delivery_attempt_request_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(recovery_request_id) = 4) IS TRUE
  ),
  CONSTRAINT password_recovery_delivery_attempt_lease_id_version_check CHECK (
    lease_id IS NULL
    OR (pg_catalog.uuid_extract_version(lease_id) = 4) IS TRUE
  ),
  CONSTRAINT password_recovery_delivery_attempt_number_check CHECK (
    attempt_number BETWEEN 1 AND 3
  ),
  CONSTRAINT password_recovery_delivery_attempt_state_check CHECK (
    state IN (
      'PREPARING',
      'PREPARED',
      'SENDING',
      'SENT',
      'FAILED',
      'UNKNOWN',
      'CANCELLED'
    )
  ),
  CONSTRAINT password_recovery_delivery_attempt_failure_class_check CHECK (
    failure_class IS NULL
    OR failure_class IN ('PREPARATION_FAILURE', 'DELIVERY_FAILURE')
  ),
  CONSTRAINT password_recovery_delivery_attempt_lease_check CHECK (
    (
      state IN ('PREPARING', 'PREPARED', 'SENDING')
      AND lease_id IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > scheduled_at
    )
    OR
    (
      state IN ('SENT', 'FAILED', 'UNKNOWN', 'CANCELLED')
      AND lease_id IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CONSTRAINT password_recovery_delivery_attempt_terminal_check CHECK (
    (
      state IN ('PREPARING', 'PREPARED', 'SENDING')
      AND terminal_at IS NULL
    )
    OR
    (
      state IN ('SENT', 'FAILED', 'UNKNOWN', 'CANCELLED')
      AND terminal_at IS NOT NULL
      AND terminal_at >= scheduled_at
    )
  ),
  CONSTRAINT password_recovery_delivery_attempt_sending_check CHECK (
    (
      state IN ('SENDING', 'SENT', 'UNKNOWN')
      AND sending_confirmed_at IS NOT NULL
      AND sending_confirmed_at >= scheduled_at
    )
    OR
    (
      state IN ('PREPARING', 'PREPARED', 'CANCELLED')
      AND sending_confirmed_at IS NULL
    )
    OR
    (
      state = 'FAILED'
      AND (
        (failure_class = 'PREPARATION_FAILURE' AND sending_confirmed_at IS NULL)
        OR
        (
          failure_class = 'DELIVERY_FAILURE'
          AND sending_confirmed_at IS NOT NULL
          AND sending_confirmed_at >= scheduled_at
        )
      )
    )
  ),
  CONSTRAINT password_recovery_delivery_attempt_acceptance_check CHECK (
    (
      state = 'SENT'
      AND accepted_at IS NOT NULL
      AND accepted_at >= sending_confirmed_at
    )
    OR (state <> 'SENT' AND accepted_at IS NULL)
  ),
  CONSTRAINT password_recovery_delivery_attempt_failure_check CHECK (
    (state = 'FAILED' AND failure_class IS NOT NULL)
    OR (state <> 'FAILED' AND failure_class IS NULL)
  ),
  CONSTRAINT password_recovery_delivery_attempt_request_number_key
    UNIQUE (recovery_request_id, attempt_number),
  CONSTRAINT password_recovery_delivery_attempt_recovery_request_id_fkey
    FOREIGN KEY (recovery_request_id)
    REFERENCES public.password_recovery_request(recovery_request_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX password_recovery_delivery_attempt_state_schedule_idx
  ON public.password_recovery_delivery_attempt (
    state,
    scheduled_at,
    delivery_attempt_id
  );
CREATE INDEX password_recovery_delivery_attempt_expired_lease_idx
  ON public.password_recovery_delivery_attempt (
    lease_expires_at,
    delivery_attempt_id
  )
  WHERE state IN ('PREPARING', 'PREPARED', 'SENDING');

CREATE TABLE public.password_reset_token (
  password_reset_token_id UUID NOT NULL,
  delivery_attempt_id UUID NOT NULL,
  account_id UUID NOT NULL,
  token_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  consumed_at TIMESTAMPTZ(6),
  consumed_operation_id UUID,
  invalidated_at TIMESTAMPTZ(6),
  invalidated_operation_id UUID,
  CONSTRAINT password_reset_token_pkey PRIMARY KEY (password_reset_token_id),
  CONSTRAINT password_reset_token_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(password_reset_token_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_token_delivery_attempt_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(delivery_attempt_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_token_account_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(account_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_token_consumed_operation_id_version_check CHECK (
    consumed_operation_id IS NULL
    OR (pg_catalog.uuid_extract_version(consumed_operation_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_token_invalidated_operation_id_version_check CHECK (
    invalidated_operation_id IS NULL
    OR (pg_catalog.uuid_extract_version(invalidated_operation_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_token_hash_length_check CHECK (
    pg_catalog.octet_length(token_hash) = 32
  ),
  CONSTRAINT password_reset_token_expiration_check CHECK (
    expires_at = created_at + INTERVAL '30 minutes'
  ),
  CONSTRAINT password_reset_token_consumption_check CHECK (
    (consumed_at IS NULL AND consumed_operation_id IS NULL)
    OR
    (
      consumed_at IS NOT NULL
      AND consumed_at >= created_at
      AND consumed_operation_id IS NOT NULL
    )
  ),
  CONSTRAINT password_reset_token_invalidation_check CHECK (
    (invalidated_at IS NULL AND invalidated_operation_id IS NULL)
    OR
    (
      invalidated_at IS NOT NULL
      AND invalidated_at >= created_at
      AND invalidated_operation_id IS NOT NULL
    )
  ),
  CONSTRAINT password_reset_token_terminal_exclusivity_check CHECK (
    consumed_at IS NULL OR invalidated_at IS NULL
  ),
  CONSTRAINT password_reset_token_delivery_attempt_id_key UNIQUE (delivery_attempt_id),
  CONSTRAINT password_reset_token_hash_key UNIQUE (token_hash),
  CONSTRAINT password_reset_token_consumed_operation_id_key
    UNIQUE (consumed_operation_id),
  CONSTRAINT password_reset_token_delivery_attempt_id_fkey
    FOREIGN KEY (delivery_attempt_id)
    REFERENCES public.password_recovery_delivery_attempt(delivery_attempt_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT password_reset_token_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX password_reset_token_active_account_expiration_idx
  ON public.password_reset_token (
    account_id,
    expires_at,
    password_reset_token_id
  )
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX password_reset_token_invalidated_operation_idx
  ON public.password_reset_token (invalidated_operation_id);

CREATE TABLE public.password_reset_operation (
  reset_operation_id UUID NOT NULL,
  account_id UUID NOT NULL,
  password_reset_token_id UUID NOT NULL,
  expected_changed_operation_id UUID NOT NULL,
  state VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ(6) NOT NULL,
  updated_at TIMESTAMPTZ(6) NOT NULL,
  terminal_at TIMESTAMPTZ(6),
  CONSTRAINT password_reset_operation_pkey PRIMARY KEY (reset_operation_id),
  CONSTRAINT password_reset_operation_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(reset_operation_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_operation_account_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(account_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_operation_token_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(password_reset_token_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_operation_expected_change_version_check CHECK (
    (pg_catalog.uuid_extract_version(expected_changed_operation_id) = 4) IS TRUE
  ),
  CONSTRAINT password_reset_operation_state_check CHECK (
    state IN ('STARTED', 'UNKNOWN', 'COMPLETED', 'NOT_FOUND', 'INCONSISTENT')
  ),
  CONSTRAINT password_reset_operation_time_check CHECK (
    updated_at >= started_at
    AND (terminal_at IS NULL OR terminal_at >= started_at)
  ),
  CONSTRAINT password_reset_operation_terminal_state_check CHECK (
    (state IN ('STARTED', 'UNKNOWN') AND terminal_at IS NULL)
    OR
    (
      state IN ('COMPLETED', 'NOT_FOUND', 'INCONSISTENT')
      AND terminal_at IS NOT NULL
    )
  ),
  CONSTRAINT password_reset_operation_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT password_reset_operation_password_reset_token_id_fkey
    FOREIGN KEY (password_reset_token_id)
    REFERENCES public.password_reset_token(password_reset_token_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX password_reset_operation_state_updated_idx
  ON public.password_reset_operation (state, updated_at, reset_operation_id);
CREATE INDEX password_reset_operation_account_id_idx
  ON public.password_reset_operation (account_id);
CREATE INDEX password_reset_operation_token_id_idx
  ON public.password_reset_operation (password_reset_token_id);

CREATE OR REPLACE FUNCTION public.bootstrap_initial_admin(
  p_operation_id UUID,
  p_account_id UUID,
  p_account_event_id UUID,
  p_role_event_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_password_hash TEXT,
  p_operator_reference TEXT,
  p_authorization_reference TEXT,
  p_installation_reference TEXT
)
RETURNS TABLE (
  outcome TEXT,
  created_account_id UUID,
  completed_operation_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_state public.bootstrap_state%ROWTYPE;
  v_first_name TEXT;
  v_last_name TEXT;
  v_email TEXT;
  v_email_key TEXT;
  v_operator_reference TEXT;
  v_authorization_reference TEXT;
  v_installation_reference TEXT;
  v_occurred_at TIMESTAMPTZ(6);
  v_updated_rows INTEGER;
BEGIN
  IF p_operation_id IS NULL
     OR p_account_id IS NULL
     OR p_account_event_id IS NULL
     OR p_role_event_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_INVALID_IDENTIFIERS', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_state
  FROM public.bootstrap_state
  WHERE singleton_id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_STATE_MISSING', ERRCODE = 'P0001';
  END IF;

  IF v_state.status = 'COMPLETED' THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_ALREADY_COMPLETED', ERRCODE = 'P0001';
  END IF;

  IF v_state.status <> 'PENDING'
     OR v_state.initial_account_id IS NOT NULL
     OR v_state.operation_id IS NOT NULL
     OR v_state.completed_at IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_STATE_INCONSISTENT', ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.global_role_assignment
  WHERE role = 'GLOBAL_ADMIN'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_STATE_INCONSISTENT', ERRCODE = 'P0001';
  END IF;

  v_first_name := pg_catalog.btrim(p_first_name, ' ');
  v_last_name := pg_catalog.btrim(p_last_name, ' ');
  v_email := pg_catalog.btrim(p_email, ' ');
  v_email_key := pg_catalog.translate(
    v_email,
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );
  v_operator_reference := pg_catalog.btrim(p_operator_reference, ' ');
  v_authorization_reference := pg_catalog.btrim(p_authorization_reference, ' ');
  v_installation_reference := pg_catalog.btrim(p_installation_reference, ' ');

  IF v_operator_reference IS NULL
     OR v_authorization_reference IS NULL
     OR v_installation_reference IS NULL
     OR pg_catalog.char_length(v_operator_reference) NOT BETWEEN 1 AND 100
     OR pg_catalog.char_length(v_authorization_reference) NOT BETWEEN 1 AND 200
     OR pg_catalog.char_length(v_installation_reference) NOT BETWEEN 1 AND 100
     OR v_operator_reference ~ '[[:cntrl:]]'
     OR v_authorization_reference ~ '[[:cntrl:]]'
     OR v_installation_reference ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_INVALID_REFERENCES', ERRCODE = 'P0001';
  END IF;

  v_occurred_at := pg_catalog.transaction_timestamp();

  INSERT INTO public.account (
    id,
    first_name,
    last_name,
    email,
    email_key,
    email_verified_at,
    status,
    created_at,
    deactivated_at
  ) VALUES (
    p_account_id,
    v_first_name,
    v_last_name,
    v_email,
    v_email_key,
    v_occurred_at,
    'ACTIVE',
    v_occurred_at,
    NULL
  );

  INSERT INTO public.password_credential (
    account_id,
    password_hash,
    changed_at,
    changed_operation_id
  ) VALUES (
    p_account_id,
    p_password_hash,
    v_occurred_at,
    p_operation_id
  );

  INSERT INTO public.global_role_assignment (
    account_id,
    role,
    granted_at
  ) VALUES (
    p_account_id,
    'GLOBAL_ADMIN',
    v_occurred_at
  );

  INSERT INTO public.audit_event (
    id,
    occurred_at,
    actor_account_id,
    origin,
    scope,
    operation,
    result,
    entity_type,
    entity_id,
    before_data,
    after_data,
    context,
    correlation_id,
    operation_id,
    sequence
  ) VALUES (
    p_account_event_id,
    v_occurred_at,
    NULL,
    'BOOTSTRAP_ADMIN_CLI',
    'GLOBAL_ADMINISTRATION',
    'ACCOUNT_CREATED',
    'SUCCESS',
    'ACCOUNT',
    p_account_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'status', 'ACTIVE',
      'email_verified', TRUE
    ),
    pg_catalog.jsonb_build_object(
      'operator_reference', v_operator_reference,
      'authorization_reference', v_authorization_reference,
      'installation_reference', v_installation_reference,
      'email_verification_method', 'ADMINISTRATIVE_CONFIRMATION'
    ),
    p_operation_id,
    p_operation_id,
    1
  ), (
    p_role_event_id,
    v_occurred_at,
    NULL,
    'BOOTSTRAP_ADMIN_CLI',
    'GLOBAL_ADMINISTRATION',
    'GLOBAL_ADMIN_GRANTED',
    'SUCCESS',
    'ACCOUNT',
    p_account_id,
    pg_catalog.jsonb_build_object('role', NULL),
    pg_catalog.jsonb_build_object('role', 'GLOBAL_ADMIN'),
    pg_catalog.jsonb_build_object(
      'operator_reference', v_operator_reference,
      'authorization_reference', v_authorization_reference,
      'installation_reference', v_installation_reference
    ),
    p_operation_id,
    p_operation_id,
    2
  );

  UPDATE public.bootstrap_state
  SET
    status = 'COMPLETED',
    initial_account_id = p_account_id,
    operation_id = p_operation_id,
    completed_at = v_occurred_at
  WHERE singleton_id = 1
    AND status = 'PENDING';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_STATE_INCONSISTENT', ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT 'COMPLETED'::TEXT, p_account_id, p_operation_id;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM LIKE 'BF_BOOTSTRAP_%' THEN
      RAISE;
    END IF;

    RAISE EXCEPTION USING MESSAGE = 'BF_BOOTSTRAP_FAILED', ERRCODE = 'P0001';
END
$function$;

REVOKE ALL ON TABLE public.password_recovery_request
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON TABLE public.password_recovery_delivery_attempt
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON TABLE public.password_reset_token
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON TABLE public.password_reset_operation
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

REVOKE ALL ON FUNCTION public.bootstrap_initial_admin(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO bello_bootstrap_executor;

GRANT SELECT (account_id, changed_operation_id)
  ON TABLE public.password_credential TO bello_bootstrap_executor;

COMMIT;
