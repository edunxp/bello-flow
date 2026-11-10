BEGIN;
CREATE TABLE public.card_comment (
  id UUID PRIMARY KEY,
  card_id UUID NOT NULL,
  author_id UUID NOT NULL,
  content VARCHAR(10000),
  created_at TIMESTAMPTZ(6) NOT NULL,
  edited_at TIMESTAMPTZ(6),
  removed_at TIMESTAMPTZ(6),
  removed_by_id UUID,
  CONSTRAINT card_comment_card_id_fkey FOREIGN KEY (card_id)
    REFERENCES public.board_card(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT card_comment_author_id_fkey FOREIGN KEY (author_id)
    REFERENCES public.account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT card_comment_removed_by_id_fkey FOREIGN KEY (removed_by_id)
    REFERENCES public.account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT card_comment_state_check CHECK (
    (removed_at IS NULL AND removed_by_id IS NULL AND content IS NOT NULL AND char_length(btrim(content)) > 0)
    OR (removed_at IS NOT NULL AND removed_by_id IS NOT NULL AND content IS NULL)
  )
);
CREATE INDEX card_comment_card_id_created_at_id_idx ON public.card_comment(card_id, created_at, id);
ALTER TABLE public.board_feed_event ADD COLUMN comment_id UUID;
GRANT SELECT, INSERT, UPDATE (content, edited_at, removed_at, removed_by_id)
  ON public.card_comment TO bello_runtime;
COMMIT;
