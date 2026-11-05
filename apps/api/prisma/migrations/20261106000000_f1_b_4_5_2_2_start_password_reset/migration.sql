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

CREATE FUNCTION public.start_password_reset_operation(
  p_reset_operation_id UUID,
  p_audit_event_id UUID,
  p_presented_token_hash BYTEA
)
RETURNS TABLE (
  account_id UUID,
  state TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_candidate_account_id UUID;
  v_candidate_token_id UUID;
  v_token public.password_reset_token%ROWTYPE;
  v_operation public.password_reset_operation%ROWTYPE;
  v_account public.account%ROWTYPE;
  v_credential public.password_credential%ROWTYPE;
  v_request_account_id UUID;
  v_occurred_at TIMESTAMPTZ(6);
  v_rejected BOOLEAN;
  v_audit_matches BOOLEAN;
  v_audit_total BIGINT;
  v_competing_operation_id UUID;
  v_effects_exist BOOLEAN;
BEGIN
  IF p_reset_operation_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_reset_operation_id) = 4) IS NOT TRUE
     OR p_audit_event_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_audit_event_id) = 4) IS NOT TRUE
     OR p_presented_token_hash IS NULL
     OR pg_catalog.octet_length(p_presented_token_hash) <> 32 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.password_reset_operation AS operation
  WHERE operation.reset_operation_id = p_reset_operation_id;

  SELECT token.*
  INTO v_token
  FROM public.password_reset_token AS token
  WHERE token.token_hash = p_presented_token_hash;

  IF v_operation.reset_operation_id IS NOT NULL
     AND v_token.password_reset_token_id IS NOT NULL
     AND v_operation.account_id <> v_token.account_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_OPERATION_BINDING_MISMATCH',
      ERRCODE = '22023';
  END IF;

  v_candidate_account_id := COALESCE(
    v_operation.account_id,
    v_token.account_id
  );
  v_candidate_token_id := v_token.password_reset_token_id;

  IF v_candidate_account_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.acquire_auth_account_advisory_xact_lock(v_candidate_account_id);

  SELECT account.*
  INTO v_account
  FROM public.account AS account
  WHERE account.id = v_candidate_account_id
  FOR UPDATE;

  IF v_account.id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_ACCOUNT_GRAPH_INCONSISTENT',
      ERRCODE = 'P0001';
  END IF;

  SELECT credential.*
  INTO v_credential
  FROM public.password_credential AS credential
  WHERE credential.account_id = v_candidate_account_id
  FOR UPDATE;

  IF v_credential.account_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_CREDENTIAL_MISSING',
      ERRCODE = 'P0001';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.password_reset_operation AS operation
  WHERE operation.reset_operation_id = p_reset_operation_id
  FOR UPDATE;

  IF v_candidate_token_id IS NOT NULL THEN
    SELECT operation.reset_operation_id
    INTO v_competing_operation_id
    FROM public.password_reset_operation AS operation
    WHERE operation.password_reset_token_id = v_candidate_token_id
      AND operation.reset_operation_id <> p_reset_operation_id
    ORDER BY operation.reset_operation_id
    LIMIT 1
    FOR UPDATE;
  END IF;

  SELECT token.*
  INTO v_token
  FROM public.password_reset_token AS token
  WHERE token.token_hash = p_presented_token_hash
  FOR UPDATE;

  IF v_token.password_reset_token_id IS NULL THEN
    IF v_operation.reset_operation_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_PASSWORD_RESET_OPERATION_BINDING_MISMATCH',
        ERRCODE = '22023';
    END IF;
    RETURN;
  END IF;

  IF v_token.account_id <> v_candidate_account_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_OPERATION_BINDING_MISMATCH',
      ERRCODE = '22023';
  END IF;

  SELECT request.account_id
  INTO v_request_account_id
  FROM public.password_recovery_delivery_attempt AS attempt
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  WHERE attempt.delivery_attempt_id = v_token.delivery_attempt_id;

  IF v_request_account_id IS NULL
     OR v_request_account_id <> v_token.account_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_TOKEN_GRAPH_INCONSISTENT',
      ERRCODE = 'P0001';
  END IF;

  IF v_operation.reset_operation_id IS NOT NULL THEN
    IF v_operation.account_id <> v_token.account_id
       OR v_operation.password_reset_token_id <> v_token.password_reset_token_id THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_PASSWORD_RESET_OPERATION_BINDING_MISMATCH',
        ERRCODE = '22023';
    END IF;

    SELECT
      EXISTS (
        SELECT 1
        FROM public.password_credential AS credential
        WHERE credential.changed_operation_id = p_reset_operation_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.password_reset_token AS token
        WHERE token.consumed_operation_id = p_reset_operation_id
           OR token.invalidated_operation_id = p_reset_operation_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.password_recovery_request AS request
        WHERE request.cancelled_operation_id = p_reset_operation_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.password_recovery_delivery_attempt AS attempt
        WHERE attempt.cancelled_operation_id = p_reset_operation_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.auth_session AS session
        WHERE session.revoked_operation_id = p_reset_operation_id
      )
    INTO v_effects_exist;

    SELECT pg_catalog.count(*)
    INTO v_audit_total
    FROM public.audit_event AS event
    WHERE event.operation_id = p_reset_operation_id;

    IF v_operation.state = 'STARTED' THEN
      IF v_effects_exist OR v_audit_total <> 0 THEN
        RAISE EXCEPTION USING
          MESSAGE = 'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
          ERRCODE = 'P0001';
      END IF;

      RETURN QUERY SELECT v_operation.account_id, v_operation.state::TEXT;
      RETURN;
    END IF;

    IF v_operation.state = 'REJECTED' THEN
      SELECT pg_catalog.count(*) = 1
      INTO v_audit_matches
      FROM public.audit_event AS event
      WHERE event.id = p_audit_event_id
        AND event.actor_account_id = v_operation.account_id
        AND event.origin = 'HTTP_API'
        AND event.scope = 'SECURITY'
        AND event.operation = 'AUTH_PASSWORD_RESET_REJECTED'
        AND event.result = 'DENIED'
        AND event.entity_type = 'ACCOUNT'
        AND event.entity_id = v_operation.account_id
        AND event.before_data IS NULL
        AND event.after_data IS NULL
        AND event.context = pg_catalog.jsonb_build_object(
          'reason', 'PASSWORD_RESET',
          'revoked_session_count', 0,
          'invalidated_token_count', 0,
          'cancelled_request_count', 0,
          'cancelled_attempt_count', 0
        )
        AND event.correlation_id = p_reset_operation_id
        AND event.operation_id = p_reset_operation_id
        AND event.sequence = 1;

      IF v_audit_total <> 1
         OR v_audit_matches IS NOT TRUE
         OR v_effects_exist THEN
        RAISE EXCEPTION USING
          MESSAGE = 'BF_PASSWORD_RESET_REJECTION_EVIDENCE_INCONSISTENT',
          ERRCODE = 'P0001';
      END IF;

      RETURN QUERY SELECT v_operation.account_id, v_operation.state::TEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
      ERRCODE = 'P0001';
  END IF;

  v_occurred_at := pg_catalog.transaction_timestamp();
  v_rejected := v_account.status <> 'ACTIVE'
    OR v_account.email_verified_at IS NULL
    OR v_account.deactivated_at IS NOT NULL
    OR v_token.expires_at <= v_occurred_at
    OR v_token.consumed_at IS NOT NULL
    OR v_token.invalidated_at IS NOT NULL
    OR v_competing_operation_id IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM public.audit_event AS event
    WHERE event.id = p_audit_event_id
       OR event.operation_id = p_reset_operation_id
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_AUDIT_BINDING_MISMATCH',
      ERRCODE = '22023';
  END IF;

  INSERT INTO public.password_reset_operation (
    reset_operation_id,
    account_id,
    password_reset_token_id,
    expected_changed_operation_id,
    state,
    started_at,
    updated_at,
    terminal_at
  ) VALUES (
    p_reset_operation_id,
    v_token.account_id,
    v_token.password_reset_token_id,
    v_credential.changed_operation_id,
    CASE WHEN v_rejected THEN 'REJECTED' ELSE 'STARTED' END,
    v_occurred_at,
    v_occurred_at,
    CASE WHEN v_rejected THEN v_occurred_at ELSE NULL END
  );

  IF v_rejected THEN
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
      p_audit_event_id,
      v_occurred_at,
      v_token.account_id,
      'HTTP_API',
      'SECURITY',
      'AUTH_PASSWORD_RESET_REJECTED',
      'DENIED',
      'ACCOUNT',
      v_token.account_id,
      NULL,
      NULL,
      pg_catalog.jsonb_build_object(
        'reason', 'PASSWORD_RESET',
        'revoked_session_count', 0,
        'invalidated_token_count', 0,
        'cancelled_request_count', 0,
        'cancelled_attempt_count', 0
      ),
      p_reset_operation_id,
      p_reset_operation_id,
      1
    );
  END IF;

  RETURN QUERY
  SELECT
    v_token.account_id,
    CASE WHEN v_rejected THEN 'REJECTED' ELSE 'STARTED' END::TEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.start_password_reset_operation(UUID, UUID, BYTEA)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.start_password_reset_operation(UUID, UUID, BYTEA)
  TO bello_runtime;

COMMIT;
