-- CreateTable
CREATE TABLE "access_notification" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "board_id" UUID,
    "granted_role" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "access_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_notification_delivery" (
    "notification_id" UUID NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "access_notification_delivery_pkey" PRIMARY KEY ("notification_id")
);

-- CreateIndex
CREATE INDEX "access_notification_recipient_id_created_at_id_idx" ON "access_notification"("recipient_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "access_notification_delivery_state_updated_at_notification__idx" ON "access_notification_delivery"("state", "updated_at", "notification_id");

-- AddForeignKey
ALTER TABLE "access_notification" ADD CONSTRAINT "access_notification_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "access_notification" ADD CONSTRAINT "access_notification_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "access_notification" ADD CONSTRAINT "access_notification_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "access_notification" ADD CONSTRAINT "access_notification_workspace_id_board_id_fkey" FOREIGN KEY ("workspace_id", "board_id") REFERENCES "board"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "access_notification_delivery" ADD CONSTRAINT "access_notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "access_notification"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE public.access_notification
  ADD CONSTRAINT access_notification_role_check CHECK (
    granted_role IN ('ADMIN', 'MEMBER') OR (board_id IS NOT NULL AND granted_role = 'OBSERVER')
  );
ALTER TABLE public.access_notification_delivery
  ADD CONSTRAINT access_notification_delivery_state_check CHECK (
    (state = 'PENDING' AND attempt_count = 0) OR
    (state IN ('SENDING', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED') AND attempt_count = 1)
  );

GRANT SELECT, INSERT ON public.access_notification, public.access_notification_delivery TO bello_runtime;
GRANT UPDATE (state, attempt_count, updated_at) ON public.access_notification_delivery TO bello_runtime;
