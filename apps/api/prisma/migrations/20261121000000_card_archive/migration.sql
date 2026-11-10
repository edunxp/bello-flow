ALTER TABLE public.board_card ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;

GRANT UPDATE (archived) ON public.board_card TO bello_runtime;
