-- AlterEnum
ALTER TYPE "RoomStatus" ADD VALUE 'CANCELLED';

-- CreateIndex
CREATE UNIQUE INDEX "Vote_participant_id_round_position_key" ON "Vote"("participant_id", "round", "position");
