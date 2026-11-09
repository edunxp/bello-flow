-- CreateTable
CREATE TABLE "workspace" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000),
    "time_zone" VARCHAR(100) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_membership" (
    "workspace_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,

    CONSTRAINT "workspace_membership_pkey" PRIMARY KEY ("workspace_id","account_id")
);

-- CreateTable
CREATE TABLE "board" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_membership" (
    "workspace_id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,

    CONSTRAINT "board_membership_pkey" PRIMARY KEY ("workspace_id","board_id","account_id")
);

-- CreateTable
CREATE TABLE "board_feed_event" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "operation" VARCHAR(60) NOT NULL,

    CONSTRAINT "board_feed_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_membership_account_id_workspace_id_idx" ON "workspace_membership"("account_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "board_workspace_id_id_key" ON "board"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "board_membership_workspace_id_account_id_idx" ON "board_membership"("workspace_id", "account_id");

-- CreateIndex
CREATE INDEX "board_feed_event_board_id_occurred_at_id_idx" ON "board_feed_event"("board_id", "occurred_at", "id");

-- AddForeignKey
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board" ADD CONSTRAINT "board_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board_membership" ADD CONSTRAINT "board_membership_workspace_id_board_id_fkey" FOREIGN KEY ("workspace_id", "board_id") REFERENCES "board"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board_membership" ADD CONSTRAINT "board_membership_workspace_id_account_id_fkey" FOREIGN KEY ("workspace_id", "account_id") REFERENCES "workspace_membership"("workspace_id", "account_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board_feed_event" ADD CONSTRAINT "board_feed_event_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE public.workspace_membership
  ADD CONSTRAINT workspace_membership_role_check CHECK (role IN ('ADMIN', 'MEMBER'));
ALTER TABLE public.board_membership
  ADD CONSTRAINT board_membership_role_check CHECK (role IN ('ADMIN', 'MEMBER', 'OBSERVER'));
ALTER TABLE public.board
  ADD CONSTRAINT board_visibility_check CHECK (visibility = 'PRIVATE');
GRANT SELECT, INSERT ON public.workspace, public.workspace_membership,
  public.board, public.board_membership, public.board_feed_event TO bello_runtime;
