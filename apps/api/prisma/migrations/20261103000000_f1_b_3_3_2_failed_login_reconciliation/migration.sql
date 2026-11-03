BEGIN;

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
     OR expected_operation IS NULL
     OR (pg_catalog.uuid_extract_version(operation_id) = 4) IS NOT TRUE
     OR (
       expected_account_id IS NOT NULL
       AND (pg_catalog.uuid_extract_version(expected_account_id) = 4) IS NOT TRUE
     )
     OR (
       expected_account_id IS NULL
       AND expected_operation <> 'AUTH_LOGIN_FAILED'
     )
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
      AND event.entity_id IS NOT DISTINCT FROM expected_account_id
      AND event.actor_account_id IS NOT DISTINCT FROM expected_account_id
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND event.context = '{"authentication_type":"PASSWORD"}'::jsonb
      AND event.correlation_id = $1;

    SELECT pg_catalog.count(*)
    INTO v_operation_sessions
    FROM public.auth_session AS session
    WHERE session.created_operation_id = $1
       OR session.revoked_operation_id = $1;

    IF v_audit_total = 0 AND v_operation_sessions = 0 THEN
      RETURN 'NOT_FOUND';
    END IF;
    IF v_audit_total = 1
       AND v_matching_events = 1
       AND v_operation_sessions = 0 THEN
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

REVOKE ALL ON FUNCTION public.reconcile_auth_session_operation(
  UUID, UUID, TEXT, UUID
) FROM PUBLIC, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.reconcile_auth_session_operation(
  UUID, UUID, TEXT, UUID
) TO bello_runtime;

COMMIT;
