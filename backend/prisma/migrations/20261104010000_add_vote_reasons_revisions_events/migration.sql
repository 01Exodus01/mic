-- CreateEnum
CREATE TYPE "ReasonSide" AS ENUM ('FOR', 'AGAINST');

-- CreateEnum
CREATE TYPE "EventActor" AS ENUM ('HOST', 'PARTICIPANT', 'SYSTEM');

-- AlterTable
ALTER TABLE "Vote" ALTER COLUMN "justification" DROP NOT NULL;

-- CreateTable
CREATE TABLE "VoteReason" (
    "id" TEXT NOT NULL,
    "vote_id" TEXT NOT NULL,
    "side" "ReasonSide" NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteRevision" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomEvent" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "round" INTEGER,
    "type" VARCHAR(40) NOT NULL,
    "actor" "EventActor" NOT NULL,
    "participant_id" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoteReason_vote_id_idx" ON "VoteReason"("vote_id");

-- CreateIndex
CREATE UNIQUE INDEX "VoteReason_vote_id_side_order_index_key" ON "VoteReason"("vote_id", "side", "order_index");

-- CreateIndex
CREATE INDEX "VoteRevision_room_id_round_idx" ON "VoteRevision"("room_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "VoteRevision_participant_id_round_version_key" ON "VoteRevision"("participant_id", "round", "version");

-- CreateIndex
CREATE INDEX "RoomEvent_room_id_created_at_idx" ON "RoomEvent"("room_id", "created_at");

-- CreateIndex
CREATE INDEX "RoomEvent_room_id_type_round_idx" ON "RoomEvent"("room_id", "type", "round");

-- AddForeignKey
ALTER TABLE "VoteReason" ADD CONSTRAINT "VoteReason_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRevision" ADD CONSTRAINT "VoteRevision_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRevision" ADD CONSTRAINT "VoteRevision_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
