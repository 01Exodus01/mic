-- E-13: new rooms accept late participants unless the host blocks them.
-- Existing rooms keep their setting.
ALTER TABLE "Room" ALTER COLUMN "allow_late_join" SET DEFAULT true;
