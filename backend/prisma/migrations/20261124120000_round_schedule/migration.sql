-- Scheduled opening of the next round (additive; existing rooms keep NULL = not scheduled)
ALTER TABLE "Room" ADD COLUMN "scheduled_open_at" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "scheduled_deadline" TIMESTAMP(3);

CREATE INDEX "Room_status_scheduled_open_at_idx" ON "Room"("status", "scheduled_open_at");
