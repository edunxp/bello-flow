BEGIN;
ALTER TABLE public.board_card
  ADD COLUMN start_date DATE,
  ADD COLUMN due_date DATE,
  ADD COLUMN completed_at TIMESTAMPTZ(6),
  ADD COLUMN completed_by_id UUID,
  ADD CONSTRAINT board_card_completed_by_id_fkey FOREIGN KEY (completed_by_id)
    REFERENCES public.account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT board_card_completion_check CHECK ((completed_at IS NULL) = (completed_by_id IS NULL)),
  ADD CONSTRAINT board_card_date_order_check CHECK (start_date <= due_date);
GRANT UPDATE (start_date, due_date, completed_at, completed_by_id) ON public.board_card TO bello_runtime;
COMMIT;
