BEGIN;

CREATE TABLE public.board_list (
    id UUID PRIMARY KEY,
    board_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    creation_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT board_list_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.board(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX board_list_board_id_created_at_id_idx ON public.board_list(board_id, created_at, id);

CREATE TABLE public.board_card (
    id UUID PRIMARY KEY,
    list_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(20000),
    creation_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT board_card_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.board_list(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX board_card_list_id_created_at_id_idx ON public.board_card(list_id, created_at, id);

ALTER TABLE public.board_feed_event ADD COLUMN list_id UUID, ADD COLUMN card_id UUID;

GRANT SELECT, INSERT ON public.board_list, public.board_card TO bello_runtime;
GRANT UPDATE (name) ON public.board_list TO bello_runtime;
GRANT UPDATE (title, description) ON public.board_card TO bello_runtime;

COMMIT;
