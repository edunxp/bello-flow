BEGIN;
CREATE TABLE public.card_assignment (
  id UUID PRIMARY KEY,
  card_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  board_id UUID NOT NULL,
  account_id UUID NOT NULL,
  CONSTRAINT card_assignment_card_id_account_id_key UNIQUE (card_id, account_id),
  CONSTRAINT card_assignment_card_id_fkey FOREIGN KEY (card_id)
    REFERENCES public.board_card(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT card_assignment_workspace_id_board_id_account_id_fkey FOREIGN KEY (workspace_id, board_id, account_id)
    REFERENCES public.board_membership(workspace_id, board_id, account_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX card_assignment_workspace_id_board_id_account_id_idx
  ON public.card_assignment(workspace_id, board_id, account_id);
GRANT SELECT, INSERT, DELETE ON public.card_assignment TO bello_runtime;
COMMIT;
