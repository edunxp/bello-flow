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

CREATE FUNCTION public.complete_password_reset_operation(
  p_reset_operation_id UUID,
  p_audit_event_id UUID,
  p_new_password_hash TEXT
)
RETURNS TABLE (
  account_id UUID,
  state TEXT,
  revoked_session_count BIGINT,
  invalidated_token_count BIGINT,
  cancelled_request_count BIGINT,
  cancelled_attempt_count BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_candidate_account_id UUID;
  v_operation public.password_reset_operation%ROWTYPE;
  v_account public.account%ROWTYPE;
  v_credential public.password_credential%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_ancestor_request_id UUID;
  v_occurred_at TIMESTAMPTZ(6);
  v_rejected BOOLEAN;
  v_audit_total BIGINT;
  v_audit_matches BOOLEAN;
  v_success_effects BIGINT;
  v_revoked_session_count BIGINT := 0;
  v_invalidated_token_count BIGINT := 0;
  v_cancelled_request_count BIGINT := 0;
  v_cancelled_attempt_count BIGINT := 0;
  v_chain_operation_id UUID;
  v_chain_marker public.password_reset_operation%ROWTYPE;
  v_chain_consumed_count BIGINT;
  v_chain_successor_count BIGINT;
  v_chain_successor_id UUID;
  v_chain_successor_started_at TIMESTAMPTZ(6);
  v_chain_revoked_count BIGINT;
  v_chain_invalidated_count BIGINT;
  v_chain_request_count BIGINT;
  v_chain_attempt_count BIGINT;
  v_seen_operations UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_reset_operation_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_reset_operation_id) = 4) IS NOT TRUE
     OR p_audit_event_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_audit_event_id) = 4) IS NOT TRUE
     OR p_new_password_hash IS NULL
     OR p_new_password_hash !~
       '^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$'
     OR pg_catalog.char_length(
       pg_catalog.rtrim(pg_catalog.split_part(p_new_password_hash, '$', 5), '=')
     ) <> 22
     OR pg_catalog.char_length(
       pg_catalog.rtrim(pg_catalog.split_part(p_new_password_hash, '$', 6), '=')
     ) <> 43 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT operation.account_id
  INTO v_candidate_account_id
  FROM public.password_reset_operation AS operation
  WHERE operation.reset_operation_id = p_reset_operation_id;

  IF v_candidate_account_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
      ERRCODE = 'P0001';
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

  PERFORM operation.reset_operation_id
  FROM public.password_reset_operation AS operation
  WHERE operation.account_id = v_candidate_account_id
  ORDER BY operation.reset_operation_id
  FOR UPDATE;

  SELECT operation.*
  INTO v_operation
  FROM public.password_reset_operation AS operation
  WHERE operation.reset_operation_id = p_reset_operation_id;

  IF v_operation.reset_operation_id IS NULL
     OR v_operation.account_id <> v_candidate_account_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
      ERRCODE = 'P0001';
  END IF;

  PERFORM request.recovery_request_id
  FROM public.password_recovery_request AS request
  WHERE request.account_id = v_candidate_account_id
  ORDER BY request.recovery_request_id
  FOR UPDATE;

  PERFORM attempt.delivery_attempt_id
  FROM public.password_recovery_delivery_attempt AS attempt
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  WHERE request.account_id = v_candidate_account_id
  ORDER BY attempt.delivery_attempt_id
  FOR UPDATE OF attempt;

  PERFORM token.password_reset_token_id
  FROM public.password_reset_token AS token
  WHERE token.account_id = v_candidate_account_id
  ORDER BY token.password_reset_token_id
  FOR UPDATE;

  SELECT token.*
  INTO v_token
  FROM public.password_reset_token AS token
  WHERE token.password_reset_token_id = v_operation.password_reset_token_id;

  PERFORM session.id
  FROM public.auth_session AS session
  WHERE session.account_id = v_candidate_account_id
  ORDER BY session.id
  FOR UPDATE;

  PERFORM event.id
  FROM public.audit_event AS event
  WHERE event.operation_id IN (
       SELECT marker.reset_operation_id
       FROM public.password_reset_operation AS marker
       WHERE marker.account_id = v_candidate_account_id
     )
     OR event.id = p_audit_event_id
  ORDER BY event.id
  FOR UPDATE;

  SELECT attempt.recovery_request_id
  INTO v_ancestor_request_id
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.delivery_attempt_id = v_token.delivery_attempt_id;

  IF v_token.password_reset_token_id IS NULL
     OR v_token.account_id <> v_operation.account_id
     OR v_ancestor_request_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.password_recovery_request AS request
       WHERE request.recovery_request_id = v_ancestor_request_id
         AND request.account_id = v_operation.account_id
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_OPERATION_BINDING_MISMATCH',
      ERRCODE = 'P0001';
  END IF;

  IF v_operation.state IN ('NOT_FOUND', 'INCONSISTENT', 'UNKNOWN') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
      ERRCODE = 'P0001';
  END IF;

  IF v_operation.state = 'REJECTED' THEN
    SELECT pg_catalog.count(*)
    INTO v_audit_total
    FROM public.audit_event AS event
    WHERE event.operation_id = p_reset_operation_id;

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

    SELECT
      (SELECT pg_catalog.count(*) FROM public.password_credential AS credential
       WHERE credential.changed_operation_id = p_reset_operation_id)
      + (SELECT pg_catalog.count(*) FROM public.password_reset_token AS token
         WHERE token.consumed_operation_id = p_reset_operation_id
            OR token.invalidated_operation_id = p_reset_operation_id)
      + (SELECT pg_catalog.count(*) FROM public.password_recovery_request AS request
         WHERE request.cancelled_operation_id = p_reset_operation_id)
      + (SELECT pg_catalog.count(*)
         FROM public.password_recovery_delivery_attempt AS attempt
         WHERE attempt.cancelled_operation_id = p_reset_operation_id)
      + (SELECT pg_catalog.count(*) FROM public.auth_session AS session
         WHERE session.revoked_operation_id = p_reset_operation_id)
    INTO v_success_effects;

    IF v_operation.terminal_at IS NULL
       OR v_audit_total <> 1
       OR v_audit_matches IS NOT TRUE
       OR v_success_effects <> 0 THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_PASSWORD_RESET_REJECTION_EVIDENCE_INCONSISTENT',
        ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT
      v_operation.account_id,
      'REJECTED'::TEXT,
      0::BIGINT,
      0::BIGINT,
      0::BIGINT,
      0::BIGINT;
    RETURN;
  END IF;

  IF v_operation.state = 'COMPLETED' THEN
    v_chain_operation_id := p_reset_operation_id;

    LOOP
      IF v_chain_operation_id = ANY(v_seen_operations) THEN
        RAISE EXCEPTION USING
          MESSAGE = 'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
          ERRCODE = 'P0001';
      END IF;
      v_seen_operations := pg_catalog.array_append(
        v_seen_operations,
        v_chain_operation_id
      );

      SELECT marker.*
      INTO v_chain_marker
      FROM public.password_reset_operation AS marker
      WHERE marker.reset_operation_id = v_chain_operation_id
        AND marker.account_id = v_candidate_account_id;

      SELECT pg_catalog.count(*)
      INTO v_chain_consumed_count
      FROM public.password_reset_token AS token
      WHERE token.consumed_operation_id = v_chain_operation_id
        AND token.password_reset_token_id = v_chain_marker.password_reset_token_id
        AND token.account_id = v_candidate_account_id;

      SELECT pg_catalog.count(*)
      INTO v_chain_revoked_count
      FROM public.auth_session AS session
      WHERE session.revoked_operation_id = v_chain_operation_id
        AND session.account_id = v_candidate_account_id
        AND session.revocation_reason = 'PASSWORD_RESET';

      SELECT pg_catalog.count(*)
      INTO v_chain_invalidated_count
      FROM public.password_reset_token AS token
      WHERE token.invalidated_operation_id = v_chain_operation_id
        AND token.account_id = v_candidate_account_id;

      SELECT pg_catalog.count(*)
      INTO v_chain_request_count
      FROM public.password_recovery_request AS request
      WHERE request.cancelled_operation_id = v_chain_operation_id
        AND request.account_id = v_candidate_account_id;

      SELECT pg_catalog.count(*)
      INTO v_chain_attempt_count
      FROM public.password_recovery_delivery_attempt AS attempt
      JOIN public.password_recovery_request AS request
        ON request.recovery_request_id = attempt.recovery_request_id
      WHERE attempt.cancelled_operation_id = v_chain_operation_id
        AND request.account_id = v_candidate_account_id;

      SELECT pg_catalog.count(*)
      INTO v_audit_total
      FROM public.audit_event AS event
      WHERE event.operation_id = v_chain_operation_id;

      SELECT pg_catalog.count(*) = 1
      INTO v_audit_matches
      FROM public.audit_event AS event
      WHERE event.operation_id = v_chain_operation_id
        AND (
          v_chain_operation_id <> p_reset_operation_id
          OR event.id = p_audit_event_id
        )
        AND event.actor_account_id = v_candidate_account_id
        AND event.origin = 'HTTP_API'
        AND event.scope = 'SECURITY'
        AND event.operation = 'AUTH_PASSWORD_RESET_SUCCEEDED'
        AND event.result = 'SUCCESS'
        AND event.entity_type = 'ACCOUNT'
        AND event.entity_id = v_candidate_account_id
        AND event.before_data IS NULL
        AND event.after_data IS NULL
        AND event.context = pg_catalog.jsonb_build_object(
          'reason', 'PASSWORD_RESET',
          'revoked_session_count', v_chain_revoked_count,
          'invalidated_token_count', v_chain_invalidated_count,
          'cancelled_request_count', v_chain_request_count,
          'cancelled_attempt_count', v_chain_attempt_count
        )
        AND event.correlation_id = v_chain_operation_id
        AND event.sequence = 1;

      IF v_chain_marker.reset_operation_id IS NULL
         OR v_chain_marker.state <> 'COMPLETED'
         OR v_chain_marker.terminal_at IS NULL
         OR v_chain_consumed_count <> 1
         OR v_audit_total <> 1
         OR v_audit_matches IS NOT TRUE
         OR EXISTS (
           SELECT 1 FROM public.password_reset_token AS token
           WHERE (token.consumed_operation_id = v_chain_operation_id
                  OR token.invalidated_operation_id = v_chain_operation_id)
             AND token.account_id <> v_candidate_account_id
         )
         OR EXISTS (
           SELECT 1 FROM public.password_recovery_request AS request
           WHERE request.cancelled_operation_id = v_chain_operation_id
             AND request.account_id IS DISTINCT FROM v_candidate_account_id
         )
         OR EXISTS (
           SELECT 1
           FROM public.password_recovery_delivery_attempt AS attempt
           JOIN public.password_recovery_request AS request
             ON request.recovery_request_id = attempt.recovery_request_id
           WHERE attempt.cancelled_operation_id = v_chain_operation_id
             AND request.account_id IS DISTINCT FROM v_candidate_account_id
         )
         OR EXISTS (
           SELECT 1 FROM public.auth_session AS session
           WHERE session.revoked_operation_id = v_chain_operation_id
             AND (session.account_id <> v_candidate_account_id
                  OR session.revocation_reason <> 'PASSWORD_RESET')
         ) THEN
        RAISE EXCEPTION USING
          MESSAGE = 'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
          ERRCODE = 'P0001';
      END IF;

      IF v_chain_operation_id = p_reset_operation_id THEN
        v_revoked_session_count := v_chain_revoked_count;
        v_invalidated_token_count := v_chain_invalidated_count;
        v_cancelled_request_count := v_chain_request_count;
        v_cancelled_attempt_count := v_chain_attempt_count;
      END IF;

      IF v_credential.account_id IS NOT NULL
         AND v_credential.changed_operation_id = v_chain_operation_id THEN
        EXIT;
      END IF;

      SELECT
        pg_catalog.count(*),
        (pg_catalog.array_agg(
          successor.reset_operation_id ORDER BY successor.reset_operation_id
        ))[1],
        (pg_catalog.array_agg(
          successor.started_at ORDER BY successor.reset_operation_id
        ))[1]
      INTO
        v_chain_successor_count,
        v_chain_successor_id,
        v_chain_successor_started_at
      FROM public.password_reset_operation AS successor
      WHERE successor.account_id = v_candidate_account_id
        AND successor.expected_changed_operation_id = v_chain_operation_id
        AND successor.state = 'COMPLETED';

      IF v_chain_successor_count <> 1
         OR v_chain_successor_started_at IS NULL
         OR v_chain_successor_started_at <= v_chain_marker.terminal_at THEN
        RAISE EXCEPTION USING
          MESSAGE = 'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
          ERRCODE = 'P0001';
      END IF;

      v_chain_operation_id := v_chain_successor_id;
    END LOOP;

    RETURN QUERY SELECT
      v_operation.account_id,
      'COMPLETED'::TEXT,
      v_revoked_session_count,
      v_invalidated_token_count,
      v_cancelled_request_count,
      v_cancelled_attempt_count;
    RETURN;
  END IF;

  IF v_operation.state <> 'STARTED' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
      ERRCODE = 'P0001';
  END IF;

  SELECT
    (SELECT pg_catalog.count(*) FROM public.password_credential AS credential
     WHERE credential.changed_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.password_reset_token AS token
       WHERE token.consumed_operation_id = p_reset_operation_id
          OR token.invalidated_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.password_recovery_request AS request
       WHERE request.cancelled_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*)
       FROM public.password_recovery_delivery_attempt AS attempt
       WHERE attempt.cancelled_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.auth_session AS session
       WHERE session.revoked_operation_id = p_reset_operation_id)
  INTO v_success_effects;

  SELECT pg_catalog.count(*)
  INTO v_audit_total
  FROM public.audit_event AS event
  WHERE event.operation_id = p_reset_operation_id;

  IF v_success_effects <> 0 OR v_audit_total <> 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
      ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.audit_event AS event
    WHERE event.id = p_audit_event_id
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_AUDIT_BINDING_MISMATCH',
      ERRCODE = '22023';
  END IF;

  v_occurred_at := pg_catalog.transaction_timestamp();
  v_rejected := v_account.status <> 'ACTIVE'
    OR v_account.email_verified_at IS NULL
    OR v_account.deactivated_at IS NOT NULL
    OR v_credential.account_id IS NULL
    OR v_credential.changed_operation_id <> v_operation.expected_changed_operation_id
    OR v_token.expires_at <= v_occurred_at
    OR v_token.consumed_at IS NOT NULL
    OR v_token.invalidated_at IS NOT NULL;

  IF v_rejected THEN
    INSERT INTO public.audit_event (
      id, occurred_at, actor_account_id, origin, scope, operation, result,
      entity_type, entity_id, before_data, after_data, context,
      correlation_id, operation_id, sequence
    ) VALUES (
      p_audit_event_id, v_occurred_at, v_operation.account_id,
      'HTTP_API', 'SECURITY', 'AUTH_PASSWORD_RESET_REJECTED', 'DENIED',
      'ACCOUNT', v_operation.account_id, NULL, NULL,
      pg_catalog.jsonb_build_object(
        'reason', 'PASSWORD_RESET',
        'revoked_session_count', 0,
        'invalidated_token_count', 0,
        'cancelled_request_count', 0,
        'cancelled_attempt_count', 0
      ),
      p_reset_operation_id, p_reset_operation_id, 1
    );

    UPDATE public.password_reset_operation AS operation
    SET state = 'REJECTED',
        updated_at = v_occurred_at,
        terminal_at = v_occurred_at
    WHERE operation.reset_operation_id = p_reset_operation_id
      AND operation.state = 'STARTED';

    RETURN QUERY SELECT
      v_operation.account_id,
      'REJECTED'::TEXT,
      0::BIGINT,
      0::BIGINT,
      0::BIGINT,
      0::BIGINT;
    RETURN;
  END IF;

  IF EXISTS (
       SELECT 1
       FROM public.password_recovery_request AS request
       WHERE request.account_id = v_operation.account_id
         AND request.recovery_request_id <> v_ancestor_request_id
         AND request.state IN ('RECEIVED', 'PENDING', 'PREPARING', 'PREPARED')
         AND request.cancelled_operation_id IS NULL
         AND request.received_at > v_occurred_at
     )
     OR EXISTS (
       SELECT 1
       FROM public.password_recovery_delivery_attempt AS attempt
       JOIN public.password_recovery_request AS request
         ON request.recovery_request_id = attempt.recovery_request_id
       WHERE request.account_id = v_operation.account_id
         AND request.recovery_request_id <> v_ancestor_request_id
         AND request.state IN ('RECEIVED', 'PENDING', 'PREPARING', 'PREPARED')
         AND request.cancelled_operation_id IS NULL
         AND attempt.state IN ('PREPARING', 'PREPARED')
         AND attempt.cancelled_operation_id IS NULL
         AND attempt.scheduled_at > v_occurred_at
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_CANCELLATION_GRAPH_INCONSISTENT',
      ERRCODE = 'P0001';
  END IF;

  UPDATE public.password_reset_token AS token
  SET consumed_at = v_occurred_at,
      consumed_operation_id = p_reset_operation_id
  WHERE token.password_reset_token_id = v_operation.password_reset_token_id
    AND token.account_id = v_operation.account_id
    AND token.consumed_at IS NULL
    AND token.invalidated_at IS NULL
    AND token.expires_at > v_occurred_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_COMPLETION_STATE_CHANGED',
      ERRCODE = 'P0001';
  END IF;

  UPDATE public.password_credential AS credential
  SET password_hash = p_new_password_hash,
      changed_at = v_occurred_at,
      changed_operation_id = p_reset_operation_id
  WHERE credential.account_id = v_operation.account_id
    AND credential.changed_operation_id = v_operation.expected_changed_operation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_COMPLETION_STATE_CHANGED',
      ERRCODE = 'P0001';
  END IF;

  UPDATE public.password_reset_token AS token
  SET invalidated_at = v_occurred_at,
      invalidated_operation_id = p_reset_operation_id
  WHERE token.account_id = v_operation.account_id
    AND token.password_reset_token_id <> v_operation.password_reset_token_id
    AND token.expires_at > v_occurred_at
    AND token.consumed_at IS NULL
    AND token.invalidated_at IS NULL;
  GET DIAGNOSTICS v_invalidated_token_count = ROW_COUNT;

  UPDATE public.password_recovery_delivery_attempt AS attempt
  SET state = 'CANCELLED',
      lease_id = NULL,
      lease_expires_at = NULL,
      terminal_at = v_occurred_at,
      cancelled_operation_id = p_reset_operation_id
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = attempt.recovery_request_id
    AND request.account_id = v_operation.account_id
    AND request.recovery_request_id <> v_ancestor_request_id
    AND request.state IN ('RECEIVED', 'PENDING', 'PREPARING', 'PREPARED')
    AND request.cancelled_operation_id IS NULL
    AND attempt.state IN ('PREPARING', 'PREPARED')
    AND attempt.cancelled_operation_id IS NULL
    AND v_occurred_at >= attempt.scheduled_at;
  GET DIAGNOSTICS v_cancelled_attempt_count = ROW_COUNT;

  UPDATE public.password_recovery_request AS request
  SET state = 'CANCELLED',
      updated_at = v_occurred_at,
      terminal_at = v_occurred_at,
      cancelled_operation_id = p_reset_operation_id
  WHERE request.account_id = v_operation.account_id
    AND request.recovery_request_id <> v_ancestor_request_id
    AND request.state IN ('RECEIVED', 'PENDING', 'PREPARING', 'PREPARED')
    AND request.cancelled_operation_id IS NULL
    AND v_occurred_at >= request.received_at;
  GET DIAGNOSTICS v_cancelled_request_count = ROW_COUNT;

  UPDATE public.auth_session AS session
  SET revoked_at = v_occurred_at,
      revocation_reason = 'PASSWORD_RESET',
      revoked_operation_id = p_reset_operation_id
  WHERE session.account_id = v_operation.account_id
    AND session.revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked_session_count = ROW_COUNT;

  INSERT INTO public.audit_event (
    id, occurred_at, actor_account_id, origin, scope, operation, result,
    entity_type, entity_id, before_data, after_data, context,
    correlation_id, operation_id, sequence
  ) VALUES (
    p_audit_event_id, v_occurred_at, v_operation.account_id,
    'HTTP_API', 'SECURITY', 'AUTH_PASSWORD_RESET_SUCCEEDED', 'SUCCESS',
    'ACCOUNT', v_operation.account_id, NULL, NULL,
    pg_catalog.jsonb_build_object(
      'reason', 'PASSWORD_RESET',
      'revoked_session_count', v_revoked_session_count,
      'invalidated_token_count', v_invalidated_token_count,
      'cancelled_request_count', v_cancelled_request_count,
      'cancelled_attempt_count', v_cancelled_attempt_count
    ),
    p_reset_operation_id, p_reset_operation_id, 1
  );

  UPDATE public.password_reset_operation AS operation
  SET state = 'COMPLETED',
      updated_at = v_occurred_at,
      terminal_at = v_occurred_at
  WHERE operation.reset_operation_id = p_reset_operation_id
    AND operation.state = 'STARTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_COMPLETION_STATE_CHANGED',
      ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT
    v_operation.account_id,
    'COMPLETED'::TEXT,
    v_revoked_session_count,
    v_invalidated_token_count,
    v_cancelled_request_count,
    v_cancelled_attempt_count;
END
$function$;

REVOKE ALL ON FUNCTION public.complete_password_reset_operation(UUID, UUID, TEXT)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.complete_password_reset_operation(UUID, UUID, TEXT)
  TO bello_runtime;

COMMIT;
