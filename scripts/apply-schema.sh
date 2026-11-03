#!/bin/bash
# Script to apply the Prisma schema manually inside the container
# since Docker Desktop on WSL2 doesn't expose bridge network ports to the host

docker exec gdss_postgres psql -U gdss_user -d gdss_db << 'SQL'
-- Create ENUMs
DO $$ BEGIN
  CREATE TYPE "MetodoAgregacion" AS ENUM ('BORDA', 'SCHULZE', 'KEMENY_YOUNG');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "EstadoSala" AS ENUM ('DRAFT', 'ROUND_OPEN', 'QUORUM_UNMET', 'PROCESSING', 'ROUND_FEEDBACK', 'CONCLUDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Table: usuarios
CREATE TABLE IF NOT EXISTS "usuarios" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "email"         TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "nombre"        TEXT NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usuarios_email_key" UNIQUE ("email")
);

-- Table: salas
CREATE TABLE IF NOT EXISTS "salas" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "pin"          TEXT NOT NULL,
  "titulo"       TEXT NOT NULL,
  "host_id"      TEXT NOT NULL,
  "metodo"       "MetodoAgregacion" NOT NULL DEFAULT 'BORDA',
  "min_miembros" INT NOT NULL DEFAULT 3,
  "max_miembros" INT NOT NULL DEFAULT 40,
  "tau_umbral"   FLOAT8 NOT NULL DEFAULT 0.80,
  "max_rondas"   INT NOT NULL DEFAULT 3,
  "ronda_actual" INT NOT NULL DEFAULT 1,
  "estado"       "EstadoSala" NOT NULL DEFAULT 'DRAFT',
  "deadline"     TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "salas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salas_pin_key" UNIQUE ("pin"),
  CONSTRAINT "salas_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "usuarios"("id") ON DELETE CASCADE
);

-- Table: proyectos
CREATE TABLE IF NOT EXISTS "proyectos" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sala_id"     TEXT NOT NULL,
  "titulo"      TEXT NOT NULL,
  "descripcion" TEXT NOT NULL,
  "orden_idx"   INT NOT NULL,
  CONSTRAINT "proyectos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proyectos_sala_id_orden_idx_key" UNIQUE ("sala_id", "orden_idx"),
  CONSTRAINT "proyectos_sala_id_fkey" FOREIGN KEY ("sala_id") REFERENCES "salas"("id") ON DELETE CASCADE
);

-- Table: participantes
CREATE TABLE IF NOT EXISTS "participantes" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sala_id"      TEXT NOT NULL,
  "nickname"     TEXT NOT NULL,
  "pin_hash"     TEXT NOT NULL,
  "codigo_ciego" TEXT NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "participantes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "participantes_sala_id_nickname_key" UNIQUE ("sala_id", "nickname"),
  CONSTRAINT "participantes_sala_id_codigo_ciego_key" UNIQUE ("sala_id", "codigo_ciego"),
  CONSTRAINT "participantes_sala_id_fkey" FOREIGN KEY ("sala_id") REFERENCES "salas"("id") ON DELETE CASCADE
);

-- Table: votos
CREATE TABLE IF NOT EXISTS "votos" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "participante_id" TEXT NOT NULL,
  "ronda"           INT NOT NULL,
  "proyecto_id"     TEXT NOT NULL,
  "posicion"        INT NOT NULL,
  "justificacion"   TEXT NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "votos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "votos_participante_id_ronda_proyecto_id_key" UNIQUE ("participante_id", "ronda", "proyecto_id"),
  CONSTRAINT "votos_participante_id_fkey" FOREIGN KEY ("participante_id") REFERENCES "participantes"("id") ON DELETE CASCADE,
  CONSTRAINT "votos_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "votos_participante_id_ronda_idx" ON "votos"("participante_id", "ronda");
CREATE INDEX IF NOT EXISTS "votos_proyecto_id_ronda_idx" ON "votos"("proyecto_id", "ronda");

-- Table: reportes_ronda
CREATE TABLE IF NOT EXISTS "reportes_ronda" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sala_id"           TEXT NOT NULL,
  "ronda"             INT NOT NULL,
  "m_efectivo"        INT NOT NULL,
  "ranking_colectivo" JSONB NOT NULL,
  "tau_obtenido"      FLOAT8 NOT NULL,
  "argumentos_json"   JSONB NOT NULL,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "reportes_ronda_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reportes_ronda_sala_id_ronda_key" UNIQUE ("sala_id", "ronda"),
  CONSTRAINT "reportes_ronda_sala_id_fkey" FOREIGN KEY ("sala_id") REFERENCES "salas"("id") ON DELETE CASCADE
);

SELECT 'Schema applied successfully!' AS status;
SQL
