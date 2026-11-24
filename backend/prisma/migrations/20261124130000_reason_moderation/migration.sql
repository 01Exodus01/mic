-- Reasons hidden by the host for inappropriate content (additive)
CREATE TABLE "ReasonModeration" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "participant_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "side" "ReasonSide" NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReasonModeration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReasonModeration_room_id_round_participant_id_option_id_sid_key" ON "ReasonModeration"("room_id", "round", "participant_id", "option_id", "side", "text");
CREATE INDEX "ReasonModeration_room_id_round_idx" ON "ReasonModeration"("room_id", "round");

ALTER TABLE "ReasonModeration" ADD CONSTRAINT "ReasonModeration_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReasonModeration" ADD CONSTRAINT "ReasonModeration_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
