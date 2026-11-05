-- CreateTable
CREATE TABLE "RoundVoterMetric" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "participant_id" TEXT NOT NULL,
    "tau_b" DOUBLE PRECISION NOT NULL,
    "cix" DOUBLE PRECISION NOT NULL,
    "stuart_tau_c" DOUBLE PRECISION NOT NULL,
    "stuart_cix" DOUBLE PRECISION NOT NULL,
    "gamma" DOUBLE PRECISION NOT NULL,
    "gamma_cix" DOUBLE PRECISION NOT NULL,
    "concordant" INTEGER NOT NULL,
    "discordant" INTEGER NOT NULL,
    "tied" INTEGER NOT NULL,

    CONSTRAINT "RoundVoterMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundVoterMetric_room_id_round_idx" ON "RoundVoterMetric"("room_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "RoundVoterMetric_report_id_participant_id_key" ON "RoundVoterMetric"("report_id", "participant_id");

-- AddForeignKey
ALTER TABLE "RoundVoterMetric" ADD CONSTRAINT "RoundVoterMetric_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "RoundReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundVoterMetric" ADD CONSTRAINT "RoundVoterMetric_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

