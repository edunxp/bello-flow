ALTER TABLE public.board_list ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;

GRANT UPDATE (archived) ON public.board_list TO bello_runtime;
