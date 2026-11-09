BEGIN;
ALTER TABLE public.board_feed_event ADD COLUMN subject_account_id UUID;
GRANT UPDATE (role), DELETE ON public.board_membership TO bello_runtime;
COMMIT;
