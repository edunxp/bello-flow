BEGIN;

DO $prerequisites$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bello_runtime'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Required Bello runtime role is not provisioned',
      HINT = 'Provision roles with the environment administration procedure before running Prisma Migrate.';
  END IF;
END
$prerequisites$;

CREATE TABLE public.auth_session (
  id UUID NOT NULL,
  account_id UUID NOT NULL,
  token_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL,
  last_activity_at TIMESTAMPTZ(6) NOT NULL,
  absolute_expires_at TIMESTAMPTZ(6) NOT NULL,
  created_operation_id UUID NOT NULL,
  revoked_at TIMESTAMPTZ(6),
  revocation_reason VARCHAR(40),
  revoked_operation_id UUID,
  CONSTRAINT auth_session_pkey PRIMARY KEY (id),
  CONSTRAINT auth_session_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(id) = 4) IS TRUE
  ),
  CONSTRAINT auth_session_account_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(account_id) = 4) IS TRUE
  ),
  CONSTRAINT auth_session_token_hash_length_check CHECK (
    pg_catalog.octet_length(token_hash) = 32
  ),
  CONSTRAINT auth_session_created_operation_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(created_operation_id) = 4) IS TRUE
  ),
  CONSTRAINT auth_session_revoked_operation_id_version_check CHECK (
    revoked_operation_id IS NULL
    OR (pg_catalog.uuid_extract_version(revoked_operation_id) = 4) IS TRUE
  ),
  CONSTRAINT auth_session_activity_check CHECK (
    last_activity_at >= created_at
    AND last_activity_at <= absolute_expires_at
  ),
  CONSTRAINT auth_session_absolute_expiration_check CHECK (
    absolute_expires_at = created_at + INTERVAL '168 hours'
  ),
  CONSTRAINT auth_session_revocation_reason_check CHECK (
    revocation_reason IS NULL
    OR revocation_reason IN (
      'LOGOUT',
      'GLOBAL_LOGOUT',
      'PASSWORD_RESET',
      'ACCOUNT_DEACTIVATED',
      'DELIVERY_FAILED'
    )
  ),
  CONSTRAINT auth_session_revocation_state_check CHECK (
    (
      revoked_at IS NULL
      AND revocation_reason IS NULL
      AND revoked_operation_id IS NULL
    )
    OR
    (
      revoked_at IS NOT NULL
      AND revoked_at >= created_at
      AND revocation_reason IS NOT NULL
      AND revoked_operation_id IS NOT NULL
    )
  ),
  CONSTRAINT auth_session_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX auth_session_token_hash_key
  ON public.auth_session (token_hash);
CREATE UNIQUE INDEX auth_session_created_operation_id_key
  ON public.auth_session (created_operation_id);
CREATE INDEX auth_session_revoked_operation_id_idx
  ON public.auth_session (revoked_operation_id);
CREATE INDEX auth_session_active_account_id_idx
  ON public.auth_session (account_id)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.reconcile_auth_session_operation(
  operation_id UUID,
  expected_account_id UUID,
  expected_operation TEXT,
  expected_session_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_audit_total BIGINT;
  v_matching_events BIGINT;
  v_operation_sessions BIGINT;
  v_matching_sessions BIGINT;
  v_revocation_reason TEXT;
  v_revoked_session_count NUMERIC;
BEGIN
  IF operation_id IS NULL
     OR expected_account_id IS NULL
     OR expected_operation IS NULL
     OR (pg_catalog.uuid_extract_version(operation_id) = 4) IS NOT TRUE
     OR (pg_catalog.uuid_extract_version(expected_account_id) = 4) IS NOT TRUE
     OR (
       expected_session_id IS NOT NULL
       AND (pg_catalog.uuid_extract_version(expected_session_id) = 4) IS NOT TRUE
     )
     OR expected_operation NOT IN (
       'AUTH_LOGIN_SUCCEEDED',
       'AUTH_LOGIN_FAILED',
       'AUTH_SESSION_LOGOUT',
       'AUTH_SESSIONS_REVOKED'
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_AUTH_RECONCILIATION_INVALID_INPUT',
      ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_audit_total
  FROM public.audit_event AS event
  WHERE event.operation_id = $1;

  IF expected_operation = 'AUTH_LOGIN_SUCCEEDED' THEN
    IF expected_session_id IS NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_AUTH_RECONCILIATION_INVALID_INPUT',
        ERRCODE = 'P0001';
    END IF;

    SELECT
      pg_catalog.count(*),
      pg_catalog.count(*) FILTER (
        WHERE session.id = expected_session_id
          AND session.account_id = expected_account_id
      )
    INTO v_operation_sessions, v_matching_sessions
    FROM public.auth_session AS session
    WHERE session.created_operation_id = $1;

    SELECT pg_catalog.count(*)
    INTO v_matching_events
    FROM public.audit_event AS event
    WHERE event.operation_id = $1
      AND event.sequence = 1
      AND event.operation = expected_operation
      AND event.result = 'SUCCESS'
      AND event.origin = 'HTTP_API'
      AND event.scope = 'SECURITY'
      AND event.entity_type = 'AUTH_SESSION'
      AND event.entity_id = expected_session_id
      AND event.actor_account_id = expected_account_id;

    IF v_audit_total = 0 AND v_operation_sessions = 0 THEN
      RETURN 'NOT_FOUND';
    END IF;
    IF v_audit_total = 1
       AND v_matching_events = 1
       AND v_operation_sessions = 1
       AND v_matching_sessions = 1 THEN
      RETURN 'COMPLETED';
    END IF;
    RETURN 'INCONSISTENT';
  END IF;

  IF expected_operation = 'AUTH_LOGIN_FAILED' THEN
    IF expected_session_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_AUTH_RECONCILIATION_INVALID_INPUT',
        ERRCODE = 'P0001';
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_matching_events
    FROM public.audit_event AS event
    WHERE event.operation_id = $1
      AND event.sequence = 1
      AND event.operation = expected_operation
      AND event.result = 'DENIED'
      AND event.origin = 'HTTP_API'
      AND event.scope = 'SECURITY'
      AND event.entity_type = 'ACCOUNT'
      AND event.entity_id = expected_account_id
      AND event.actor_account_id = expected_account_id;

    IF v_audit_total = 0 THEN
      RETURN 'NOT_FOUND';
    END IF;
    IF v_audit_total = 1 AND v_matching_events = 1 THEN
      RETURN 'COMPLETED';
    END IF;
    RETURN 'INCONSISTENT';
  END IF;

  IF expected_operation = 'AUTH_SESSION_LOGOUT' THEN
    IF expected_session_id IS NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_AUTH_RECONCILIATION_INVALID_INPUT',
        ERRCODE = 'P0001';
    END IF;

    SELECT
      pg_catalog.count(*),
      pg_catalog.count(*) FILTER (
        WHERE session.id = expected_session_id
          AND session.account_id = expected_account_id
          AND session.revocation_reason = 'LOGOUT'
      )
    INTO v_operation_sessions, v_matching_sessions
    FROM public.auth_session AS session
    WHERE session.revoked_operation_id = $1;

    SELECT pg_catalog.count(*)
    INTO v_matching_events
    FROM public.audit_event AS event
    WHERE event.operation_id = $1
      AND event.sequence = 1
      AND event.operation = expected_operation
      AND event.result = 'SUCCESS'
      AND event.origin = 'HTTP_API'
      AND event.scope = 'SECURITY'
      AND event.entity_type = 'AUTH_SESSION'
      AND event.entity_id = expected_session_id
      AND event.actor_account_id = expected_account_id;

    IF v_audit_total = 0 AND v_operation_sessions = 0 THEN
      RETURN 'NOT_FOUND';
    END IF;
    IF v_audit_total = 1
       AND v_matching_events = 1
       AND v_operation_sessions = 1
       AND v_matching_sessions = 1 THEN
      RETURN 'COMPLETED';
    END IF;
    RETURN 'INCONSISTENT';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.max(event.context ->> 'reason'),
    pg_catalog.max(
      (event.context ->> 'revoked_session_count')::NUMERIC
    )
  INTO v_matching_events, v_revocation_reason, v_revoked_session_count
  FROM public.audit_event AS event
  WHERE event.operation_id = $1
    AND event.sequence = 1
    AND event.operation = expected_operation
    AND event.result = 'SUCCESS'
    AND event.origin = 'HTTP_API'
    AND event.scope = 'SECURITY'
    AND event.entity_type = 'ACCOUNT'
    AND event.entity_id = expected_account_id
    AND event.context IS NOT NULL
    AND pg_catalog.jsonb_typeof(
      event.context -> 'revoked_session_count'
    ) = 'number'
    AND event.context ->> 'reason' IN (
      'GLOBAL_LOGOUT',
      'PASSWORD_RESET',
      'ACCOUNT_DEACTIVATED',
      'DELIVERY_FAILED'
    );

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE session.account_id = expected_account_id
        AND session.revocation_reason = v_revocation_reason
        AND (
          expected_session_id IS NULL
          OR session.id = expected_session_id
        )
    )
  INTO v_operation_sessions, v_matching_sessions
  FROM public.auth_session AS session
  WHERE session.revoked_operation_id = $1;

  IF v_audit_total = 0 AND v_operation_sessions = 0 THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_audit_total = 1
     AND v_matching_events = 1
     AND v_revoked_session_count = v_operation_sessions
     AND v_operation_sessions = v_matching_sessions
     AND (
       expected_session_id IS NULL
       OR v_operation_sessions = 1
     ) THEN
    RETURN 'COMPLETED';
  END IF;
  RETURN 'INCONSISTENT';
END
$function$;

REVOKE ALL ON TABLE public.auth_session
  FROM PUBLIC, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.reconcile_auth_session_operation(
  UUID, UUID, TEXT, UUID
) FROM PUBLIC, bello_bootstrap_executor, bello_audit_maintenance;

GRANT SELECT (id, email_key, email_verified_at, status, deactivated_at)
  ON TABLE public.account TO bello_runtime;
GRANT SELECT (account_id, password_hash, changed_at)
  ON TABLE public.password_credential TO bello_runtime;

GRANT SELECT (
  id,
  account_id,
  token_hash,
  created_at,
  last_activity_at,
  absolute_expires_at,
  created_operation_id,
  revoked_at,
  revocation_reason,
  revoked_operation_id
) ON TABLE public.auth_session TO bello_runtime;
GRANT INSERT (
  id,
  account_id,
  token_hash,
  created_at,
  last_activity_at,
  absolute_expires_at,
  created_operation_id,
  revoked_at,
  revocation_reason,
  revoked_operation_id
) ON TABLE public.auth_session TO bello_runtime;
GRANT UPDATE (
  last_activity_at,
  revoked_at,
  revocation_reason,
  revoked_operation_id
) ON TABLE public.auth_session TO bello_runtime;

GRANT INSERT (
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
) ON TABLE public.audit_event TO bello_runtime;

GRANT EXECUTE ON FUNCTION public.reconcile_auth_session_operation(
  UUID, UUID, TEXT, UUID
) TO bello_runtime;

COMMIT;
