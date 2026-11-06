BEGIN;

DO $prerequisites$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bello_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bello_bootstrap_executor')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bello_audit_maintenance') THEN
    RAISE EXCEPTION USING MESSAGE = 'Required Bello capability roles are not provisioned';
  END IF;
END
$prerequisites$;

CREATE FUNCTION public.find_abandoned_password_reset_operation()
RETURNS TABLE (outcome TEXT, reset_operation_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT 'CANDIDATE'::TEXT, operation.reset_operation_id
  FROM public.password_reset_operation AS operation
  JOIN public.password_reset_token AS token
    ON token.password_reset_token_id = operation.password_reset_token_id
   AND token.account_id = operation.account_id
  JOIN public.password_recovery_delivery_attempt AS attempt
    ON attempt.delivery_attempt_id = token.delivery_attempt_id
  JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
   AND request.account_id = operation.account_id
   AND request.current_attempt_number = attempt.attempt_number
  JOIN public.password_credential AS credential
    ON credential.account_id = operation.account_id
  WHERE operation.state = 'STARTED'
    AND operation.terminal_at IS NULL
    AND operation.started_at <= pg_catalog.transaction_timestamp()
    AND operation.updated_at <= pg_catalog.transaction_timestamp()
    AND token.expires_at <= pg_catalog.transaction_timestamp()
    AND token.consumed_at IS NULL AND token.consumed_operation_id IS NULL
    AND token.invalidated_at IS NULL AND token.invalidated_operation_id IS NULL
    AND request.state = 'SENT' AND request.terminal_at IS NOT NULL
    AND attempt.state = 'SENT' AND attempt.terminal_at IS NOT NULL
    AND attempt.accepted_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.audit_event AS event WHERE event.operation_id = operation.reset_operation_id)
    AND NOT EXISTS (SELECT 1 FROM public.password_credential AS affected WHERE affected.changed_operation_id = operation.reset_operation_id)
    AND NOT EXISTS (SELECT 1 FROM public.password_reset_token AS affected WHERE affected.consumed_operation_id = operation.reset_operation_id OR affected.invalidated_operation_id = operation.reset_operation_id)
    AND NOT EXISTS (SELECT 1 FROM public.password_recovery_request AS affected WHERE affected.cancelled_operation_id = operation.reset_operation_id)
    AND NOT EXISTS (SELECT 1 FROM public.password_recovery_delivery_attempt AS affected WHERE affected.cancelled_operation_id = operation.reset_operation_id)
    AND NOT EXISTS (SELECT 1 FROM public.auth_session AS affected WHERE affected.revoked_operation_id = operation.reset_operation_id)
  ORDER BY token.expires_at, operation.reset_operation_id
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT 'INCONSISTENT'::TEXT, operation.reset_operation_id
  FROM public.password_reset_operation AS operation
  LEFT JOIN public.password_reset_token AS token
    ON token.password_reset_token_id = operation.password_reset_token_id
  LEFT JOIN public.password_recovery_delivery_attempt AS attempt
    ON attempt.delivery_attempt_id = token.delivery_attempt_id
  LEFT JOIN public.password_recovery_request AS request
    ON request.recovery_request_id = attempt.recovery_request_id
  LEFT JOIN public.password_credential AS credential
    ON credential.account_id = operation.account_id
  WHERE operation.state = 'STARTED' AND (
    operation.terminal_at IS NOT NULL
    OR operation.started_at > pg_catalog.transaction_timestamp()
    OR operation.updated_at > pg_catalog.transaction_timestamp()
    OR token.password_reset_token_id IS NULL
    OR token.account_id IS DISTINCT FROM operation.account_id
    OR attempt.delivery_attempt_id IS NULL
    OR request.recovery_request_id IS NULL
    OR request.account_id IS DISTINCT FROM operation.account_id
    OR request.current_attempt_number IS DISTINCT FROM attempt.attempt_number
    OR request.state IS DISTINCT FROM 'SENT' OR request.terminal_at IS NULL
    OR attempt.state IS DISTINCT FROM 'SENT' OR attempt.terminal_at IS NULL OR attempt.accepted_at IS NULL
    OR credential.account_id IS NULL
    OR token.consumed_at IS NOT NULL OR token.consumed_operation_id IS NOT NULL
    OR token.invalidated_at IS NOT NULL OR token.invalidated_operation_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.audit_event AS event WHERE event.operation_id = operation.reset_operation_id)
    OR EXISTS (SELECT 1 FROM public.password_credential AS affected WHERE affected.changed_operation_id = operation.reset_operation_id)
    OR EXISTS (SELECT 1 FROM public.password_reset_token AS affected WHERE affected.consumed_operation_id = operation.reset_operation_id OR affected.invalidated_operation_id = operation.reset_operation_id)
    OR EXISTS (SELECT 1 FROM public.password_recovery_request AS affected WHERE affected.cancelled_operation_id = operation.reset_operation_id)
    OR EXISTS (SELECT 1 FROM public.password_recovery_delivery_attempt AS affected WHERE affected.cancelled_operation_id = operation.reset_operation_id)
    OR EXISTS (SELECT 1 FROM public.auth_session AS affected WHERE affected.revoked_operation_id = operation.reset_operation_id)
  )
  ORDER BY operation.updated_at, operation.reset_operation_id
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT 'NO_CANDIDATE'::TEXT, NULL::UUID;
END
$function$;

CREATE FUNCTION public.has_inconsistent_password_reset_operation()
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.password_reset_operation AS operation
    LEFT JOIN public.password_reset_token AS token ON token.password_reset_token_id = operation.password_reset_token_id
    LEFT JOIN public.password_recovery_delivery_attempt AS attempt ON attempt.delivery_attempt_id = token.delivery_attempt_id
    LEFT JOIN public.password_recovery_request AS request ON request.recovery_request_id = attempt.recovery_request_id
    LEFT JOIN public.password_credential AS credential ON credential.account_id = operation.account_id
    WHERE operation.state = 'STARTED' AND (
      operation.terminal_at IS NOT NULL
      OR operation.started_at > pg_catalog.transaction_timestamp()
      OR operation.updated_at > pg_catalog.transaction_timestamp()
      OR token.password_reset_token_id IS NULL
      OR token.account_id IS DISTINCT FROM operation.account_id
      OR request.account_id IS DISTINCT FROM operation.account_id
      OR request.current_attempt_number IS DISTINCT FROM attempt.attempt_number
      OR request.state IS DISTINCT FROM 'SENT' OR attempt.state IS DISTINCT FROM 'SENT'
      OR request.terminal_at IS NULL OR attempt.terminal_at IS NULL OR attempt.accepted_at IS NULL
      OR credential.account_id IS NULL
      OR token.consumed_at IS NOT NULL OR token.consumed_operation_id IS NOT NULL
      OR token.invalidated_at IS NOT NULL OR token.invalidated_operation_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.audit_event AS event WHERE event.operation_id = operation.reset_operation_id)
      OR EXISTS (SELECT 1 FROM public.password_credential AS affected WHERE affected.changed_operation_id = operation.reset_operation_id)
      OR EXISTS (SELECT 1 FROM public.password_reset_token AS affected WHERE affected.consumed_operation_id = operation.reset_operation_id OR affected.invalidated_operation_id = operation.reset_operation_id)
      OR EXISTS (SELECT 1 FROM public.password_recovery_request AS affected WHERE affected.cancelled_operation_id = operation.reset_operation_id)
      OR EXISTS (SELECT 1 FROM public.password_recovery_delivery_attempt AS affected WHERE affected.cancelled_operation_id = operation.reset_operation_id)
      OR EXISTS (SELECT 1 FROM public.auth_session AS affected WHERE affected.revoked_operation_id = operation.reset_operation_id)
    )
    LIMIT 1
  )
$function$;

CREATE FUNCTION public.terminalize_abandoned_password_reset_operation(p_reset_operation_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_account_id UUID;
  v_operation public.password_reset_operation%ROWTYPE;
  v_token public.password_reset_token%ROWTYPE;
  v_attempt public.password_recovery_delivery_attempt%ROWTYPE;
  v_request public.password_recovery_request%ROWTYPE;
  v_credential public.password_credential%ROWTYPE;
  v_effects BIGINT;
  v_now TIMESTAMPTZ(6);
  v_updated INTEGER;
  v_reconciled TEXT;
  v_partition_attempt SMALLINT := 0;
BEGIN
  IF p_reset_operation_id IS NULL
     OR (pg_catalog.uuid_extract_version(p_reset_operation_id) = 4) IS NOT TRUE THEN
    RAISE EXCEPTION USING MESSAGE = 'BF_PASSWORD_RESET_TERMINALIZER_INVALID_ARGUMENT', ERRCODE = '22023';
  END IF;
  SELECT operation.account_id INTO v_account_id FROM public.password_reset_operation AS operation WHERE operation.reset_operation_id = p_reset_operation_id;
  IF v_account_id IS NULL THEN RETURN 'NOT_OBSERVED'; END IF;
  PERFORM public.acquire_auth_account_advisory_xact_lock(v_account_id);
  PERFORM account.id FROM public.account AS account WHERE account.id = v_account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'INCONSISTENT'; END IF;
  SELECT credential.* INTO v_credential FROM public.password_credential AS credential WHERE credential.account_id = v_account_id FOR UPDATE;
  PERFORM operation.reset_operation_id FROM public.password_reset_operation AS operation WHERE operation.account_id = v_account_id ORDER BY operation.reset_operation_id FOR UPDATE;
  SELECT operation.* INTO v_operation FROM public.password_reset_operation AS operation WHERE operation.reset_operation_id = p_reset_operation_id;
  IF v_operation.reset_operation_id IS NULL THEN RETURN 'NOT_OBSERVED'; END IF;
  IF v_operation.account_id <> v_account_id THEN RETURN 'INCONSISTENT'; END IF;
  PERFORM request.recovery_request_id FROM public.password_recovery_request AS request WHERE request.account_id = v_account_id ORDER BY request.recovery_request_id FOR UPDATE;
  PERFORM attempt.delivery_attempt_id FROM public.password_recovery_delivery_attempt AS attempt JOIN public.password_recovery_request AS request ON request.recovery_request_id = attempt.recovery_request_id WHERE request.account_id = v_account_id ORDER BY attempt.delivery_attempt_id FOR UPDATE OF attempt;
  PERFORM token.password_reset_token_id FROM public.password_reset_token AS token WHERE token.account_id = v_account_id ORDER BY token.password_reset_token_id FOR UPDATE;
  SELECT token.* INTO v_token FROM public.password_reset_token AS token WHERE token.password_reset_token_id = v_operation.password_reset_token_id;
  SELECT attempt.* INTO v_attempt FROM public.password_recovery_delivery_attempt AS attempt WHERE attempt.delivery_attempt_id = v_token.delivery_attempt_id;
  SELECT request.* INTO v_request FROM public.password_recovery_request AS request WHERE request.recovery_request_id = v_attempt.recovery_request_id;
  PERFORM session.id FROM public.auth_session AS session WHERE session.account_id = v_account_id ORDER BY session.id FOR UPDATE;
  PERFORM event.id FROM public.audit_event AS event WHERE event.operation_id IN (SELECT marker.reset_operation_id FROM public.password_reset_operation AS marker WHERE marker.account_id = v_account_id) ORDER BY event.id FOR UPDATE;

  <<partition>>
  LOOP
  v_partition_attempt := v_partition_attempt + 1;
  SELECT credential.* INTO v_credential FROM public.password_credential AS credential WHERE credential.account_id = v_account_id;
  SELECT operation.* INTO v_operation FROM public.password_reset_operation AS operation WHERE operation.reset_operation_id = p_reset_operation_id;
  IF v_operation.reset_operation_id IS NULL THEN RETURN 'NOT_OBSERVED'; END IF;
  IF v_operation.account_id <> v_account_id THEN RETURN 'INCONSISTENT'; END IF;
  SELECT token.* INTO v_token FROM public.password_reset_token AS token WHERE token.password_reset_token_id = v_operation.password_reset_token_id;
  SELECT attempt.* INTO v_attempt FROM public.password_recovery_delivery_attempt AS attempt WHERE attempt.delivery_attempt_id = v_token.delivery_attempt_id;
  SELECT request.* INTO v_request FROM public.password_recovery_request AS request WHERE request.recovery_request_id = v_attempt.recovery_request_id;

  IF v_operation.state IN ('COMPLETED', 'REJECTED') THEN
    v_reconciled := public.reconcile_password_reset_operation(p_reset_operation_id);
    IF (v_operation.state = 'COMPLETED' AND v_reconciled = 'COMPLETED') OR (v_operation.state = 'REJECTED' AND v_reconciled = 'REJECTED') THEN RETURN 'ALREADY_TERMINAL'; END IF;
    RETURN 'INCONSISTENT';
  END IF;
  IF v_operation.state = 'INCONSISTENT' THEN RETURN 'INCONSISTENT'; END IF;
  IF v_operation.state NOT IN ('STARTED', 'UNKNOWN', 'NOT_FOUND') THEN RETURN 'INCONSISTENT'; END IF;
  IF (v_operation.state IN ('STARTED', 'UNKNOWN') AND v_operation.terminal_at IS NOT NULL)
     OR (v_operation.state = 'NOT_FOUND' AND v_operation.terminal_at IS NULL) THEN RETURN 'INCONSISTENT'; END IF;

  SELECT
    (SELECT pg_catalog.count(*) FROM public.audit_event AS event WHERE event.operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.password_credential AS affected WHERE affected.changed_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.password_reset_token AS affected WHERE affected.consumed_operation_id = p_reset_operation_id OR affected.invalidated_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.password_recovery_request AS affected WHERE affected.cancelled_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.password_recovery_delivery_attempt AS affected WHERE affected.cancelled_operation_id = p_reset_operation_id)
    + (SELECT pg_catalog.count(*) FROM public.auth_session AS affected WHERE affected.revoked_operation_id = p_reset_operation_id)
  INTO v_effects;
  IF v_token.password_reset_token_id IS NULL OR v_token.account_id <> v_account_id
     OR v_attempt.delivery_attempt_id IS NULL OR v_request.recovery_request_id IS NULL
     OR v_request.account_id <> v_account_id OR v_request.current_attempt_number <> v_attempt.attempt_number
     OR v_request.state <> 'SENT' OR v_request.terminal_at IS NULL
     OR v_attempt.state <> 'SENT' OR v_attempt.terminal_at IS NULL OR v_attempt.accepted_at IS NULL
     OR v_credential.account_id IS NULL
     OR v_token.consumed_at IS NOT NULL OR v_token.consumed_operation_id IS NOT NULL
     OR v_token.invalidated_at IS NOT NULL OR v_token.invalidated_operation_id IS NOT NULL
     OR v_effects <> 0 OR v_operation.started_at > pg_catalog.transaction_timestamp()
     OR v_operation.updated_at > pg_catalog.transaction_timestamp() THEN RETURN 'INCONSISTENT'; END IF;
  IF v_operation.state = 'UNKNOWN' THEN RETURN 'NOT_ELIGIBLE'; END IF;
  IF v_operation.state = 'NOT_FOUND' THEN RETURN 'ALREADY_TERMINAL'; END IF;
  IF v_token.expires_at > pg_catalog.transaction_timestamp() THEN RETURN 'NOT_ELIGIBLE'; END IF;
  v_now := pg_catalog.transaction_timestamp();
  UPDATE public.password_reset_operation SET state = 'NOT_FOUND', updated_at = v_now, terminal_at = v_now WHERE reset_operation_id = p_reset_operation_id AND state = 'STARTED' AND terminal_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN RETURN 'TERMINALIZED'; END IF;
  IF v_partition_attempt < 2 THEN CONTINUE partition; END IF;
  RETURN 'INCONSISTENT';
  END LOOP partition;
END
$function$;

REVOKE ALL ON FUNCTION public.find_abandoned_password_reset_operation() FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.has_inconsistent_password_reset_operation() FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
REVOKE ALL ON FUNCTION public.terminalize_abandoned_password_reset_operation(UUID) FROM PUBLIC, bello_runtime, bello_bootstrap_executor, bello_audit_maintenance;
GRANT EXECUTE ON FUNCTION public.find_abandoned_password_reset_operation() TO bello_runtime;
GRANT EXECUTE ON FUNCTION public.has_inconsistent_password_reset_operation() TO bello_runtime;
GRANT EXECUTE ON FUNCTION public.terminalize_abandoned_password_reset_operation(UUID) TO bello_runtime;

COMMIT;
