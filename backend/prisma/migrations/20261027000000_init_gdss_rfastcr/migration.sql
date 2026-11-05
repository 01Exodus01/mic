-- CreateEnum
CREATE TYPE "AggregationMethod" AS ENUM ('BORDA', 'SCHULZE', 'KEMENY_YOUNG');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('DRAFT', 'ROUND_OPEN', 'INSUFFICIENT_VOTES', 'PROCESSING', 'ROUND_FEEDBACK', 'CONCLUDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "pin" VARCHAR(6) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "host_id" TEXT NOT NULL,
    "method" "AggregationMethod" NOT NULL DEFAULT 'BORDA',
    "max_members" INTEGER NOT NULL DEFAULT 40,
    "tau_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "max_rounds" INTEGER NOT NULL DEFAULT 3,
    "current_round" INTEGER NOT NULL DEFAULT 1,
    "status" "RoomStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Option" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "Option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "nickname" VARCHAR(30) NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "blind_code" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "option_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "justification" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundReport" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "effective_voters" INTEGER NOT NULL,
    "collective_ranking" JSONB NOT NULL,
    "obtained_tau" DOUBLE PRECISION NOT NULL,
    "arguments_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Room_pin_key" ON "Room"("pin");

-- CreateIndex
CREATE INDEX "Room_status_deadline_idx" ON "Room"("status", "deadline");

-- CreateIndex
CREATE INDEX "Room_host_id_idx" ON "Room"("host_id");

-- CreateIndex
CREATE UNIQUE INDEX "Option_room_id_order_index_key" ON "Option"("room_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_room_id_nickname_key" ON "Participant"("room_id", "nickname");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_room_id_blind_code_key" ON "Participant"("room_id", "blind_code");

-- CreateIndex
CREATE INDEX "Vote_participant_id_round_idx" ON "Vote"("participant_id", "round");

-- CreateIndex
CREATE INDEX "Vote_option_id_round_idx" ON "Vote"("option_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_participant_id_round_option_id_key" ON "Vote"("participant_id", "round", "option_id");

-- CreateIndex
CREATE UNIQUE INDEX "RoundReport_room_id_round_key" ON "RoundReport"("room_id", "round");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Option" ADD CONSTRAINT "Option_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "Option"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundReport" ADD CONSTRAINT "RoundReport_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
