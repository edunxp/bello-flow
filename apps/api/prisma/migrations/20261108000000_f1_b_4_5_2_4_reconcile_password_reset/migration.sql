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

CREATE FUNCTION public.reconcile_password_reset_operation(
  p_reset_operation_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_candidate_account_id UUID;
  v_operation public.password_reset_operation%ROWTYPE;
  v_credential public.password_credential%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_ancestor_request_id UUID;
  v_audit_total BIGINT;
  v_success_audit_count BIGINT;
  v_rejection_audit_count BIGINT;
  v_credential_effect_count BIGINT;
  v_consumed_total BIGINT;
  v_consumed_matching BIGINT;
  v_invalidated_count BIGINT;
  v_cancelled_request_count BIGINT;
  v_cancelled_attempt_count BIGINT;
  v_revoked_session_count BIGINT;
  v_effect_total BIGINT;
  v_wrong_effect_count BIGINT;
  v_chain_operation_id UUID;
  v_chain_marker public.password_reset_operation%ROWTYPE;
  v_chain_token public.password_reset_token%ROWTYPE;
  v_chain_ancestor_request_id UUID;
  v_chain_request_account_id UUID;
  v_successor_count BIGINT;
  v_cross_account_successor_count BIGINT;
  v_successor_id UUID;
  v_successor_started_at TIMESTAMPTZ(6);
  v_seen_operations UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_reset_operation_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_reset_operation_id) = 4) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT operation.account_id
  INTO v_candidate_account_id
  FROM public.password_reset_operation AS operation
  WHERE operation.reset_operation_id = p_reset_operation_id;

  IF v_candidate_account_id IS NULL THEN
    RETURN 'UNKNOWN';
  END IF;

  PERFORM public.acquire_auth_account_advisory_xact_lock(v_candidate_account_id);

  PERFORM account.id
  FROM public.account AS account
  WHERE account.id = v_candidate_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'INCONSISTENT';
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

  IF v_operation.reset_operation_id IS NULL THEN
    RETURN 'UNKNOWN';
  END IF;
  IF v_operation.account_id <> v_candidate_account_id THEN
    RETURN 'INCONSISTENT';
  END IF;
  IF v_operation.started_at > pg_catalog.transaction_timestamp()
     OR v_operation.updated_at > pg_catalog.transaction_timestamp()
     OR v_operation.terminal_at > pg_catalog.transaction_timestamp() THEN
    RETURN 'INCONSISTENT';
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
  ORDER BY event.id
  FOR UPDATE;

  SELECT attempt.recovery_request_id
  INTO v_ancestor_request_id
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.delivery_attempt_id = v_token.delivery_attempt_id;

  IF v_token.password_reset_token_id IS NULL
     OR v_token.account_id <> v_candidate_account_id
     OR v_ancestor_request_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.password_recovery_request AS request
       WHERE request.recovery_request_id = v_ancestor_request_id
         AND request.account_id = v_candidate_account_id
     ) THEN
    RETURN 'INCONSISTENT';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_audit_total
  FROM public.audit_event AS event
  WHERE event.operation_id = p_reset_operation_id;

  SELECT pg_catalog.count(*)
  INTO v_credential_effect_count
  FROM public.password_credential AS credential
  WHERE credential.changed_operation_id = p_reset_operation_id;

  SELECT pg_catalog.count(*)
  INTO v_consumed_total
  FROM public.password_reset_token AS token
  WHERE token.consumed_operation_id = p_reset_operation_id;

  SELECT pg_catalog.count(*)
  INTO v_invalidated_count
  FROM public.password_reset_token AS token
  WHERE token.invalidated_operation_id = p_reset_operation_id;

  SELECT pg_catalog.count(*)
  INTO v_cancelled_request_count
  FROM public.password_recovery_request AS request
  WHERE request.cancelled_operation_id = p_reset_operation_id;

  SELECT pg_catalog.count(*)
  INTO v_cancelled_attempt_count
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.cancelled_operation_id = p_reset_operation_id;

  SELECT pg_catalog.count(*)
  INTO v_revoked_session_count
  FROM public.auth_session AS session
  WHERE session.revoked_operation_id = p_reset_operation_id;

  v_effect_total := v_credential_effect_count + v_consumed_total
    + v_invalidated_count + v_cancelled_request_count
    + v_cancelled_attempt_count + v_revoked_session_count;

  IF v_operation.state IN ('STARTED', 'UNKNOWN') THEN
    IF v_effect_total <> 0 OR v_audit_total <> 0 THEN
      RETURN 'INCONSISTENT';
    END IF;
    RETURN 'UNKNOWN';
  END IF;

  IF v_operation.state = 'NOT_FOUND' THEN
    IF v_effect_total <> 0 OR v_audit_total <> 0 THEN
      RETURN 'INCONSISTENT';
    END IF;
    IF v_operation.terminal_at >=
       pg_catalog.transaction_timestamp() - INTERVAL '30 days' THEN
      RETURN 'NOT_FOUND';
    END IF;
    RETURN 'UNKNOWN';
  END IF;

  IF v_operation.state = 'INCONSISTENT' THEN
    IF v_effect_total <> 0 OR v_audit_total <> 0 THEN
      RETURN 'INCONSISTENT';
    END IF;
    RETURN 'UNKNOWN';
  END IF;

  IF v_operation.state = 'REJECTED' THEN
    SELECT pg_catalog.count(*)
    INTO v_rejection_audit_count
    FROM public.audit_event AS event
    WHERE event.operation_id = p_reset_operation_id
      AND event.actor_account_id = v_candidate_account_id
      AND event.origin = 'HTTP_API'
      AND event.scope = 'SECURITY'
      AND event.operation = 'AUTH_PASSWORD_RESET_REJECTED'
      AND event.result = 'DENIED'
      AND event.entity_type = 'ACCOUNT'
      AND event.entity_id = v_candidate_account_id
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
      AND event.sequence = 1
      AND event.occurred_at = v_operation.terminal_at;

    IF v_effect_total = 0
       AND v_audit_total = 0
       AND v_operation.terminal_at <
         pg_catalog.transaction_timestamp() - INTERVAL '24 months' THEN
      RETURN 'UNKNOWN';
    END IF;

    IF v_audit_total = 1
       AND v_rejection_audit_count = 1
       AND v_effect_total = 0 THEN
      RETURN 'REJECTED';
    END IF;
    RETURN 'INCONSISTENT';
  END IF;

  IF v_operation.state <> 'COMPLETED' THEN
    RETURN 'INCONSISTENT';
  END IF;

  IF v_credential.account_id IS NULL THEN
    RETURN 'INCONSISTENT';
  END IF;

  v_chain_operation_id := p_reset_operation_id;

  LOOP
    IF v_chain_operation_id = ANY(v_seen_operations) THEN
      RETURN 'INCONSISTENT';
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

    IF v_chain_marker.reset_operation_id IS NULL
       OR v_chain_marker.state <> 'COMPLETED'
       OR v_chain_marker.terminal_at IS NULL
       OR v_chain_marker.started_at > v_chain_marker.updated_at
       OR v_chain_marker.started_at > v_chain_marker.terminal_at
       OR v_chain_marker.updated_at <> v_chain_marker.terminal_at
       OR v_chain_marker.started_at > pg_catalog.transaction_timestamp()
       OR v_chain_marker.updated_at > pg_catalog.transaction_timestamp()
       OR v_chain_marker.terminal_at > pg_catalog.transaction_timestamp() THEN
      RETURN 'INCONSISTENT';
    END IF;

    SELECT token.*
    INTO v_chain_token
    FROM public.password_reset_token AS token
    WHERE token.password_reset_token_id = v_chain_marker.password_reset_token_id;

    SELECT request.recovery_request_id, request.account_id
    INTO v_chain_ancestor_request_id, v_chain_request_account_id
    FROM public.password_recovery_delivery_attempt AS attempt
    JOIN public.password_recovery_request AS request
      ON request.recovery_request_id = attempt.recovery_request_id
    WHERE attempt.delivery_attempt_id = v_chain_token.delivery_attempt_id;

    IF v_chain_token.password_reset_token_id IS NULL
       OR v_chain_token.account_id <> v_candidate_account_id
       OR v_chain_token.expires_at <= v_chain_marker.terminal_at
       OR v_chain_token.invalidated_at IS NOT NULL
       OR v_chain_token.invalidated_operation_id IS NOT NULL
       OR v_chain_ancestor_request_id IS NULL
       OR v_chain_request_account_id IS DISTINCT FROM v_candidate_account_id THEN
      RETURN 'INCONSISTENT';
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_consumed_total
    FROM public.password_reset_token AS token
    WHERE token.consumed_operation_id = v_chain_operation_id;

    SELECT pg_catalog.count(*)
    INTO v_consumed_matching
    FROM public.password_reset_token AS token
    WHERE token.consumed_operation_id = v_chain_operation_id
      AND token.password_reset_token_id = v_chain_marker.password_reset_token_id
      AND token.account_id = v_candidate_account_id
      AND token.consumed_at = v_chain_marker.terminal_at
      AND token.expires_at > v_chain_marker.terminal_at
      AND token.invalidated_at IS NULL
      AND token.invalidated_operation_id IS NULL;

    SELECT pg_catalog.count(*)
    INTO v_invalidated_count
    FROM public.password_reset_token AS token
    WHERE token.invalidated_operation_id = v_chain_operation_id
      AND token.account_id = v_candidate_account_id
        AND token.password_reset_token_id <> v_chain_marker.password_reset_token_id
        AND token.invalidated_at = v_chain_marker.terminal_at
        AND token.expires_at > v_chain_marker.terminal_at
        AND token.consumed_at IS NULL
        AND token.consumed_operation_id IS NULL;

    SELECT pg_catalog.count(*)
    INTO v_cancelled_request_count
    FROM public.password_recovery_request AS request
    WHERE request.cancelled_operation_id = v_chain_operation_id
      AND request.account_id = v_candidate_account_id
        AND request.recovery_request_id <> v_chain_ancestor_request_id
      AND request.state = 'CANCELLED'
        AND request.received_at <= v_chain_marker.terminal_at
      AND request.updated_at = v_chain_marker.terminal_at
      AND request.terminal_at = v_chain_marker.terminal_at;

    SELECT pg_catalog.count(*)
    INTO v_cancelled_attempt_count
    FROM public.password_recovery_delivery_attempt AS attempt
    JOIN public.password_recovery_request AS request
      ON request.recovery_request_id = attempt.recovery_request_id
    WHERE attempt.cancelled_operation_id = v_chain_operation_id
      AND request.account_id = v_candidate_account_id
        AND request.recovery_request_id <> v_chain_ancestor_request_id
        AND request.cancelled_operation_id = v_chain_operation_id
        AND request.state = 'CANCELLED'
        AND request.updated_at = v_chain_marker.terminal_at
        AND request.terminal_at = v_chain_marker.terminal_at
      AND attempt.state = 'CANCELLED'
        AND attempt.scheduled_at <= v_chain_marker.terminal_at
      AND attempt.terminal_at = v_chain_marker.terminal_at;

    SELECT pg_catalog.count(*)
    INTO v_revoked_session_count
    FROM public.auth_session AS session
    WHERE session.revoked_operation_id = v_chain_operation_id
      AND session.account_id = v_candidate_account_id
      AND session.revocation_reason = 'PASSWORD_RESET'
      AND session.revoked_at = v_chain_marker.terminal_at;

    SELECT
      (SELECT pg_catalog.count(*) FROM public.password_reset_token AS token
       WHERE token.invalidated_operation_id = v_chain_operation_id
         AND (token.account_id <> v_candidate_account_id
              OR token.password_reset_token_id = v_chain_marker.password_reset_token_id
              OR token.invalidated_at IS DISTINCT FROM v_chain_marker.terminal_at
              OR token.expires_at <= v_chain_marker.terminal_at
              OR token.consumed_at IS NOT NULL
              OR token.consumed_operation_id IS NOT NULL))
      + (SELECT pg_catalog.count(*) FROM public.password_recovery_request AS request
         WHERE request.cancelled_operation_id = v_chain_operation_id
           AND (request.account_id IS DISTINCT FROM v_candidate_account_id
                OR request.recovery_request_id = v_chain_ancestor_request_id
                OR request.state <> 'CANCELLED'
                OR request.received_at > v_chain_marker.terminal_at
                OR request.updated_at IS DISTINCT FROM v_chain_marker.terminal_at
                OR request.terminal_at IS DISTINCT FROM v_chain_marker.terminal_at))
      + (SELECT pg_catalog.count(*)
         FROM public.password_recovery_delivery_attempt AS attempt
         LEFT JOIN public.password_recovery_request AS request
           ON request.recovery_request_id = attempt.recovery_request_id
         WHERE attempt.cancelled_operation_id = v_chain_operation_id
           AND (request.account_id IS DISTINCT FROM v_candidate_account_id
                OR request.recovery_request_id = v_chain_ancestor_request_id
                OR request.cancelled_operation_id IS DISTINCT FROM v_chain_operation_id
                OR request.state IS DISTINCT FROM 'CANCELLED'
                OR request.updated_at IS DISTINCT FROM v_chain_marker.terminal_at
                OR request.terminal_at IS DISTINCT FROM v_chain_marker.terminal_at
                OR attempt.state <> 'CANCELLED'
                OR attempt.scheduled_at > v_chain_marker.terminal_at
                OR attempt.terminal_at IS DISTINCT FROM v_chain_marker.terminal_at))
      + (SELECT pg_catalog.count(*) FROM public.auth_session AS session
         WHERE session.revoked_operation_id = v_chain_operation_id
           AND (session.account_id <> v_candidate_account_id
                OR session.revocation_reason <> 'PASSWORD_RESET'
                OR session.revoked_at IS DISTINCT FROM v_chain_marker.terminal_at))
      + (SELECT pg_catalog.count(*) FROM public.password_credential AS credential
         WHERE credential.changed_operation_id = v_chain_operation_id
           AND credential.account_id <> v_candidate_account_id)
      + (SELECT pg_catalog.count(*) FROM public.password_reset_token AS token
         WHERE token.account_id = v_candidate_account_id
           AND token.password_reset_token_id <> v_chain_marker.password_reset_token_id
           AND token.created_at <= v_chain_marker.terminal_at
           AND token.expires_at > v_chain_marker.terminal_at
           AND (token.consumed_at IS NULL
                OR token.consumed_at > v_chain_marker.terminal_at)
           AND (token.invalidated_at IS NULL
                OR token.invalidated_at > v_chain_marker.terminal_at))
      + (SELECT pg_catalog.count(*) FROM public.password_recovery_request AS request
         WHERE request.account_id = v_candidate_account_id
           AND request.recovery_request_id <> v_chain_ancestor_request_id
           AND request.received_at <= v_chain_marker.terminal_at
           AND request.state IN ('RECEIVED', 'PENDING', 'PREPARING', 'PREPARED')
           AND request.cancelled_operation_id IS NULL)
      + (SELECT pg_catalog.count(*)
         FROM public.password_recovery_delivery_attempt AS attempt
         JOIN public.password_recovery_request AS request
           ON request.recovery_request_id = attempt.recovery_request_id
         WHERE request.account_id = v_candidate_account_id
           AND request.recovery_request_id <> v_chain_ancestor_request_id
           AND request.received_at <= v_chain_marker.terminal_at
           AND request.state IN ('RECEIVED', 'PENDING', 'PREPARING', 'PREPARED')
           AND request.cancelled_operation_id IS NULL
           AND attempt.scheduled_at <= v_chain_marker.terminal_at
           AND attempt.state IN ('PREPARING', 'PREPARED')
           AND attempt.cancelled_operation_id IS NULL)
      + (SELECT pg_catalog.count(*) FROM public.auth_session AS session
         WHERE session.account_id = v_candidate_account_id
           AND session.created_at <= v_chain_marker.terminal_at
           AND (session.revoked_at IS NULL
                OR session.revoked_at > v_chain_marker.terminal_at))
    INTO v_wrong_effect_count;

    SELECT pg_catalog.count(*)
    INTO v_audit_total
    FROM public.audit_event AS event
    WHERE event.operation_id = v_chain_operation_id;

    SELECT pg_catalog.count(*)
    INTO v_success_audit_count
    FROM public.audit_event AS event
    WHERE event.operation_id = v_chain_operation_id
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
        'revoked_session_count', v_revoked_session_count,
        'invalidated_token_count', v_invalidated_count,
        'cancelled_request_count', v_cancelled_request_count,
        'cancelled_attempt_count', v_cancelled_attempt_count
      )
      AND event.correlation_id = v_chain_operation_id
      AND event.sequence = 1
      AND event.occurred_at = v_chain_marker.terminal_at;

    IF v_consumed_total <> 1
       OR v_consumed_matching <> 1
       OR v_wrong_effect_count <> 0 THEN
      RETURN 'INCONSISTENT';
    END IF;
    IF v_audit_total = 0
       AND v_chain_marker.terminal_at <
         pg_catalog.transaction_timestamp() - INTERVAL '24 months' THEN
      RETURN 'UNKNOWN';
    END IF;
    IF v_audit_total <> 1 OR v_success_audit_count <> 1 THEN
      RETURN 'INCONSISTENT';
    END IF;

    IF v_credential.changed_operation_id = v_chain_operation_id THEN
      IF v_credential.changed_at <> v_chain_marker.terminal_at THEN
        RETURN 'INCONSISTENT';
      END IF;
      RETURN 'COMPLETED';
    END IF;

    SELECT
      pg_catalog.count(*) FILTER (
        WHERE successor.account_id = v_candidate_account_id
      ),
      pg_catalog.count(*) FILTER (
        WHERE successor.account_id <> v_candidate_account_id
      ),
      (pg_catalog.array_agg(
        successor.reset_operation_id ORDER BY successor.reset_operation_id
      ) FILTER (
        WHERE successor.account_id = v_candidate_account_id
      ))[1],
      (pg_catalog.array_agg(
        successor.started_at ORDER BY successor.reset_operation_id
      ) FILTER (
        WHERE successor.account_id = v_candidate_account_id
      ))[1]
    INTO v_successor_count, v_cross_account_successor_count,
         v_successor_id, v_successor_started_at
    FROM public.password_reset_operation AS successor
    WHERE successor.expected_changed_operation_id = v_chain_operation_id
      AND successor.state = 'COMPLETED';

    IF v_cross_account_successor_count <> 0
       OR v_successor_count > 1 THEN
      RETURN 'INCONSISTENT';
    END IF;
    IF v_successor_count = 0 THEN
      IF v_chain_marker.terminal_at >=
         pg_catalog.transaction_timestamp() - INTERVAL '30 days' THEN
        RETURN 'INCONSISTENT';
      END IF;
      RETURN 'UNKNOWN';
    END IF;
    IF v_successor_started_at <= v_chain_marker.terminal_at THEN
      RETURN 'INCONSISTENT';
    END IF;

    v_chain_operation_id := v_successor_id;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.reconcile_password_reset_operation(UUID)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.reconcile_password_reset_operation(UUID)
  TO bello_runtime;

COMMIT;
