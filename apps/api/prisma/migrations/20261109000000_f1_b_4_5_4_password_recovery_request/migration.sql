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

CREATE FUNCTION public.reconcile_password_recovery_request(
  recovery_request_id UUID
)
RETURNS TABLE (outcome TEXT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_request public.password_recovery_request%ROWTYPE;
  v_attempt public.password_recovery_delivery_attempt%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_audit_total BIGINT;
  v_audit_matches BIGINT;
  v_attempt_total BIGINT;
  v_attempt_matches BIGINT;
  v_token_total BIGINT;
  v_token_account_matches BIGINT;
  v_token_chronology_matches BIGINT;
  v_invalidated_token_total BIGINT;
BEGIN
  IF $1 IS NULL
     OR (pg_catalog.uuid_extract_version($1) = 4) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = $1;

  IF v_request.recovery_request_id IS NULL THEN
    RETURN QUERY SELECT 'UNKNOWN'::TEXT;
    RETURN;
  END IF;

  IF v_request.account_id IS NOT NULL THEN
    PERFORM public.acquire_auth_account_advisory_xact_lock(v_request.account_id);

    PERFORM 1
    FROM public.account AS account
    WHERE account.id = v_request.account_id
    FOR UPDATE;

    PERFORM 1
    FROM public.password_credential AS credential
    WHERE credential.account_id = v_request.account_id
    FOR UPDATE;
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = $1
  FOR UPDATE;

  IF v_request.recovery_request_id IS NULL THEN
    RETURN QUERY SELECT 'UNKNOWN'::TEXT;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_audit_total
  FROM public.audit_event AS event
  WHERE event.operation_id = $1
     OR event.correlation_id = $1;

  SELECT pg_catalog.count(*)
  INTO v_audit_matches
  FROM public.audit_event AS event
  WHERE event.actor_account_id IS NULL
    AND event.origin = 'HTTP_API'
    AND event.scope = 'SECURITY'
    AND event.operation = 'AUTH_PASSWORD_RECOVERY_REQUESTED'
    AND event.result = 'SUCCESS'
    AND event.entity_type = 'ACCOUNT'
    AND event.entity_id = v_request.account_id
    AND event.before_data IS NULL
    AND event.after_data IS NULL
    AND event.context IS NULL
    AND event.correlation_id = $1
    AND event.operation_id = $1
    AND event.sequence = 1
    AND event.occurred_at = v_request.received_at;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE attempt.attempt_number = v_request.current_attempt_number
        AND attempt.state = v_request.state
        AND attempt.scheduled_at >= v_request.received_at
        AND (
          v_request.state <> 'CANCELLED'
          OR attempt.cancelled_operation_id = v_request.cancelled_operation_id
        )
    )
  INTO v_attempt_total, v_attempt_matches
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.recovery_request_id = $1;

  SELECT attempt.*
  INTO v_attempt
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.recovery_request_id = $1
    AND attempt.attempt_number = v_request.current_attempt_number
    AND attempt.state = v_request.state
    AND attempt.scheduled_at >= v_request.received_at
    AND (
      v_request.state <> 'CANCELLED'
      OR attempt.cancelled_operation_id = v_request.cancelled_operation_id
    );

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE token.account_id = v_request.account_id
    ),
    pg_catalog.count(*) FILTER (
      WHERE token.account_id = v_request.account_id
        AND token.created_at >= v_attempt.scheduled_at
        AND token.created_at <= COALESCE(
          v_attempt.sending_confirmed_at,
          v_attempt.terminal_at,
          v_request.updated_at
        )
    ),
    pg_catalog.count(*) FILTER (WHERE token.invalidated_at IS NOT NULL)
  INTO
    v_token_total,
    v_token_account_matches,
    v_token_chronology_matches,
    v_invalidated_token_total
  FROM public.password_reset_token AS token
  WHERE token.delivery_attempt_id = v_attempt.delivery_attempt_id;

  SELECT token.*
  INTO v_token
  FROM public.password_reset_token AS token
  WHERE token.delivery_attempt_id = v_attempt.delivery_attempt_id;

  IF v_request.state = 'PENDING'
     AND v_request.account_id IS NOT NULL
     AND v_request.updated_at = v_request.received_at
     AND v_request.terminal_at IS NULL
     AND v_request.current_attempt_number = 0
     AND v_request.cancelled_operation_id IS NULL
     AND v_audit_total = 1
     AND v_audit_matches = 1
     AND v_attempt_total = 0 THEN
    RETURN QUERY SELECT 'RECORDED'::TEXT;
    RETURN;
  END IF;

  IF v_request.state = 'SUPPRESSED'
     AND v_request.updated_at = v_request.received_at
     AND v_request.terminal_at = v_request.received_at
     AND v_request.terminal_at IS NOT NULL
     AND v_request.current_attempt_number = 0
     AND v_request.cancelled_operation_id IS NULL
     AND v_audit_total = 0
     AND v_attempt_total = 0 THEN
    RETURN QUERY SELECT 'RECORDED'::TEXT;
    RETURN;
  END IF;

  IF v_request.state IN (
       'PREPARING', 'PREPARED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'
     )
     AND v_request.account_id IS NOT NULL
     AND v_request.current_attempt_number BETWEEN 1 AND 3
     AND v_request.cancelled_operation_id IS NULL
     AND v_audit_total = 1
     AND v_audit_matches = 1
     AND v_attempt_total = v_request.current_attempt_number
     AND v_attempt_matches = 1
     AND v_attempt.scheduled_at >= v_request.received_at
     AND v_request.updated_at >= v_attempt.scheduled_at
     AND (
       v_request.state NOT IN ('SENDING', 'SENT', 'UNKNOWN')
       OR v_attempt.sending_confirmed_at <= v_request.updated_at
     )
     AND (
       v_request.state <> 'FAILED'
       OR v_attempt.failure_class <> 'DELIVERY_FAILURE'
       OR v_attempt.sending_confirmed_at <= v_request.updated_at
     )
     AND (
       (v_request.state = 'PREPARING' AND v_token_total = 0)
       OR (
         v_request.state IN ('PREPARED', 'SENDING', 'SENT', 'UNKNOWN')
         AND v_token_total = 1
         AND v_token_account_matches = 1
         AND v_token_chronology_matches = 1
         AND (
           v_request.state <> 'PREPARED'
           OR (
             v_token.consumed_at IS NULL
             AND v_token.consumed_operation_id IS NULL
             AND v_token.invalidated_at IS NULL
             AND v_token.invalidated_operation_id IS NULL
           )
         )
       )
       OR (
         v_request.state = 'FAILED'
         AND (
           (
             v_attempt.failure_class = 'PREPARATION_FAILURE'
             AND (
               v_token_total = 0
               OR (
                 v_token_total = 1
                 AND v_token_account_matches = 1
                 AND v_token_chronology_matches = 1
                 AND v_invalidated_token_total = 1
                 AND v_token.consumed_at IS NULL
                 AND v_token.invalidated_at <= v_attempt.terminal_at
               )
             )
           )
           OR (
             v_attempt.failure_class = 'DELIVERY_FAILURE'
             AND v_token_total = 1
             AND v_token_account_matches = 1
             AND v_token_chronology_matches = 1
           )
         )
       )
     )
     AND (
       v_request.state IN ('PREPARING', 'PREPARED', 'SENDING')
       OR (
         v_request.terminal_at IS NOT NULL
         AND v_attempt.terminal_at IS NOT NULL
         AND v_request.terminal_at >= v_attempt.terminal_at
         AND v_request.updated_at >= v_request.terminal_at
         AND (
           v_attempt.sending_confirmed_at IS NULL
           OR v_attempt.sending_confirmed_at <= v_attempt.terminal_at
         )
         AND (
           v_attempt.accepted_at IS NULL
           OR v_attempt.accepted_at <= v_attempt.terminal_at
         )
       )
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.password_recovery_delivery_attempt AS prior_attempt
       JOIN public.password_recovery_delivery_attempt AS next_attempt
         ON next_attempt.recovery_request_id = prior_attempt.recovery_request_id
        AND next_attempt.attempt_number = prior_attempt.attempt_number + 1
       LEFT JOIN public.password_reset_token AS prior_token
         ON prior_token.delivery_attempt_id = prior_attempt.delivery_attempt_id
       WHERE prior_attempt.recovery_request_id = $1
         AND prior_attempt.attempt_number < v_request.current_attempt_number
         AND (
           prior_attempt.state <> 'FAILED'
           OR prior_attempt.terminal_at IS NULL
           OR prior_attempt.scheduled_at < v_request.received_at
           OR prior_attempt.terminal_at > next_attempt.scheduled_at
           OR (
             prior_attempt.sending_confirmed_at IS NOT NULL
             AND prior_attempt.sending_confirmed_at > prior_attempt.terminal_at
           )
           OR (
             prior_token.delivery_attempt_id IS NOT NULL
             AND (
               prior_token.account_id IS DISTINCT FROM v_request.account_id
               OR prior_token.created_at < prior_attempt.scheduled_at
               OR prior_token.created_at > prior_attempt.terminal_at
               OR (
                 prior_attempt.sending_confirmed_at IS NOT NULL
                 AND prior_token.created_at > prior_attempt.sending_confirmed_at
               )
               OR prior_token.consumed_at IS NOT NULL
             )
           )
           OR (
             prior_attempt.failure_class = 'PREPARATION_FAILURE'
             AND prior_token.delivery_attempt_id IS NOT NULL
             AND (
               prior_token.invalidated_at IS NULL
               OR prior_token.invalidated_at > prior_attempt.terminal_at
               OR prior_token.invalidated_at > next_attempt.scheduled_at
             )
           )
           OR (
             prior_attempt.failure_class = 'DELIVERY_FAILURE'
             AND prior_token.delivery_attempt_id IS NULL
           )
         )
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.password_recovery_delivery_attempt AS attempt
       WHERE attempt.recovery_request_id = $1
         AND attempt.attempt_number > v_request.current_attempt_number
     ) THEN
    RETURN QUERY SELECT 'RECORDED'::TEXT;
    RETURN;
  END IF;

  IF v_request.state = 'CANCELLED'
     AND v_request.account_id IS NOT NULL
     AND v_request.cancelled_operation_id IS NOT NULL
     AND v_audit_total = 1
     AND v_audit_matches = 1
     AND (
       (
         v_request.current_attempt_number = 0
         AND v_attempt_total = 0
         AND v_token_total = 0
       )
       OR (
         v_request.current_attempt_number BETWEEN 1 AND 3
         AND v_attempt_total = v_request.current_attempt_number
         AND v_attempt_matches = 1
         AND v_attempt.scheduled_at >= v_request.received_at
         AND v_request.updated_at >= v_attempt.scheduled_at
         AND v_request.terminal_at IS NOT NULL
         AND v_attempt.terminal_at IS NOT NULL
         AND v_request.terminal_at >= v_attempt.terminal_at
         AND v_request.updated_at >= v_request.terminal_at
         AND (
           v_token_total = 0
           OR (
             v_token_total = 1
             AND v_token_account_matches = 1
             AND v_token_chronology_matches = 1
             AND v_invalidated_token_total = 1
             AND v_token.consumed_at IS NULL
             AND v_token.invalidated_operation_id = v_request.cancelled_operation_id
             AND v_token.invalidated_at <= v_attempt.terminal_at
             AND v_token.invalidated_at <= v_request.terminal_at
             AND v_token.invalidated_at <= v_request.updated_at
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM public.password_recovery_delivery_attempt AS prior_attempt
           JOIN public.password_recovery_delivery_attempt AS next_attempt
             ON next_attempt.recovery_request_id = prior_attempt.recovery_request_id
            AND next_attempt.attempt_number = prior_attempt.attempt_number + 1
           LEFT JOIN public.password_reset_token AS prior_token
             ON prior_token.delivery_attempt_id = prior_attempt.delivery_attempt_id
           WHERE prior_attempt.recovery_request_id = $1
             AND prior_attempt.attempt_number < v_request.current_attempt_number
             AND (
               prior_attempt.state <> 'FAILED'
               OR prior_attempt.terminal_at IS NULL
               OR prior_attempt.scheduled_at < v_request.received_at
               OR prior_attempt.terminal_at > next_attempt.scheduled_at
               OR (
                 prior_attempt.sending_confirmed_at IS NOT NULL
                 AND prior_attempt.sending_confirmed_at > prior_attempt.terminal_at
               )
               OR (
                 prior_token.delivery_attempt_id IS NOT NULL
                 AND (
                   prior_token.account_id IS DISTINCT FROM v_request.account_id
                   OR prior_token.created_at < prior_attempt.scheduled_at
                   OR prior_token.created_at > prior_attempt.terminal_at
                   OR (
                     prior_attempt.sending_confirmed_at IS NOT NULL
                     AND prior_token.created_at > prior_attempt.sending_confirmed_at
                   )
                   OR prior_token.consumed_at IS NOT NULL
                 )
               )
               OR (
                 prior_attempt.failure_class = 'PREPARATION_FAILURE'
                 AND prior_token.delivery_attempt_id IS NOT NULL
                 AND (
                   prior_token.invalidated_at IS NULL
                   OR prior_token.invalidated_at > prior_attempt.terminal_at
                   OR prior_token.invalidated_at > next_attempt.scheduled_at
                 )
               )
               OR (
                 prior_attempt.failure_class = 'DELIVERY_FAILURE'
                 AND prior_token.delivery_attempt_id IS NULL
               )
             )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM public.password_recovery_delivery_attempt AS attempt
           WHERE attempt.recovery_request_id = $1
             AND attempt.attempt_number > v_request.current_attempt_number
         )
       )
     ) THEN
    RETURN QUERY SELECT 'RECORDED'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'INCONSISTENT'::TEXT;
END
$function$;

CREATE FUNCTION public.request_password_recovery(
  recovery_request_id UUID,
  audit_event_id UUID,
  normalized_email_key TEXT
)
RETURNS TABLE (outcome TEXT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_account public.account%ROWTYPE;
  v_credential public.password_credential%ROWTYPE;
  v_candidate_account_id UUID;
  v_existing public.password_recovery_request%ROWTYPE;
  v_existing_outcome TEXT;
  v_now TIMESTAMPTZ(6);
  v_suppressed BOOLEAN;
  v_inserted BIGINT;
BEGIN
  IF $1 IS NULL
     OR (pg_catalog.uuid_extract_version($1) = 4) IS NOT TRUE
     OR $2 IS NULL
     OR (pg_catalog.uuid_extract_version($2) = 4) IS NOT TRUE
     OR (
       $3 IS NOT NULL
       AND (
         pg_catalog.char_length($3) NOT BETWEEN 3 AND 254
         OR pg_catalog.char_length(
           pg_catalog.split_part($3, '@', 1)
         ) NOT BETWEEN 1 AND 64
         OR $3 !~
           '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
       )
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO v_existing
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = $1;

  IF v_existing.recovery_request_id IS NOT NULL THEN
    SELECT reconciliation.outcome
    INTO v_existing_outcome
    FROM public.reconcile_password_recovery_request(
      $1
    ) AS reconciliation;

    SELECT request.*
    INTO v_existing
    FROM public.password_recovery_request AS request
    WHERE request.recovery_request_id = $1;

    IF v_existing_outcome <> 'RECORDED'
       OR (
         v_existing.state <> 'SUPPRESSED'
         AND NOT EXISTS (
           SELECT 1
           FROM public.audit_event AS event
           WHERE event.id = $2
             AND event.operation_id = $1
             AND event.correlation_id = $1
             AND event.sequence = 1
         )
       )
       OR (
         v_existing.state = 'SUPPRESSED'
         AND EXISTS (
           SELECT 1
           FROM public.audit_event AS event
           WHERE event.id = $2
         )
       ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_RECONCILIATION_REQUIRED',
        ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT 'RECORDED'::TEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.audit_event AS event
    WHERE event.id = $2
       OR event.operation_id = $1
       OR event.correlation_id = $1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_AUDIT_BINDING_MISMATCH',
      ERRCODE = '22023';
  END IF;

  IF $3 IS NOT NULL THEN
    SELECT account.id
    INTO v_candidate_account_id
    FROM public.account AS account
    WHERE account.email_key = $3;
  END IF;

  v_now := pg_catalog.transaction_timestamp();

  IF v_candidate_account_id IS NULL THEN
    INSERT INTO public.password_recovery_request (
      recovery_request_id,
      account_id,
      state,
      received_at,
      updated_at,
      terminal_at,
      current_attempt_number,
      cancelled_operation_id
    ) VALUES (
      $1,
      NULL,
      'RECEIVED',
      v_now,
      v_now,
      NULL,
      0,
      NULL
    )
    ON CONFLICT ON CONSTRAINT password_recovery_request_pkey DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 0 THEN
      SELECT reconciliation.outcome
      INTO v_existing_outcome
      FROM public.reconcile_password_recovery_request(
        $1
      ) AS reconciliation;

      SELECT request.*
      INTO v_existing
      FROM public.password_recovery_request AS request
      WHERE request.recovery_request_id = $1;

      IF v_existing_outcome <> 'RECORDED'
         OR (
           v_existing.state <> 'SUPPRESSED'
           AND NOT EXISTS (
             SELECT 1
             FROM public.audit_event AS event
             WHERE event.id = $2
               AND event.operation_id = $1
               AND event.correlation_id = $1
               AND event.sequence = 1
           )
         )
         OR (
           v_existing.state = 'SUPPRESSED'
           AND EXISTS (
             SELECT 1
             FROM public.audit_event AS event
             WHERE event.id = $2
           )
         ) THEN
        RAISE EXCEPTION USING
          MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_RECONCILIATION_REQUIRED',
          ERRCODE = 'P0001';
      END IF;

      RETURN QUERY SELECT 'RECORDED'::TEXT;
      RETURN;
    END IF;

    UPDATE public.password_recovery_request AS request
    SET state = 'SUPPRESSED',
        updated_at = v_now,
        terminal_at = v_now
    WHERE request.recovery_request_id = $1;

    SELECT reconciliation.outcome
    INTO v_existing_outcome
    FROM public.reconcile_password_recovery_request($1) AS reconciliation;

    IF v_existing_outcome <> 'RECORDED' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_RECONCILIATION_REQUIRED',
        ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT 'RECORDED'::TEXT;
    RETURN;
  END IF;

  PERFORM public.acquire_auth_account_advisory_xact_lock(v_candidate_account_id);

  SELECT account.*
  INTO v_account
  FROM public.account AS account
  WHERE account.id = v_candidate_account_id
  FOR UPDATE;

  IF v_account.id IS NULL
     OR v_account.email_key <> $3 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_ACCOUNT_GRAPH_INCONSISTENT',
      ERRCODE = 'P0001';
  END IF;

  SELECT credential.*
  INTO v_credential
  FROM public.password_credential AS credential
  WHERE credential.account_id = v_candidate_account_id
  FOR UPDATE;

  PERFORM 1
  FROM public.password_recovery_request AS request
  WHERE request.account_id = v_candidate_account_id
  ORDER BY request.recovery_request_id
  FOR UPDATE;

  PERFORM 1
  FROM public.password_reset_token AS token
  WHERE token.account_id = v_candidate_account_id
  ORDER BY token.password_reset_token_id
  FOR UPDATE;

  SELECT request.*
  INTO v_existing
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = $1;

  IF v_existing.recovery_request_id IS NOT NULL THEN
    SELECT reconciliation.outcome
    INTO v_existing_outcome
    FROM public.reconcile_password_recovery_request(
      $1
    ) AS reconciliation;

    SELECT request.*
    INTO v_existing
    FROM public.password_recovery_request AS request
    WHERE request.recovery_request_id = $1;

    IF v_existing_outcome <> 'RECORDED'
       OR (
         v_existing.state <> 'SUPPRESSED'
         AND NOT EXISTS (
           SELECT 1
           FROM public.audit_event AS event
           WHERE event.id = $2
             AND event.operation_id = $1
             AND event.correlation_id = $1
             AND event.sequence = 1
         )
       )
       OR (
         v_existing.state = 'SUPPRESSED'
         AND EXISTS (
           SELECT 1
           FROM public.audit_event AS event
           WHERE event.id = $2
         )
       ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_RECONCILIATION_REQUIRED',
        ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT 'RECORDED'::TEXT;
    RETURN;
  END IF;

  v_suppressed := v_account.status <> 'ACTIVE'
    OR v_account.email_verified_at IS NULL
    OR v_account.deactivated_at IS NOT NULL
    OR v_credential.account_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.password_recovery_request AS request
      JOIN public.audit_event AS event
        ON event.operation_id = request.recovery_request_id
       AND event.correlation_id = request.recovery_request_id
       AND event.sequence = 1
       AND event.actor_account_id IS NULL
       AND event.origin = 'HTTP_API'
       AND event.scope = 'SECURITY'
       AND event.operation = 'AUTH_PASSWORD_RECOVERY_REQUESTED'
       AND event.result = 'SUCCESS'
       AND event.entity_type = 'ACCOUNT'
       AND event.entity_id = v_candidate_account_id
       AND event.before_data IS NULL
       AND event.after_data IS NULL
       AND event.context IS NULL
      WHERE request.account_id = v_candidate_account_id
        AND request.received_at + INTERVAL '10 minutes' > v_now
    )
    OR EXISTS (
      SELECT 1
      FROM public.password_recovery_request AS request
      WHERE request.account_id = v_candidate_account_id
        AND request.state IN ('PENDING', 'PREPARING', 'PREPARED', 'SENDING')
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM public.password_reset_token AS token
      WHERE token.account_id = v_candidate_account_id
        AND token.expires_at > v_now
        AND token.consumed_at IS NULL
        AND token.invalidated_at IS NULL
    ) >= 3;

  INSERT INTO public.password_recovery_request (
    recovery_request_id,
    account_id,
    state,
    received_at,
    updated_at,
    terminal_at,
    current_attempt_number,
    cancelled_operation_id
  ) VALUES (
    $1,
    v_candidate_account_id,
    'RECEIVED',
    v_now,
    v_now,
    NULL,
    0,
    NULL
  );

  UPDATE public.password_recovery_request AS request
  SET state = CASE WHEN v_suppressed THEN 'SUPPRESSED' ELSE 'PENDING' END,
      updated_at = v_now,
      terminal_at = CASE WHEN v_suppressed THEN v_now ELSE NULL END
  WHERE request.recovery_request_id = $1;

  IF NOT v_suppressed THEN
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
      $2,
      v_now,
      NULL,
      'HTTP_API',
      'SECURITY',
      'AUTH_PASSWORD_RECOVERY_REQUESTED',
      'SUCCESS',
      'ACCOUNT',
      v_candidate_account_id,
      NULL,
      NULL,
      NULL,
      $1,
      $1,
      1
    );
  END IF;

  SELECT reconciliation.outcome
  INTO v_existing_outcome
  FROM public.reconcile_password_recovery_request($1) AS reconciliation;

  IF v_existing_outcome <> 'RECORDED' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_REQUEST_RECONCILIATION_REQUIRED',
      ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT 'RECORDED'::TEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.request_password_recovery(UUID, UUID, TEXT)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.reconcile_password_recovery_request(UUID)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.request_password_recovery(UUID, UUID, TEXT)
  TO bello_runtime;
GRANT EXECUTE ON FUNCTION public.reconcile_password_recovery_request(UUID)
  TO bello_runtime;

COMMIT;
