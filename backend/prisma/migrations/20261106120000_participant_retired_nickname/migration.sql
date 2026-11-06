-- Removing a participant frees their name for someone else (e.g. the real
-- person when a troll used it); the original name is kept here and restored
-- if the host reinstates them.
ALTER TABLE "Participant" ADD COLUMN "retired_nickname" VARCHAR(30);

-- Participants removed before this change, in rooms that use names (open PIN):
-- free their names the same way. Reversible: the name moves to retired_nickname.
-- '~' cannot appear in a typed name, so the placeholder never collides.
UPDATE "Participant" AS p
SET "retired_nickname" = p."nickname", "nickname" = '~' || p."id"
FROM "Room" AS r
WHERE r."id" = p."room_id" AND r."access_mode" = 'OPEN_PIN' AND p."is_retired" = true AND p."retired_nickname" IS NULL;
