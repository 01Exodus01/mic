-- CreateEnum
CREATE TYPE "AccessMode" AS ENUM ('OPEN_PIN', 'ROSTER');

-- CreateEnum
CREATE TYPE "TieBreakRule" AS ENUM ('NONE', 'LEXICOGRAPHIC', 'REASON_BALANCE');

-- CreateEnum
CREATE TYPE "ConcordanceVariant" AS ENUM ('WITH_TIES', 'WITHOUT_TIES');

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "joined_round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "access_mode" "AccessMode" NOT NULL DEFAULT 'OPEN_PIN',
ADD COLUMN     "allow_late_join" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "close_when_all_voted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "concordance_variant" "ConcordanceVariant" NOT NULL DEFAULT 'WITH_TIES',
ADD COLUMN     "consent_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consent_text" VARCHAR(4000),
ADD COLUMN     "consent_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tie_break_rule" "TieBreakRule" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "RoomMember" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "access_code_hash" VARCHAR(64) NOT NULL,
    "participant_id" TEXT,
    "added_round" INTEGER NOT NULL DEFAULT 1,
    "is_removed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "text_version" INTEGER NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_participant_id_key" ON "RoomMember"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_room_id_label_key" ON "RoomMember"("room_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_room_id_access_code_hash_key" ON "RoomMember"("room_id", "access_code_hash");

-- CreateIndex
CREATE INDEX "ConsentRecord_room_id_idx" ON "ConsentRecord"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_participant_id_text_version_key" ON "ConsentRecord"("participant_id", "text_version");

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

