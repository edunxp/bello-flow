BEGIN;

CREATE FUNCTION public.query_audit_events(
  p_actor UUID,
  p_area TEXT,
  p_workspace UUID,
  p_board UUID,
  p_card UUID,
  p_from TIMESTAMPTZ,
  p_until TIMESTAMPTZ,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_operation TEXT,
  p_result TEXT,
  p_event_actor UUID,
  p_cursor_at TIMESTAMPTZ,
  p_cursor_id UUID,
  p_limit INTEGER,
  p_offset INTEGER
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $function$
DECLARE
  workspace_admin BOOLEAN;
  board_admin BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.account a
    WHERE a.id = p_actor AND a.status = 'ACTIVE'
      AND a.email_verified_at IS NOT NULL AND a.deactivated_at IS NULL
  ) THEN
    RETURN NEXT jsonb_build_object('denied', TRUE);
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.workspace_membership wm
    WHERE wm.workspace_id = p_workspace AND wm.account_id = p_actor
      AND wm.role = 'ADMIN'
  ) INTO workspace_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.board_membership bm
    WHERE bm.workspace_id = p_workspace AND bm.board_id = p_board
      AND bm.account_id = p_actor AND bm.role = 'ADMIN'
  ) INTO board_admin;

  IF (p_card IS NOT NULL AND p_area IS DISTINCT FROM 'CONTENT') OR NOT COALESCE(CASE p_area
    WHEN 'GLOBAL' THEN p_workspace IS NULL AND p_board IS NULL AND EXISTS (
      SELECT 1 FROM public.global_role_assignment gr
      WHERE gr.account_id = p_actor AND gr.role = 'GLOBAL_ADMIN'
    )
    WHEN 'GOVERNANCE' THEN p_workspace IS NOT NULL AND (workspace_admin OR board_admin)
      AND (p_board IS NULL OR EXISTS (
        SELECT 1 FROM public.board b WHERE b.workspace_id = p_workspace AND b.id = p_board
      ))
    WHEN 'CONTENT' THEN board_admin AND (p_card IS NULL OR EXISTS (
      SELECT 1 FROM public.board_card c JOIN public.board_list l ON l.id = c.list_id
      WHERE c.id = p_card AND l.board_id = p_board
    ))
    ELSE FALSE
  END, FALSE) THEN
    RETURN NEXT jsonb_build_object('denied', TRUE);
    RETURN;
  END IF;

  RETURN QUERY
  WITH classified AS (
    SELECT e.*,
      e.context ->> 'workspaceId' AS workspace_key,
      COALESCE(e.context ->> 'boardId',
        CASE WHEN e.entity_type = 'BOARD' THEN e.entity_id::TEXT END) AS board_key
    FROM public.audit_event e
    WHERE e.occurred_at >= statement_timestamp() - INTERVAL '24 months'
      AND (p_cursor_at IS NULL OR CASE
        WHEN p_card IS NULL THEN (e.occurred_at, e.id) < (p_cursor_at, p_cursor_id)
        ELSE e.occurred_at < p_cursor_at
      END)
  ), scoped AS (
    SELECT e.*, p_card IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.board_membership historical
      WHERE historical.workspace_id = p_workspace AND historical.board_id::TEXT = e.board_key
        AND historical.account_id = p_actor AND historical.role = 'ADMIN'
    ) AS restricted
    FROM classified e
    WHERE CASE p_area
      WHEN 'GLOBAL' THEN e.scope IN ('GLOBAL_ADMINISTRATION', 'SECURITY')
        AND e.workspace_key IS NULL AND e.board_key IS NULL
      WHEN 'GOVERNANCE' THEN e.workspace_key = p_workspace::TEXT
        AND (p_board IS NULL OR e.board_key = p_board::TEXT)
        AND (
          (e.scope IN ('WORKSPACE', 'BOARD') AND e.operation IN (
            'WORKSPACE_CREATED', 'WORKSPACE_UPDATED', 'WORKSPACE_ADMIN_GRANTED',
            'WORKSPACE_MEMBER_INCLUDED', 'WORKSPACE_MEMBER_REMOVED', 'WORKSPACE_MEMBER_ROLE_CHANGED',
            'WORKSPACE_LABEL_CREATED', 'WORKSPACE_LABEL_UPDATED', 'WORKSPACE_LABEL_DELETED',
            'BOARD_CREATED', 'BOARD_UPDATED', 'BOARD_ADMIN_GRANTED',
            'BOARD_MEMBER_INCLUDED', 'BOARD_MEMBER_REMOVED', 'BOARD_MEMBER_ROLE_CHANGED',
            'BOARD_ARCHIVED', 'BOARD_RESTORED'
          ))
          OR (e.scope = 'SECURITY' AND e.result = 'DENIED')
        )
      WHEN 'CONTENT' THEN e.scope = 'BOARD' AND e.workspace_key = p_workspace::TEXT
        AND CASE WHEN p_card IS NULL
          THEN e.board_key = p_board::TEXT AND e.entity_type IN ('LIST', 'CARD', 'COMMENT')
          ELSE (e.entity_type = 'CARD' AND e.entity_id = p_card)
            OR (e.entity_type = 'COMMENT' AND e.context ->> 'cardId' = p_card::TEXT)
        END
      ELSE FALSE
    END
  ), visible AS (
    SELECT e.* FROM scoped e
    WHERE (p_from IS NULL OR e.occurred_at >= p_from)
      AND (p_until IS NULL OR e.occurred_at < p_until)
      AND (e.restricted OR (
        (p_entity_type IS NULL OR e.entity_type = p_entity_type)
        AND (p_entity_id IS NULL OR e.entity_id = p_entity_id)
        AND (p_operation IS NULL OR e.operation = p_operation)
        AND (p_result IS NULL OR e.result = p_result)
        AND (p_event_actor IS NULL OR e.actor_account_id = p_event_actor)
      ))
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 101)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT CASE WHEN e.restricted
    THEN jsonb_build_object('restricted', TRUE, 'occurredAt', e.occurred_at)
    ELSE jsonb_build_object(
    'id', e.id, 'occurredAt', e.occurred_at, 'actorAccountId', e.actor_account_id,
    'origin', e.origin, 'operation', e.operation, 'result', e.result,
    'entityType', e.entity_type, 'entityId', e.entity_id, 'correlationId', e.correlation_id,
    'context', jsonb_strip_nulls(jsonb_build_object(
      'workspaceId', e.workspace_key, 'boardId', e.board_key,
      'listId', CASE WHEN p_area = 'CONTENT' THEN e.context ->> 'listId' END,
      'cardId', CASE WHEN p_area = 'CONTENT' THEN e.context ->> 'cardId' END,
      'counterpartBoardId', CASE WHEN access.counterpart_visible THEN e.context ->> 'counterpartBoardId' END
    )),
    'beforeData', CASE WHEN e.operation = 'CARD_RECEIVED' AND NOT access.counterpart_visible THEN NULL ELSE (
      SELECT jsonb_object_agg(k, e.before_data -> k)
      FROM unnest(fields.allowed) AS keys(k) WHERE e.before_data ? k
    ) END,
    'afterData', CASE
      WHEN e.operation = 'CARD_TRANSFERRED' AND NOT access.counterpart_visible THEN NULL
      ELSE (
      SELECT jsonb_object_agg(k, e.after_data -> k)
      FROM unnest(fields.allowed) AS keys(k) WHERE e.after_data ? k
      ) END
  ) END
  FROM visible e
  CROSS JOIN LATERAL (SELECT p_area = 'CONTENT' AND EXISTS (
    SELECT 1 FROM public.board_membership counterpart
    WHERE counterpart.workspace_id = p_workspace
      AND counterpart.board_id::TEXT = e.context ->> 'counterpartBoardId'
      AND counterpart.account_id = p_actor AND counterpart.role = 'ADMIN'
  ) AS counterpart_visible) access
  CROSS JOIN LATERAL (SELECT CASE
    WHEN e.scope = 'SECURITY' THEN ARRAY[]::TEXT[]
    WHEN e.operation IN ('ACCOUNT_CREATED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED')
      THEN ARRAY['status', 'email_verified']
    WHEN e.operation IN ('GLOBAL_ADMIN_GRANTED', 'GLOBAL_ADMIN_REVOKED',
      'WORKSPACE_ADMIN_GRANTED', 'WORKSPACE_MEMBER_INCLUDED', 'WORKSPACE_MEMBER_REMOVED',
      'WORKSPACE_MEMBER_ROLE_CHANGED', 'BOARD_ADMIN_GRANTED', 'BOARD_MEMBER_INCLUDED',
      'BOARD_MEMBER_REMOVED', 'BOARD_MEMBER_ROLE_CHANGED') THEN ARRAY['accountId', 'role']
    WHEN e.operation IN ('WORKSPACE_CREATED', 'WORKSPACE_UPDATED') THEN ARRAY['id', 'name', 'description', 'timeZone']
    WHEN e.operation IN ('BOARD_CREATED', 'BOARD_UPDATED') THEN ARRAY['id', 'name', 'description', 'visibility']
    WHEN e.operation IN ('BOARD_ARCHIVED', 'BOARD_RESTORED') THEN ARRAY['archived']
    WHEN e.entity_type = 'LABEL' AND e.operation IN (
      'WORKSPACE_LABEL_CREATED', 'WORKSPACE_LABEL_UPDATED', 'WORKSPACE_LABEL_DELETED'
    ) THEN ARRAY['id', 'name', 'color']
    WHEN p_area = 'CONTENT' AND e.entity_type = 'COMMENT' THEN CASE
      WHEN e.operation IN ('COMMENT_CREATED', 'COMMENT_EDITED') THEN ARRAY['authorId', 'content']
      WHEN e.operation = 'COMMENT_REMOVED' THEN ARRAY['authorId', 'content', 'removedById', 'removedAt']
      WHEN e.operation = 'COMMENT_MODERATED' THEN ARRAY['authorId', 'content', 'removedById', 'removedAt', 'justification']
      ELSE ARRAY[]::TEXT[]
    END
    WHEN p_area = 'CONTENT' AND e.entity_type = 'LIST' THEN CASE
      WHEN e.operation IN ('LIST_CREATED', 'LIST_RENAMED') THEN ARRAY['id', 'name']
      WHEN e.operation IN ('LIST_ARCHIVED', 'LIST_RESTORED') THEN ARRAY['archived']
      WHEN e.operation = 'LIST_REORDERED' THEN ARRAY['containerId', 'leftId', 'rightId']
      ELSE ARRAY[]::TEXT[]
    END
    WHEN p_area = 'CONTENT' AND e.entity_type = 'CARD' THEN CASE
      WHEN e.operation IN ('CARD_CREATED', 'CARD_EDITED') THEN ARRAY['id', 'title', 'description']
      WHEN e.operation = 'CARD_ARCHIVED' THEN ARRAY['archived']
      WHEN e.operation = 'CARD_RESTORED' THEN ARRAY['archived', 'listId', 'leftId', 'rightId']
      WHEN e.operation IN ('CARD_MOVED', 'CARD_TRANSFERRED', 'CARD_RECEIVED')
        THEN ARRAY['containerId', 'leftId', 'rightId']
      WHEN e.operation = 'CARD_DATES_CHANGED' THEN ARRAY['startDate', 'dueDate']
      WHEN e.operation IN ('CARD_COMPLETED', 'CARD_REOPENED') THEN ARRAY['completedAt', 'completedById']
      WHEN e.operation IN ('CARD_ASSIGNEE_ADDED', 'CARD_ASSIGNEE_REMOVED') THEN ARRAY['accountId']
      WHEN e.operation IN ('CARD_LABEL_ADDED', 'CARD_LABEL_REMOVED', 'CARD_LABEL_UPDATED') THEN ARRAY['labelId']
      ELSE ARRAY[]::TEXT[]
    END
    ELSE ARRAY[]::TEXT[]
  END AS allowed) fields
  ORDER BY e.occurred_at DESC, e.id DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.query_audit_events(
  UUID, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT,
  UUID, TIMESTAMPTZ, UUID, INTEGER, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.query_audit_events(
  UUID, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT,
  UUID, TIMESTAMPTZ, UUID, INTEGER, INTEGER
) TO bello_runtime;

COMMIT;
