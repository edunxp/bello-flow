BEGIN;
ALTER TABLE public.board
  ADD COLUMN order_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.board_list
  ADD COLUMN position BIGINT,
  ADD COLUMN position_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN card_order_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.board_card
  ADD COLUMN position BIGINT,
  ADD COLUMN position_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.board_feed_event ADD COLUMN request_hash CHAR(64);

WITH positions AS (
  SELECT id, row_number() OVER (PARTITION BY board_id ORDER BY created_at, id) * 4294967296 AS position
  FROM public.board_list
)
UPDATE public.board_list item SET position = positions.position
FROM positions WHERE item.id = positions.id;

WITH positions AS (
  SELECT id, row_number() OVER (PARTITION BY list_id ORDER BY created_at, id) * 4294967296 AS position
  FROM public.board_card
)
UPDATE public.board_card item SET position = positions.position
FROM positions WHERE item.id = positions.id;

ALTER TABLE public.board_list ALTER COLUMN position SET NOT NULL,
  ADD CONSTRAINT board_list_position_check CHECK (position BETWEEN 1 AND 9000000000000000000),
  ADD CONSTRAINT board_list_board_id_position_key UNIQUE (board_id, position) DEFERRABLE;
ALTER TABLE public.board_card ALTER COLUMN position SET NOT NULL,
  ADD CONSTRAINT board_card_position_check CHECK (position BETWEEN 1 AND 9000000000000000000),
  ADD CONSTRAINT board_card_list_id_position_key UNIQUE (list_id, position) DEFERRABLE;

GRANT UPDATE (order_revision, sync_revision) ON public.board TO bello_runtime;
GRANT UPDATE (position, position_revision, card_order_revision) ON public.board_list TO bello_runtime;
GRANT UPDATE (list_id, position, position_revision) ON public.board_card TO bello_runtime;
COMMIT;
