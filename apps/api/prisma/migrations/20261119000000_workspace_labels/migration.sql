BEGIN;
CREATE TABLE public.workspace_label (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  name VARCHAR(50) NOT NULL CHECK (char_length(btrim(name)) > 0),
  color VARCHAR(7) CHECK (color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT workspace_label_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT workspace_label_workspace_id_fkey FOREIGN KEY (workspace_id)
    REFERENCES public.workspace(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX workspace_label_name_key
  ON public.workspace_label (workspace_id, (normalize(casefold(normalize(name) COLLATE pg_catalog.pg_unicode_fast))));
CREATE TABLE public.card_label (
  card_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  label_id UUID NOT NULL,
  CONSTRAINT card_label_pkey PRIMARY KEY (card_id, label_id),
  CONSTRAINT card_label_card_id_fkey FOREIGN KEY (card_id)
    REFERENCES public.board_card(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT card_label_workspace_id_label_id_fkey FOREIGN KEY (workspace_id, label_id)
    REFERENCES public.workspace_label(workspace_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX card_label_workspace_id_label_id_idx ON public.card_label(workspace_id, label_id);
ALTER TABLE public.board_feed_event ADD COLUMN label_id UUID;
GRANT SELECT, INSERT, DELETE, UPDATE (name, color) ON public.workspace_label TO bello_runtime;
GRANT SELECT, INSERT, DELETE ON public.card_label TO bello_runtime;
COMMIT;
