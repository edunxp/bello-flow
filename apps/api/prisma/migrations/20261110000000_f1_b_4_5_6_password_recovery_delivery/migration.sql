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

CREATE FUNCTION public.claim_password_recovery_delivery(
  p_delivery_attempt_id UUID,
  p_lease_id UUID
)
RETURNS TABLE (
  outcome TEXT,
  recovery_request_id UUID,
  delivery_attempt_id UUID,
  attempt_number SMALLINT,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  password_reset_token_id UUID
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.transaction_timestamp();
  v_request public.password_recovery_request%ROWTYPE;
  v_attempt public.password_recovery_delivery_attempt%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_account_id UUID;
  v_next_attempt SMALLINT;
  v_target_by_attempt BOOLEAN := FALSE;
BEGIN
  IF p_delivery_attempt_id IS NULL
     OR p_lease_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_delivery_attempt_id) = 4) IS NOT TRUE
     OR (pg_catalog.uuid_extract_version(p_lease_id) = 4) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_DELIVERY_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT request.recovery_request_id, request.account_id
  INTO v_request.recovery_request_id, v_account_id
  FROM public.password_recovery_delivery_attempt AS attempt
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  v_target_by_attempt := v_request.recovery_request_id IS NOT NULL;

  IF v_request.recovery_request_id IS NULL THEN
    SELECT request.recovery_request_id, request.account_id
    INTO v_request.recovery_request_id, v_account_id
    FROM public.password_recovery_request AS request
    LEFT JOIN public.password_recovery_delivery_attempt AS attempt
      ON attempt.recovery_request_id = request.recovery_request_id
     AND attempt.attempt_number = request.current_attempt_number
    LEFT JOIN public.password_reset_token AS token
      ON token.delivery_attempt_id = attempt.delivery_attempt_id
    WHERE request.account_id IS NOT NULL
      AND (
        (
          request.state IN ('PREPARING', 'PREPARED', 'SENDING')
          AND (
            attempt.delivery_attempt_id IS NULL
            OR attempt.state <> request.state
            OR attempt.lease_expires_at <= v_now
            OR (request.state = 'PREPARING' AND token.password_reset_token_id IS NOT NULL)
            OR (
              request.state IN ('PREPARED', 'SENDING')
              AND (
                token.password_reset_token_id IS NULL
                OR token.account_id <> request.account_id
                OR token.consumed_at IS NOT NULL
                OR token.invalidated_at IS NOT NULL
              )
            )
          )
        )
        OR
        (
          request.state = 'PENDING'
          AND (
            request.current_attempt_number IN (0, 3)
            OR (
              attempt.delivery_attempt_id IS NULL
              OR attempt.state <> 'FAILED'
              OR attempt.terminal_at IS NULL
              OR attempt.failure_class NOT IN ('PREPARATION_FAILURE', 'DELIVERY_FAILURE')
              OR token.password_reset_token_id IS NULL
              OR token.account_id <> request.account_id
              OR token.consumed_at IS NOT NULL
              OR token.invalidated_at IS NULL
              OR token.invalidated_operation_id IS DISTINCT FROM attempt.delivery_attempt_id
              OR v_now >= attempt.terminal_at + CASE attempt.attempt_number
                  WHEN 1 THEN INTERVAL '1 minute'
                  WHEN 2 THEN INTERVAL '5 minutes'
                  ELSE INTERVAL '100 years'
                END
            )
          )
        )
      )
    ORDER BY request.received_at, request.recovery_request_id
    LIMIT 1;
  END IF;

  IF v_request.recovery_request_id IS NULL OR v_account_id IS NULL THEN
    RETURN QUERY SELECT
      'NO_WORK'::TEXT, NULL::UUID, NULL::UUID, NULL::SMALLINT,
      NULL::UUID, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  PERFORM public.acquire_auth_account_advisory_xact_lock(v_account_id);

  PERFORM account.id
  FROM public.account AS account
  WHERE account.id = v_account_id
  FOR UPDATE;

  PERFORM credential.account_id
  FROM public.password_credential AS credential
  WHERE credential.account_id = v_account_id
  FOR UPDATE;

  PERFORM operation.reset_operation_id
  FROM public.password_reset_operation AS operation
  WHERE operation.account_id = v_account_id
  ORDER BY operation.reset_operation_id
  FOR UPDATE;

  PERFORM request.recovery_request_id
  FROM public.password_recovery_request AS request
  WHERE request.account_id = v_account_id
  ORDER BY request.recovery_request_id
  FOR UPDATE;

  PERFORM attempt.delivery_attempt_id
  FROM public.password_recovery_delivery_attempt AS attempt
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  WHERE request.account_id = v_account_id
  ORDER BY attempt.delivery_attempt_id
  FOR UPDATE OF attempt;

  PERFORM token.password_reset_token_id
  FROM public.password_reset_token AS token
  WHERE token.account_id = v_account_id
  ORDER BY token.password_reset_token_id
  FOR UPDATE;

  IF NOT v_target_by_attempt THEN
    v_request := NULL;
    SELECT request.*
    INTO v_request
    FROM public.password_recovery_request AS request
    LEFT JOIN public.password_recovery_delivery_attempt AS attempt
      ON attempt.recovery_request_id = request.recovery_request_id
     AND attempt.attempt_number = request.current_attempt_number
    LEFT JOIN public.password_reset_token AS token
      ON token.delivery_attempt_id = attempt.delivery_attempt_id
    WHERE request.account_id = v_account_id
      AND (
        (
          request.state IN ('PREPARING', 'PREPARED', 'SENDING')
          AND (
            attempt.delivery_attempt_id IS NULL
            OR attempt.state <> request.state
            OR attempt.lease_expires_at <= v_now
            OR (request.state = 'PREPARING' AND token.password_reset_token_id IS NOT NULL)
            OR (
              request.state IN ('PREPARED', 'SENDING')
              AND (
                token.password_reset_token_id IS NULL
                OR token.account_id <> request.account_id
                OR token.consumed_at IS NOT NULL
                OR token.invalidated_at IS NOT NULL
              )
            )
          )
        )
        OR
        (
          request.state = 'PENDING'
          AND (
            request.current_attempt_number IN (0, 3)
            OR (
              attempt.delivery_attempt_id IS NULL
              OR attempt.state <> 'FAILED'
              OR attempt.terminal_at IS NULL
              OR attempt.failure_class NOT IN ('PREPARATION_FAILURE', 'DELIVERY_FAILURE')
              OR token.password_reset_token_id IS NULL
              OR token.account_id <> request.account_id
              OR token.consumed_at IS NOT NULL
              OR token.invalidated_at IS NULL
              OR token.invalidated_operation_id IS DISTINCT FROM attempt.delivery_attempt_id
              OR v_now >= attempt.terminal_at + CASE attempt.attempt_number
                  WHEN 1 THEN INTERVAL '1 minute'
                  WHEN 2 THEN INTERVAL '5 minutes'
                  ELSE INTERVAL '100 years'
                END
            )
          )
        )
      )
    ORDER BY request.received_at, request.recovery_request_id
    LIMIT 1;

    IF v_request.recovery_request_id IS NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.password_recovery_request AS request
        LEFT JOIN public.password_recovery_delivery_attempt AS attempt
          ON attempt.recovery_request_id = request.recovery_request_id
         AND attempt.attempt_number = request.current_attempt_number
        LEFT JOIN public.password_reset_token AS token
          ON token.delivery_attempt_id = attempt.delivery_attempt_id
        WHERE request.account_id IS NOT NULL
          AND (
            (
              request.state IN ('PREPARING', 'PREPARED', 'SENDING')
              AND (
                attempt.delivery_attempt_id IS NULL
                OR attempt.state <> request.state
                OR attempt.lease_expires_at <= v_now
                OR (request.state = 'PREPARING' AND token.password_reset_token_id IS NOT NULL)
                OR (
                  request.state IN ('PREPARED', 'SENDING')
                  AND (
                    token.password_reset_token_id IS NULL
                    OR token.account_id <> request.account_id
                    OR token.consumed_at IS NOT NULL
                    OR token.invalidated_at IS NOT NULL
                  )
                )
              )
            )
            OR
            (
              request.state = 'PENDING'
              AND (
                request.current_attempt_number IN (0, 3)
                OR attempt.delivery_attempt_id IS NULL
                OR attempt.state <> 'FAILED'
                OR attempt.terminal_at IS NULL
                OR attempt.failure_class NOT IN ('PREPARATION_FAILURE', 'DELIVERY_FAILURE')
                OR token.password_reset_token_id IS NULL
                OR token.account_id <> request.account_id
                OR token.consumed_at IS NOT NULL
                OR token.invalidated_at IS NULL
                OR token.invalidated_operation_id IS DISTINCT FROM attempt.delivery_attempt_id
                OR v_now >= attempt.terminal_at + CASE attempt.attempt_number
                    WHEN 1 THEN INTERVAL '1 minute'
                    WHEN 2 THEN INTERVAL '5 minutes'
                    ELSE INTERVAL '100 years'
                  END
              )
            )
          )
      ) THEN
        RAISE EXCEPTION USING
          MESSAGE = 'BF_PASSWORD_RECOVERY_DELIVERY_RETRY_SELECTION',
          ERRCODE = '40001';
      END IF;

      RETURN QUERY SELECT
        'NO_WORK'::TEXT, NULL::UUID, NULL::UUID, NULL::SMALLINT,
        NULL::UUID, NULL::TIMESTAMPTZ, NULL::UUID;
      RETURN;
    END IF;
  ELSE
    SELECT request.*
    INTO v_request
    FROM public.password_recovery_request AS request
    WHERE request.recovery_request_id = v_request.recovery_request_id;
  END IF;

  IF v_request.recovery_request_id IS NULL
     OR v_request.account_id IS DISTINCT FROM v_account_id
     OR NOT EXISTS (
       SELECT 1
       FROM public.account AS account
       JOIN public.password_credential AS credential
         ON credential.account_id = account.id
       WHERE account.id = v_account_id
         AND account.status = 'ACTIVE'
         AND account.email_verified_at IS NOT NULL
         AND account.deactivated_at IS NULL
     ) THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id, NULL::UUID,
      NULL::SMALLINT, NULL::UUID, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  IF v_attempt.delivery_attempt_id IS NOT NULL THEN
    SELECT token.*
    INTO v_token
    FROM public.password_reset_token AS token
    WHERE token.delivery_attempt_id = v_attempt.delivery_attempt_id;

    IF v_attempt.recovery_request_id = v_request.recovery_request_id
       AND v_attempt.state = 'PREPARING'
       AND v_attempt.lease_id = p_lease_id
       AND v_attempt.terminal_at IS NULL
       AND v_token.password_reset_token_id IS NULL THEN
      RETURN QUERY SELECT
        'CLAIMED'::TEXT, v_request.recovery_request_id,
        v_attempt.delivery_attempt_id, v_attempt.attempt_number,
        v_attempt.lease_id, v_attempt.lease_expires_at, NULL::UUID;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_attempt.attempt_number,
      NULL::UUID, NULL::TIMESTAMPTZ, v_token.password_reset_token_id;
    RETURN;
  END IF;

  IF v_request.current_attempt_number > 0 THEN
    SELECT attempt.*
    INTO v_attempt
    FROM public.password_recovery_delivery_attempt AS attempt
    WHERE attempt.recovery_request_id = v_request.recovery_request_id
      AND attempt.attempt_number = v_request.current_attempt_number;

    SELECT token.*
    INTO v_token
    FROM public.password_reset_token AS token
    WHERE token.delivery_attempt_id = v_attempt.delivery_attempt_id;
  ELSE
    v_attempt := NULL;
    v_token := NULL;
  END IF;

  IF EXISTS (
       SELECT 1
       FROM public.password_recovery_delivery_attempt AS other_attempt
       WHERE other_attempt.recovery_request_id = v_request.recovery_request_id
         AND other_attempt.attempt_number > v_request.current_attempt_number
     )
     OR (
       v_request.current_attempt_number = 0
       AND EXISTS (
         SELECT 1
         FROM public.password_recovery_delivery_attempt AS unexpected_attempt
         WHERE unexpected_attempt.recovery_request_id = v_request.recovery_request_id
       )
     )
     OR (
       v_request.current_attempt_number > 0
       AND (
         v_attempt.delivery_attempt_id IS NULL
         OR v_attempt.attempt_number <> v_request.current_attempt_number
         OR v_attempt.recovery_request_id <> v_request.recovery_request_id
       )
     )
     OR (
       v_request.state IN ('PREPARING', 'PREPARED', 'SENDING')
       AND (
         v_attempt.state <> v_request.state
         OR (v_request.state = 'PREPARING' AND v_token.password_reset_token_id IS NOT NULL)
         OR (
           v_request.state IN ('PREPARED', 'SENDING')
           AND (
             v_token.password_reset_token_id IS NULL
             OR v_token.delivery_attempt_id <> v_attempt.delivery_attempt_id
             OR v_token.account_id <> v_account_id
             OR v_token.consumed_at IS NOT NULL
             OR v_token.invalidated_at IS NOT NULL
           )
         )
       )
     )
     OR (
       v_request.state = 'PENDING'
       AND v_request.current_attempt_number >= 3
     )
     OR (
       v_request.state = 'PENDING'
       AND v_request.current_attempt_number > 0
       AND (
         v_attempt.state <> 'FAILED'
         OR v_attempt.failure_class NOT IN ('PREPARATION_FAILURE', 'DELIVERY_FAILURE')
         OR v_attempt.terminal_at IS NULL
         OR v_token.password_reset_token_id IS NULL
         OR v_token.delivery_attempt_id <> v_attempt.delivery_attempt_id
         OR v_token.account_id <> v_account_id
         OR v_token.consumed_at IS NOT NULL
         OR v_token.invalidated_at IS NULL
         OR v_token.invalidated_operation_id IS DISTINCT FROM v_attempt.delivery_attempt_id
       )
     ) THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_request.current_attempt_number,
      NULL::UUID, NULL::TIMESTAMPTZ, v_token.password_reset_token_id;
    RETURN;
  END IF;

  IF v_request.state = 'PREPARING'
     AND v_attempt.state = 'PREPARING'
     AND v_attempt.lease_expires_at <= v_now
     AND v_token.password_reset_token_id IS NULL THEN
    UPDATE public.password_recovery_delivery_attempt AS attempt
    SET lease_id = p_lease_id,
        lease_expires_at = v_now + INTERVAL '60 seconds'
    WHERE attempt.delivery_attempt_id = v_attempt.delivery_attempt_id;

    UPDATE public.password_recovery_request AS request
    SET updated_at = v_now
    WHERE request.recovery_request_id = v_request.recovery_request_id;

    RETURN QUERY SELECT
      'RESUMED_PREPARING'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_attempt.attempt_number, p_lease_id,
      v_now + INTERVAL '60 seconds', NULL::UUID;
    RETURN;
  END IF;

  IF v_request.state = 'PREPARED'
     AND v_attempt.state = 'PREPARED'
     AND v_attempt.lease_expires_at <= v_now
     AND v_token.password_reset_token_id IS NOT NULL
     AND v_token.account_id = v_account_id
     AND v_token.consumed_at IS NULL
     AND v_token.invalidated_at IS NULL THEN
    UPDATE public.password_reset_token AS token
    SET invalidated_at = v_now,
        invalidated_operation_id = v_attempt.delivery_attempt_id
    WHERE token.password_reset_token_id = v_token.password_reset_token_id
      AND token.consumed_at IS NULL
      AND token.invalidated_at IS NULL;

    UPDATE public.password_recovery_delivery_attempt AS attempt
    SET state = 'FAILED',
        lease_id = NULL,
        lease_expires_at = NULL,
        terminal_at = v_now,
        failure_class = 'PREPARATION_FAILURE'
    WHERE attempt.delivery_attempt_id = v_attempt.delivery_attempt_id;

    UPDATE public.password_recovery_request AS request
    SET state = CASE WHEN v_attempt.attempt_number = 3 THEN 'FAILED' ELSE 'PENDING' END,
        updated_at = v_now,
        terminal_at = CASE WHEN v_attempt.attempt_number = 3 THEN v_now ELSE NULL END
    WHERE request.recovery_request_id = v_request.recovery_request_id;

    RETURN QUERY SELECT
      'RECOVERED_PREPARED'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_attempt.attempt_number,
      NULL::UUID, NULL::TIMESTAMPTZ, v_token.password_reset_token_id;
    RETURN;
  END IF;

  IF v_request.state = 'SENDING'
     AND v_attempt.state = 'SENDING'
     AND v_attempt.lease_expires_at <= v_now
     AND v_token.password_reset_token_id IS NOT NULL THEN
    UPDATE public.password_recovery_delivery_attempt AS attempt
    SET state = 'UNKNOWN',
        lease_id = NULL,
        lease_expires_at = NULL,
        terminal_at = v_now
    WHERE attempt.delivery_attempt_id = v_attempt.delivery_attempt_id;

    UPDATE public.password_recovery_request AS request
    SET state = 'UNKNOWN', updated_at = v_now, terminal_at = v_now
    WHERE request.recovery_request_id = v_request.recovery_request_id;

    RETURN QUERY SELECT
      'RECOVERED_SENDING_UNKNOWN'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_attempt.attempt_number,
      NULL::UUID, NULL::TIMESTAMPTZ, v_token.password_reset_token_id;
    RETURN;
  END IF;

  IF v_request.state <> 'PENDING' OR v_request.current_attempt_number >= 3 THEN
    RETURN QUERY SELECT
      'NO_WORK'::TEXT, NULL::UUID, NULL::UUID, NULL::SMALLINT,
      NULL::UUID, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF v_request.current_attempt_number > 0
     AND (
       v_attempt.state <> 'FAILED'
       OR v_attempt.terminal_at IS NULL
       OR v_now < v_attempt.terminal_at + CASE v_attempt.attempt_number
         WHEN 1 THEN INTERVAL '1 minute'
         WHEN 2 THEN INTERVAL '5 minutes'
         ELSE INTERVAL '100 years'
       END
     ) THEN
    RETURN QUERY SELECT
      'NO_WORK'::TEXT, NULL::UUID, NULL::UUID, NULL::SMALLINT,
      NULL::UUID, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  v_next_attempt := (v_request.current_attempt_number + 1)::SMALLINT;

  INSERT INTO public.password_recovery_delivery_attempt (
    delivery_attempt_id, recovery_request_id, attempt_number, state,
    scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
    accepted_at, terminal_at, failure_class, cancelled_operation_id
  ) VALUES (
    p_delivery_attempt_id, v_request.recovery_request_id, v_next_attempt,
    'PREPARING', v_now, p_lease_id, v_now + INTERVAL '60 seconds',
    NULL, NULL, NULL, NULL, NULL
  );

  UPDATE public.password_recovery_request AS request
  SET state = 'PREPARING',
      updated_at = v_now,
      terminal_at = NULL,
      current_attempt_number = v_next_attempt
  WHERE request.recovery_request_id = v_request.recovery_request_id;

  RETURN QUERY SELECT
    'CLAIMED'::TEXT, v_request.recovery_request_id, p_delivery_attempt_id,
    v_next_attempt, p_lease_id, v_now + INTERVAL '60 seconds', NULL::UUID;
END
$function$;

CREATE FUNCTION public.prepare_password_recovery_delivery(
  p_delivery_attempt_id UUID,
  p_lease_id UUID,
  p_password_reset_token_id UUID,
  p_token_hash BYTEA,
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
  outcome TEXT,
  recovery_request_id UUID,
  delivery_attempt_id UUID,
  password_reset_token_id UUID,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.transaction_timestamp();
  v_request public.password_recovery_request%ROWTYPE;
  v_attempt public.password_recovery_delivery_attempt%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_account_id UUID;
  v_active_tokens BIGINT;
  v_created_at TIMESTAMPTZ;
BEGIN
  IF p_delivery_attempt_id IS NULL
     OR p_lease_id IS NULL
     OR p_password_reset_token_id IS NULL
     OR p_token_hash IS NULL
     OR p_expires_at IS NULL
     OR (pg_catalog.uuid_extract_version(p_delivery_attempt_id) = 4) IS NOT TRUE
     OR (pg_catalog.uuid_extract_version(p_lease_id) = 4) IS NOT TRUE
     OR (pg_catalog.uuid_extract_version(p_password_reset_token_id) = 4) IS NOT TRUE
     OR pg_catalog.octet_length(p_token_hash) <> 32
     OR p_expires_at <= v_now
     OR p_expires_at > v_now + INTERVAL '30 minutes' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_PREPARATION_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  v_created_at := p_expires_at - INTERVAL '30 minutes';

  SELECT request.account_id
  INTO v_account_id
  FROM public.password_recovery_delivery_attempt AS attempt
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  IF v_account_id IS NULL THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, NULL::UUID, p_delivery_attempt_id,
      NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM public.acquire_auth_account_advisory_xact_lock(v_account_id);
  PERFORM account.id FROM public.account AS account
    WHERE account.id = v_account_id FOR UPDATE;
  PERFORM credential.account_id FROM public.password_credential AS credential
    WHERE credential.account_id = v_account_id FOR UPDATE;
  PERFORM operation.reset_operation_id
    FROM public.password_reset_operation AS operation
    WHERE operation.account_id = v_account_id
    ORDER BY operation.reset_operation_id FOR UPDATE;
  PERFORM request.recovery_request_id
    FROM public.password_recovery_request AS request
    WHERE request.account_id = v_account_id
    ORDER BY request.recovery_request_id FOR UPDATE;
  PERFORM attempt.delivery_attempt_id
    FROM public.password_recovery_delivery_attempt AS attempt
    JOIN public.password_recovery_request AS request
      ON request.recovery_request_id = attempt.recovery_request_id
    WHERE request.account_id = v_account_id
    ORDER BY attempt.delivery_attempt_id FOR UPDATE OF attempt;
  PERFORM token.password_reset_token_id
    FROM public.password_reset_token AS token
    WHERE token.account_id = v_account_id
    ORDER BY token.password_reset_token_id FOR UPDATE;

  SELECT attempt.*
  INTO v_attempt
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  SELECT request.*
  INTO v_request
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = v_attempt.recovery_request_id;

  SELECT token.*
  INTO v_token
  FROM public.password_reset_token AS token
  WHERE token.delivery_attempt_id = p_delivery_attempt_id;

  IF v_attempt.state = 'PREPARED'
     AND v_request.state = 'PREPARED'
     AND v_attempt.lease_id = p_lease_id
     AND v_token.password_reset_token_id = p_password_reset_token_id
     AND v_token.token_hash = p_token_hash
     AND v_token.expires_at = p_expires_at THEN
    RETURN QUERY SELECT
      'ALREADY_PREPARED_MATCHING'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_token.password_reset_token_id,
      v_token.expires_at;
    RETURN;
  END IF;

  IF v_attempt.state IN ('SENT', 'FAILED', 'UNKNOWN', 'CANCELLED') THEN
    RETURN QUERY SELECT
      'ALREADY_TERMINAL'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_token.password_reset_token_id,
      v_token.expires_at;
    RETURN;
  END IF;

  IF v_attempt.lease_id IS DISTINCT FROM p_lease_id THEN
    RETURN QUERY SELECT
      'STALE_OWNER'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_attempt.state <> 'PREPARING'
     OR v_request.state <> 'PREPARING'
     OR v_attempt.lease_expires_at <= v_now
     OR v_token.password_reset_token_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_token.password_reset_token_id,
      v_token.expires_at;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_active_tokens
  FROM public.password_reset_token AS token
  WHERE token.account_id = v_account_id
    AND token.expires_at > v_now
    AND token.consumed_at IS NULL
    AND token.invalidated_at IS NULL;

  IF v_active_tokens >= 3 THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  INSERT INTO public.password_reset_token (
    password_reset_token_id, delivery_attempt_id, account_id, token_hash,
    created_at, expires_at, consumed_at, consumed_operation_id,
    invalidated_at, invalidated_operation_id
  ) VALUES (
    p_password_reset_token_id, p_delivery_attempt_id, v_account_id,
    p_token_hash, v_created_at, p_expires_at, NULL, NULL, NULL, NULL
  );

  UPDATE public.password_recovery_delivery_attempt AS attempt
  SET state = 'PREPARED'
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id
    AND attempt.state = 'PREPARING'
    AND attempt.lease_id = p_lease_id;

  UPDATE public.password_recovery_request AS request
  SET state = 'PREPARED', updated_at = v_now
  WHERE request.recovery_request_id = v_request.recovery_request_id
    AND request.state = 'PREPARING';

  RETURN QUERY SELECT
    'PREPARED'::TEXT, v_request.recovery_request_id, p_delivery_attempt_id,
    p_password_reset_token_id, p_expires_at;
END
$function$;

CREATE FUNCTION public.confirm_password_recovery_sending(
  p_delivery_attempt_id UUID,
  p_lease_id UUID
)
RETURNS TABLE (
  outcome TEXT,
  recovery_request_id UUID,
  delivery_attempt_id UUID,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  recipient_email TEXT,
  token_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.transaction_timestamp();
  v_request public.password_recovery_request%ROWTYPE;
  v_attempt public.password_recovery_delivery_attempt%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_account_id UUID;
  v_email TEXT;
BEGIN
  IF p_delivery_attempt_id IS NULL
     OR p_lease_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_delivery_attempt_id) = 4) IS NOT TRUE
     OR (pg_catalog.uuid_extract_version(p_lease_id) = 4) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_SENDING_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT request.account_id
  INTO v_account_id
  FROM public.password_recovery_delivery_attempt AS attempt
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  IF v_account_id IS NULL THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, NULL::UUID, p_delivery_attempt_id,
      NULL::UUID, NULL::TIMESTAMPTZ, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM public.acquire_auth_account_advisory_xact_lock(v_account_id);
  SELECT account.email INTO v_email FROM public.account AS account
    WHERE account.id = v_account_id FOR UPDATE;
  PERFORM credential.account_id FROM public.password_credential AS credential
    WHERE credential.account_id = v_account_id FOR UPDATE;
  PERFORM operation.reset_operation_id
    FROM public.password_reset_operation AS operation
    WHERE operation.account_id = v_account_id
    ORDER BY operation.reset_operation_id FOR UPDATE;
  PERFORM request.recovery_request_id
    FROM public.password_recovery_request AS request
    WHERE request.account_id = v_account_id
    ORDER BY request.recovery_request_id FOR UPDATE;
  PERFORM attempt.delivery_attempt_id
    FROM public.password_recovery_delivery_attempt AS attempt
    JOIN public.password_recovery_request AS request
      ON request.recovery_request_id = attempt.recovery_request_id
    WHERE request.account_id = v_account_id
    ORDER BY attempt.delivery_attempt_id FOR UPDATE OF attempt;
  PERFORM token.password_reset_token_id
    FROM public.password_reset_token AS token
    WHERE token.account_id = v_account_id
    ORDER BY token.password_reset_token_id FOR UPDATE;

  SELECT attempt.*
  INTO v_attempt
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  SELECT request.*
  INTO v_request
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = v_attempt.recovery_request_id;

  SELECT token.* INTO v_token
  FROM public.password_reset_token AS token
  WHERE token.delivery_attempt_id = p_delivery_attempt_id;

  IF v_attempt.state = 'SENDING' AND v_request.state = 'SENDING' THEN
    RETURN QUERY SELECT
      'ALREADY_SENDING'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, NULL::UUID, NULL::TIMESTAMPTZ,
      NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_attempt.state IN ('SENT', 'FAILED', 'UNKNOWN', 'CANCELLED') THEN
    RETURN QUERY SELECT
      'ALREADY_TERMINAL'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, NULL::UUID, NULL::TIMESTAMPTZ,
      NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_attempt.lease_id IS DISTINCT FROM p_lease_id THEN
    RETURN QUERY SELECT
      'STALE_OWNER'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, NULL::UUID, NULL::TIMESTAMPTZ,
      NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_attempt.state <> 'PREPARED'
     OR v_request.state <> 'PREPARED'
     OR v_attempt.lease_expires_at <= v_now
     OR v_token.password_reset_token_id IS NULL
     OR v_token.account_id <> v_account_id
     OR v_token.expires_at <= v_now
     OR v_token.consumed_at IS NOT NULL
     OR v_token.invalidated_at IS NOT NULL
     OR v_email IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.account AS account
       JOIN public.password_credential AS credential
         ON credential.account_id = account.id
       WHERE account.id = v_account_id
         AND account.status = 'ACTIVE'
         AND account.email_verified_at IS NOT NULL
         AND account.deactivated_at IS NULL
     ) THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, NULL::UUID, NULL::TIMESTAMPTZ,
      NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  UPDATE public.password_recovery_delivery_attempt AS attempt
  SET state = 'SENDING',
      sending_confirmed_at = v_now,
      lease_expires_at = v_now + INTERVAL '60 seconds'
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id
    AND attempt.state = 'PREPARED'
    AND attempt.lease_id = p_lease_id;

  UPDATE public.password_recovery_request AS request
  SET state = 'SENDING', updated_at = v_now
  WHERE request.recovery_request_id = v_request.recovery_request_id
    AND request.state = 'PREPARED';

  RETURN QUERY SELECT
    'SEND_AUTHORIZED'::TEXT, v_request.recovery_request_id,
    p_delivery_attempt_id, p_lease_id, v_now + INTERVAL '60 seconds',
    v_email, v_token.expires_at;
END
$function$;

CREATE FUNCTION public.complete_password_recovery_delivery(
  p_delivery_attempt_id UUID,
  p_lease_id UUID,
  p_external_result TEXT,
  p_audit_event_id UUID
)
RETURNS TABLE (
  outcome TEXT,
  recovery_request_id UUID,
  delivery_attempt_id UUID,
  request_state TEXT,
  attempt_state TEXT,
  next_eligible_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.transaction_timestamp();
  v_request public.password_recovery_request%ROWTYPE;
  v_attempt public.password_recovery_delivery_attempt%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_account_id UUID;
  v_next_eligible_at TIMESTAMPTZ;
BEGIN
  IF p_delivery_attempt_id IS NULL
     OR p_lease_id IS NULL
     OR p_external_result NOT IN ('ACCEPTED', 'NOT_ACCEPTED', 'INDETERMINATE')
     OR (pg_catalog.uuid_extract_version(p_delivery_attempt_id) = 4) IS NOT TRUE
     OR (pg_catalog.uuid_extract_version(p_lease_id) = 4) IS NOT TRUE
     OR (p_external_result = 'ACCEPTED' AND (
       p_audit_event_id IS NULL
       OR (pg_catalog.uuid_extract_version(p_audit_event_id) = 4) IS NOT TRUE
     ))
     OR (p_external_result <> 'ACCEPTED' AND p_audit_event_id IS NOT NULL) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_COMPLETION_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  SELECT request.account_id
  INTO v_account_id
  FROM public.password_recovery_delivery_attempt AS attempt
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  IF v_account_id IS NULL THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, NULL::UUID, p_delivery_attempt_id,
      NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM public.acquire_auth_account_advisory_xact_lock(v_account_id);
  PERFORM account.id FROM public.account AS account
    WHERE account.id = v_account_id FOR UPDATE;
  PERFORM credential.account_id FROM public.password_credential AS credential
    WHERE credential.account_id = v_account_id FOR UPDATE;
  PERFORM operation.reset_operation_id
    FROM public.password_reset_operation AS operation
    WHERE operation.account_id = v_account_id
    ORDER BY operation.reset_operation_id FOR UPDATE;
  PERFORM request.recovery_request_id
    FROM public.password_recovery_request AS request
    WHERE request.account_id = v_account_id
    ORDER BY request.recovery_request_id FOR UPDATE;
  PERFORM attempt.delivery_attempt_id
    FROM public.password_recovery_delivery_attempt AS attempt
    JOIN public.password_recovery_request AS request
      ON request.recovery_request_id = attempt.recovery_request_id
    WHERE request.account_id = v_account_id
    ORDER BY attempt.delivery_attempt_id FOR UPDATE OF attempt;
  PERFORM token.password_reset_token_id
    FROM public.password_reset_token AS token
    WHERE token.account_id = v_account_id
    ORDER BY token.password_reset_token_id FOR UPDATE;
  PERFORM event.id
    FROM public.audit_event AS event
    WHERE event.operation_id = p_delivery_attempt_id
       OR event.id = p_audit_event_id
    ORDER BY event.id FOR UPDATE;

  SELECT attempt.*
  INTO v_attempt
  FROM public.password_recovery_delivery_attempt AS attempt
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  SELECT request.*
  INTO v_request
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = v_attempt.recovery_request_id;

  SELECT token.* INTO v_token
  FROM public.password_reset_token AS token
  WHERE token.delivery_attempt_id = p_delivery_attempt_id;

  IF v_attempt.state IN ('SENT', 'FAILED', 'UNKNOWN', 'CANCELLED') THEN
    RETURN QUERY SELECT
      'ALREADY_TERMINAL'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_request.state::TEXT,
      v_attempt.state::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_attempt.lease_id IS DISTINCT FROM p_lease_id THEN
    RETURN QUERY SELECT
      'STALE_OWNER'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_request.state::TEXT,
      v_attempt.state::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_attempt.state <> 'SENDING'
     OR v_request.state <> 'SENDING'
     OR v_token.password_reset_token_id IS NULL
     OR v_token.account_id <> v_account_id
     OR v_token.consumed_at IS NOT NULL
     OR v_token.invalidated_at IS NOT NULL THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_request.state::TEXT,
      v_attempt.state::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_external_result = 'ACCEPTED' THEN
    INSERT INTO public.audit_event (
      id, occurred_at, actor_account_id, origin, scope, operation, result,
      entity_type, entity_id, before_data, after_data, context,
      correlation_id, operation_id, sequence
    ) VALUES (
      p_audit_event_id, v_now, NULL, 'INTERNAL_PROCESSOR', 'SECURITY',
      'AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED', 'SUCCESS', 'ACCOUNT',
      v_account_id, NULL, NULL, NULL, v_request.recovery_request_id,
      p_delivery_attempt_id, 1
    );

    UPDATE public.password_recovery_delivery_attempt AS attempt
    SET state = 'SENT', lease_id = NULL, lease_expires_at = NULL,
        accepted_at = v_now, terminal_at = v_now
    WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

    UPDATE public.password_recovery_request AS request
    SET state = 'SENT', updated_at = v_now, terminal_at = v_now
    WHERE request.recovery_request_id = v_request.recovery_request_id;

    RETURN QUERY SELECT
      'SENT'::TEXT, v_request.recovery_request_id, p_delivery_attempt_id,
      'SENT'::TEXT, 'SENT'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_external_result = 'NOT_ACCEPTED' THEN
    UPDATE public.password_reset_token AS token
    SET invalidated_at = v_now,
        invalidated_operation_id = p_delivery_attempt_id
    WHERE token.password_reset_token_id = v_token.password_reset_token_id
      AND token.consumed_at IS NULL
      AND token.invalidated_at IS NULL;

    UPDATE public.password_recovery_delivery_attempt AS attempt
    SET state = 'FAILED', lease_id = NULL, lease_expires_at = NULL,
        terminal_at = v_now, failure_class = 'DELIVERY_FAILURE'
    WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

    IF v_attempt.attempt_number < 3 THEN
      v_next_eligible_at := v_now + CASE v_attempt.attempt_number
        WHEN 1 THEN INTERVAL '1 minute'
        WHEN 2 THEN INTERVAL '5 minutes'
      END;
      UPDATE public.password_recovery_request AS request
      SET state = 'PENDING', updated_at = v_now, terminal_at = NULL
      WHERE request.recovery_request_id = v_request.recovery_request_id;
    ELSE
      UPDATE public.password_recovery_request AS request
      SET state = 'FAILED', updated_at = v_now, terminal_at = v_now
      WHERE request.recovery_request_id = v_request.recovery_request_id;
    END IF;

    RETURN QUERY SELECT
      'FAILED'::TEXT, v_request.recovery_request_id, p_delivery_attempt_id,
      CASE WHEN v_attempt.attempt_number < 3 THEN 'PENDING' ELSE 'FAILED' END::TEXT,
      'FAILED'::TEXT, v_next_eligible_at;
    RETURN;
  END IF;

  UPDATE public.password_recovery_delivery_attempt AS attempt
  SET state = 'UNKNOWN', lease_id = NULL, lease_expires_at = NULL,
      terminal_at = v_now
  WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;

  UPDATE public.password_recovery_request AS request
  SET state = 'UNKNOWN', updated_at = v_now, terminal_at = v_now
  WHERE request.recovery_request_id = v_request.recovery_request_id;

  RETURN QUERY SELECT
    'UNKNOWN'::TEXT, v_request.recovery_request_id, p_delivery_attempt_id,
    'UNKNOWN'::TEXT, 'UNKNOWN'::TEXT, NULL::TIMESTAMPTZ;
END
$function$;

CREATE FUNCTION public.reconcile_password_recovery_delivery(
  p_recovery_request_id UUID,
  p_delivery_attempt_id UUID,
  p_lease_id UUID,
  p_password_reset_token_id UUID
)
RETURNS TABLE (
  outcome TEXT,
  recovery_request_id UUID,
  delivery_attempt_id UUID,
  request_state TEXT,
  attempt_state TEXT,
  observed_lease_id UUID,
  password_reset_token_id UUID,
  token_expires_at TIMESTAMPTZ,
  attempt_number SMALLINT,
  failure_class TEXT,
  attempt_terminal_at TIMESTAMPTZ,
  token_consumed_at TIMESTAMPTZ,
  token_invalidated_at TIMESTAMPTZ,
  token_invalidated_operation_id UUID,
  accepted_audit_confirmed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_request public.password_recovery_request%ROWTYPE;
  v_attempt public.password_recovery_delivery_attempt%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_audit_confirmed BOOLEAN := FALSE;
  v_coherent BOOLEAN := FALSE;
BEGIN
  IF (p_recovery_request_id IS NULL AND p_delivery_attempt_id IS NULL)
     OR (p_recovery_request_id IS NOT NULL AND
       (pg_catalog.uuid_extract_version(p_recovery_request_id) = 4) IS NOT TRUE)
     OR (p_delivery_attempt_id IS NOT NULL AND
       (pg_catalog.uuid_extract_version(p_delivery_attempt_id) = 4) IS NOT TRUE)
     OR (p_lease_id IS NOT NULL AND
       (pg_catalog.uuid_extract_version(p_lease_id) = 4) IS NOT TRUE)
     OR (p_password_reset_token_id IS NOT NULL AND
       (pg_catalog.uuid_extract_version(p_password_reset_token_id) = 4) IS NOT TRUE) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'BF_PASSWORD_RECOVERY_RECONCILIATION_INVALID_ARGUMENTS',
      ERRCODE = '22023';
  END IF;

  IF p_delivery_attempt_id IS NOT NULL THEN
    SELECT attempt.* INTO v_attempt
    FROM public.password_recovery_delivery_attempt AS attempt
    WHERE attempt.delivery_attempt_id = p_delivery_attempt_id;
  ELSE
    SELECT attempt.* INTO v_attempt
    FROM public.password_recovery_delivery_attempt AS attempt
    WHERE attempt.recovery_request_id = p_recovery_request_id
    ORDER BY attempt.attempt_number DESC
    LIMIT 1;
  END IF;

  SELECT request.* INTO v_request
  FROM public.password_recovery_request AS request
  WHERE request.recovery_request_id = COALESCE(
    p_recovery_request_id, v_attempt.recovery_request_id
  );

  IF v_request.recovery_request_id IS NULL THEN
    RETURN QUERY SELECT
      'NOT_FOUND'::TEXT, p_recovery_request_id, p_delivery_attempt_id,
      NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TIMESTAMPTZ,
      NULL::SMALLINT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ, NULL::UUID, FALSE;
    RETURN;
  END IF;

  IF p_delivery_attempt_id IS NOT NULL
     AND (
       v_attempt.delivery_attempt_id IS NULL
       OR v_attempt.recovery_request_id <> v_request.recovery_request_id
     ) THEN
    RETURN QUERY SELECT
      'NOT_FOUND'::TEXT, v_request.recovery_request_id, p_delivery_attempt_id,
      v_request.state::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID,
      NULL::TIMESTAMPTZ, NULL::SMALLINT, NULL::TEXT, NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::UUID, FALSE;
    RETURN;
  END IF;

  IF v_attempt.delivery_attempt_id IS NOT NULL THEN
    SELECT token.* INTO v_token
    FROM public.password_reset_token AS token
    WHERE token.delivery_attempt_id = v_attempt.delivery_attempt_id;
  END IF;

  IF v_attempt.delivery_attempt_id IS NOT NULL
     AND v_attempt.state = 'SENT' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.audit_event AS event
      WHERE event.actor_account_id IS NULL
        AND event.origin = 'INTERNAL_PROCESSOR'
        AND event.scope = 'SECURITY'
        AND event.operation = 'AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED'
        AND event.result = 'SUCCESS'
        AND event.entity_type = 'ACCOUNT'
        AND event.entity_id = v_request.account_id
        AND event.operation_id = v_attempt.delivery_attempt_id
        AND event.correlation_id = v_request.recovery_request_id
        AND event.sequence = 1
        AND event.before_data IS NULL
        AND event.after_data IS NULL
        AND event.context IS NULL
    ) INTO v_audit_confirmed;
  END IF;

  v_coherent := CASE v_request.state
    WHEN 'PREPARING' THEN
      v_attempt.state = 'PREPARING'
      AND v_attempt.attempt_number = v_request.current_attempt_number
      AND v_attempt.lease_id IS NOT NULL
      AND (p_lease_id IS NULL OR v_attempt.lease_id = p_lease_id)
      AND v_attempt.terminal_at IS NULL
      AND v_token.password_reset_token_id IS NULL
    WHEN 'PREPARED' THEN
      v_attempt.state = 'PREPARED'
      AND v_attempt.attempt_number = v_request.current_attempt_number
      AND v_attempt.lease_id IS NOT NULL
      AND (p_lease_id IS NULL OR v_attempt.lease_id = p_lease_id)
      AND v_attempt.terminal_at IS NULL
      AND v_token.password_reset_token_id IS NOT NULL
      AND v_token.account_id = v_request.account_id
      AND v_token.consumed_at IS NULL
      AND v_token.invalidated_at IS NULL
    WHEN 'SENDING' THEN
      v_attempt.state = 'SENDING'
      AND v_attempt.attempt_number = v_request.current_attempt_number
      AND v_attempt.lease_id IS NOT NULL
      AND (p_lease_id IS NULL OR v_attempt.lease_id = p_lease_id)
      AND v_attempt.sending_confirmed_at IS NOT NULL
      AND v_attempt.terminal_at IS NULL
      AND v_token.password_reset_token_id IS NOT NULL
      AND v_token.account_id = v_request.account_id
      AND v_token.consumed_at IS NULL
      AND v_token.invalidated_at IS NULL
    WHEN 'SENT' THEN
      v_attempt.state = 'SENT'
      AND v_attempt.attempt_number = v_request.current_attempt_number
      AND v_attempt.lease_id IS NULL
      AND v_attempt.lease_expires_at IS NULL
      AND v_attempt.sending_confirmed_at IS NOT NULL
      AND v_attempt.accepted_at IS NOT NULL
      AND v_attempt.terminal_at IS NOT NULL
      AND v_request.terminal_at IS NOT NULL
      AND v_token.password_reset_token_id IS NOT NULL
      AND v_token.account_id = v_request.account_id
      AND v_audit_confirmed
    WHEN 'PENDING' THEN
      v_request.current_attempt_number BETWEEN 1 AND 2
      AND v_attempt.state = 'FAILED'
      AND v_attempt.attempt_number = v_request.current_attempt_number
      AND v_attempt.lease_id IS NULL
      AND v_attempt.lease_expires_at IS NULL
      AND v_attempt.failure_class IN ('PREPARATION_FAILURE', 'DELIVERY_FAILURE')
      AND v_attempt.terminal_at IS NOT NULL
      AND v_request.terminal_at IS NULL
      AND v_token.password_reset_token_id IS NOT NULL
      AND v_token.account_id = v_request.account_id
      AND v_token.consumed_at IS NULL
      AND v_token.invalidated_at IS NOT NULL
      AND v_token.invalidated_operation_id = v_attempt.delivery_attempt_id
    WHEN 'FAILED' THEN
      v_request.current_attempt_number = 3
      AND v_attempt.state = 'FAILED'
      AND v_attempt.attempt_number = 3
      AND v_attempt.lease_id IS NULL
      AND v_attempt.lease_expires_at IS NULL
      AND v_attempt.failure_class IN ('PREPARATION_FAILURE', 'DELIVERY_FAILURE')
      AND v_attempt.terminal_at IS NOT NULL
      AND v_request.terminal_at IS NOT NULL
      AND v_token.password_reset_token_id IS NOT NULL
      AND v_token.account_id = v_request.account_id
      AND v_token.consumed_at IS NULL
      AND v_token.invalidated_at IS NOT NULL
      AND v_token.invalidated_operation_id = v_attempt.delivery_attempt_id
    WHEN 'UNKNOWN' THEN
      v_attempt.state = 'UNKNOWN'
      AND v_attempt.attempt_number = v_request.current_attempt_number
      AND v_attempt.lease_id IS NULL
      AND v_attempt.lease_expires_at IS NULL
      AND v_attempt.sending_confirmed_at IS NOT NULL
      AND v_attempt.terminal_at IS NOT NULL
      AND v_request.terminal_at IS NOT NULL
      AND v_token.password_reset_token_id IS NOT NULL
      AND v_token.account_id = v_request.account_id
      AND v_token.invalidated_operation_id IS DISTINCT FROM v_attempt.delivery_attempt_id
    WHEN 'CANCELLED' THEN
      v_attempt.state = 'CANCELLED'
      AND v_attempt.attempt_number = v_request.current_attempt_number
      AND v_attempt.lease_id IS NULL
      AND v_attempt.lease_expires_at IS NULL
      AND v_attempt.terminal_at IS NOT NULL
      AND v_request.terminal_at IS NOT NULL
      AND v_attempt.cancelled_operation_id = v_request.cancelled_operation_id
    ELSE FALSE
  END;

  IF (p_password_reset_token_id IS NOT NULL
       AND v_attempt.state <> 'PREPARING'
       AND v_token.password_reset_token_id IS DISTINCT FROM p_password_reset_token_id)
     OR NOT COALESCE(v_coherent, FALSE) THEN
    RETURN QUERY SELECT
      'INCONSISTENT'::TEXT, v_request.recovery_request_id,
      v_attempt.delivery_attempt_id, v_request.state::TEXT,
      v_attempt.state::TEXT, v_attempt.lease_id,
      v_token.password_reset_token_id, v_token.expires_at,
      v_attempt.attempt_number, v_attempt.failure_class::TEXT,
      v_attempt.terminal_at, v_token.consumed_at, v_token.invalidated_at,
      v_token.invalidated_operation_id, v_audit_confirmed;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'OBSERVED'::TEXT, v_request.recovery_request_id,
    v_attempt.delivery_attempt_id, v_request.state::TEXT,
    v_attempt.state::TEXT, v_attempt.lease_id,
    v_token.password_reset_token_id, v_token.expires_at,
    v_attempt.attempt_number, v_attempt.failure_class::TEXT,
    v_attempt.terminal_at, v_token.consumed_at, v_token.invalidated_at,
    v_token.invalidated_operation_id, v_audit_confirmed;
END
$function$;

REVOKE ALL ON FUNCTION public.claim_password_recovery_delivery(UUID, UUID)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.prepare_password_recovery_delivery(
  UUID, UUID, UUID, BYTEA, TIMESTAMPTZ
) FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.confirm_password_recovery_sending(UUID, UUID)
  FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.complete_password_recovery_delivery(
  UUID, UUID, TEXT, UUID
) FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.reconcile_password_recovery_delivery(
  UUID, UUID, UUID, UUID
) FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.claim_password_recovery_delivery(UUID, UUID)
  TO bello_runtime;
GRANT EXECUTE ON FUNCTION public.prepare_password_recovery_delivery(
  UUID, UUID, UUID, BYTEA, TIMESTAMPTZ
) TO bello_runtime;
GRANT EXECUTE ON FUNCTION public.confirm_password_recovery_sending(UUID, UUID)
  TO bello_runtime;
GRANT EXECUTE ON FUNCTION public.complete_password_recovery_delivery(
  UUID, UUID, TEXT, UUID
) TO bello_runtime;
GRANT EXECUTE ON FUNCTION public.reconcile_password_recovery_delivery(
  UUID, UUID, UUID, UUID
) TO bello_runtime;

COMMIT;
