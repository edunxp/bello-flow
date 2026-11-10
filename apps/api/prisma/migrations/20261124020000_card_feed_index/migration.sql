ALTER TABLE public.board_feed_event
  ADD COLUMN counterpart_board_id UUID,
  ADD COLUMN counterpart_list_id UUID;

CREATE INDEX board_feed_event_card_id_occurred_at_id_idx
  ON public.board_feed_event(card_id, occurred_at, id);
