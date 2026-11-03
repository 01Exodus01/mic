-- ============================================================================
-- GDSS r-FAST-CR: Clean Initial Seeds (Comienzo Limpio)
-- ============================================================================

-- Limpiar tablas transaccionales y de actividades
TRUNCATE TABLE "Vote", "RoundReport", "Participant", "Option", "Room" CASCADE;

-- Anfitrión por defecto para acceso administrativo
-- Correo: docente@universidad.edu
-- Contraseña: DocentePass123!
INSERT INTO "User" ("id", "email", "password_hash", "name", "created_at")
VALUES (
  'usr_host_alejandro',
  'docente@universidad.edu',
  '$2a$10$WKcf8V0LYsPvex7cP.TMHukv2b/rxvPMIA/7h0XywVEjvRp3RIOai',
  'Prof. Alejandro Ramírez',
  NOW()
)
ON CONFLICT ("email") DO UPDATE SET
  "password_hash" = EXCLUDED."password_hash",
  "name" = EXCLUDED."name";
