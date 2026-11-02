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

CREATE TABLE public.account (
  id UUID NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  email_key VARCHAR(254) NOT NULL,
  email_verified_at TIMESTAMPTZ(6),
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL,
  deactivated_at TIMESTAMPTZ(6),
  CONSTRAINT account_pkey PRIMARY KEY (id),
  CONSTRAINT account_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(id) = 4) IS TRUE
  ),
  CONSTRAINT account_first_name_check CHECK (
    first_name = pg_catalog.btrim(first_name, ' ')
    AND pg_catalog.char_length(first_name) BETWEEN 1 AND 100
    AND first_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT account_last_name_check CHECK (
    last_name = pg_catalog.btrim(last_name, ' ')
    AND pg_catalog.char_length(last_name) BETWEEN 1 AND 100
    AND last_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT account_email_consistency_check CHECK (
    email = pg_catalog.btrim(email, ' ')
    AND email_key = pg_catalog.translate(
      email,
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz'
    )
  ),
  CONSTRAINT account_email_format_check CHECK (
    pg_catalog.char_length(email) BETWEEN 3 AND 254
    AND pg_catalog.char_length(pg_catalog.split_part(email, '@', 1)) BETWEEN 1 AND 64
    AND email ~ $email_regex$^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$$email_regex$
  ),
  CONSTRAINT account_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE UNIQUE INDEX account_email_key_key ON public.account (email_key);

CREATE TABLE public.password_credential (
  account_id UUID NOT NULL,
  password_hash TEXT NOT NULL,
  changed_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT password_credential_pkey PRIMARY KEY (account_id),
  CONSTRAINT password_credential_password_hash_check CHECK (
    password_hash ~ $phc_regex$^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$$phc_regex$
  ),
  CONSTRAINT password_credential_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE public.global_role_assignment (
  account_id UUID NOT NULL,
  role VARCHAR(30) NOT NULL,
  granted_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT global_role_assignment_pkey PRIMARY KEY (account_id, role),
  CONSTRAINT global_role_assignment_role_check CHECK (role = 'GLOBAL_ADMIN'),
  CONSTRAINT global_role_assignment_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE public.bootstrap_state (
  singleton_id SMALLINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  initial_account_id UUID,
  operation_id UUID,
  completed_at TIMESTAMPTZ(6),
  CONSTRAINT bootstrap_state_pkey PRIMARY KEY (singleton_id),
  CONSTRAINT bootstrap_state_singleton_id_check CHECK (singleton_id = 1),
  CONSTRAINT bootstrap_state_status_check CHECK (status IN ('PENDING', 'COMPLETED')),
  CONSTRAINT bootstrap_state_operation_id_version_check CHECK (
    operation_id IS NULL
    OR (pg_catalog.uuid_extract_version(operation_id) = 4) IS TRUE
  ),
  CONSTRAINT bootstrap_state_completion_check CHECK (
    (
      status = 'PENDING'
      AND initial_account_id IS NULL
      AND operation_id IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      status = 'COMPLETED'
      AND initial_account_id IS NOT NULL
      AND operation_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT bootstrap_state_initial_account_id_fkey
    FOREIGN KEY (initial_account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX bootstrap_state_operation_id_key
  ON public.bootstrap_state (operation_id);

CREATE TABLE public.audit_event (
  id UUID NOT NULL,
  occurred_at TIMESTAMPTZ(6) NOT NULL,
  actor_account_id UUID,
  origin VARCHAR(40) NOT NULL,
  scope VARCHAR(40) NOT NULL,
  operation VARCHAR(60) NOT NULL,
  result VARCHAR(30) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  before_data JSONB,
  after_data JSONB,
  context JSONB,
  correlation_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  sequence INTEGER NOT NULL,
  CONSTRAINT audit_event_pkey PRIMARY KEY (id),
  CONSTRAINT audit_event_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(id) = 4) IS TRUE
  ),
  CONSTRAINT audit_event_entity_id_version_check CHECK (
    entity_id IS NULL
    OR (pg_catalog.uuid_extract_version(entity_id) = 4) IS TRUE
  ),
  CONSTRAINT audit_event_correlation_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(correlation_id) = 4) IS TRUE
  ),
  CONSTRAINT audit_event_operation_id_version_check CHECK (
    (pg_catalog.uuid_extract_version(operation_id) = 4) IS TRUE
  ),
  CONSTRAINT audit_event_sequence_check CHECK (sequence > 0),
  CONSTRAINT audit_event_origin_check CHECK (
    origin = pg_catalog.btrim(origin, ' ')
    AND pg_catalog.char_length(origin) > 0
    AND origin !~ '[[:cntrl:]]'
  ),
  CONSTRAINT audit_event_scope_check CHECK (
    scope = pg_catalog.btrim(scope, ' ')
    AND pg_catalog.char_length(scope) > 0
    AND scope !~ '[[:cntrl:]]'
  ),
  CONSTRAINT audit_event_operation_check CHECK (
    operation = pg_catalog.btrim(operation, ' ')
    AND pg_catalog.char_length(operation) > 0
    AND operation !~ '[[:cntrl:]]'
  ),
  CONSTRAINT audit_event_result_check CHECK (
    result = pg_catalog.btrim(result, ' ')
    AND pg_catalog.char_length(result) > 0
    AND result !~ '[[:cntrl:]]'
  ),
  CONSTRAINT audit_event_entity_type_check CHECK (
    entity_type = pg_catalog.btrim(entity_type, ' ')
    AND pg_catalog.char_length(entity_type) > 0
    AND entity_type !~ '[[:cntrl:]]'
  ),
  CONSTRAINT audit_event_actor_account_id_fkey
    FOREIGN KEY (actor_account_id) REFERENCES public.account(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX audit_event_operation_id_sequence_key
  ON public.audit_event (operation_id, sequence);
CREATE INDEX audit_event_occurred_at_id_idx
  ON public.audit_event (occurred_at DESC, id DESC);

INSERT INTO public.bootstrap_state (
  singleton_id,
  status,
  initial_account_id,
  operation_id,
  completed_at
) VALUES (1, 'PENDING', NULL, NULL, NULL);

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
    changed_at
  ) VALUES (
    p_account_id,
    p_password_hash,
    v_occurred_at
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

REVOKE ALL ON TABLE public.account FROM PUBLIC;
REVOKE ALL ON TABLE public.password_credential FROM PUBLIC;
REVOKE ALL ON TABLE public.global_role_assignment FROM PUBLIC;
REVOKE ALL ON TABLE public.bootstrap_state FROM PUBLIC;
REVOKE ALL ON TABLE public.audit_event FROM PUBLIC;

REVOKE ALL ON FUNCTION public.bootstrap_initial_admin(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, bello_runtime, bello_audit_maintenance;

GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO bello_bootstrap_executor;

GRANT SELECT (
  singleton_id,
  status,
  initial_account_id,
  operation_id,
  completed_at
) ON TABLE public.bootstrap_state TO bello_bootstrap_executor;

GRANT SELECT (id)
  ON TABLE public.account TO bello_bootstrap_executor;
GRANT SELECT (account_id, role)
  ON TABLE public.global_role_assignment TO bello_bootstrap_executor;
GRANT SELECT (id, result, entity_type, entity_id, operation_id, sequence)
  ON TABLE public.audit_event TO bello_bootstrap_executor;

COMMIT;
