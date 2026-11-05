-- E-12: new rooms always break ties and measure agreement without ties.
-- Existing rooms keep the rule and variant they were created with.
ALTER TABLE "Room" ALTER COLUMN "tie_break_rule" SET DEFAULT 'PAIRWISE_MAJORITY';
ALTER TABLE "Room" ALTER COLUMN "concordance_variant" SET DEFAULT 'WITHOUT_TIES';
