/**
 * prisma/seed.js
 * Development seed: deletes votes, reports, participants, options and rooms,
 * then upserts one host account.
 *
 * Required environment variables:
 *   SEED_HOST_EMAIL     host account email
 *   SEED_HOST_PASSWORD  host account password (8 to 72 bytes)
 * Optional:
 *   SEED_HOST_NAME      host display name (default "Anfitrión de prueba")
 *
 * Refuses to run when NODE_ENV=production unless ALLOW_PRODUCTION_SEED=true.
 */

const bcrypt = require("bcryptjs");

const DEFAULT_HOST_NAME = "Anfitrión de prueba";

function assertSeedAllowed(env) {
  if (env.NODE_ENV === "production" && env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error(
      "El seed borra salas, participantes y votos. No se ejecuta con NODE_ENV=production. " +
        "Si de verdad quieres hacerlo, define ALLOW_PRODUCTION_SEED=true."
    );
  }
}

function readSeedHostConfig(env) {
  const email = (env.SEED_HOST_EMAIL || "").trim();
  const password = env.SEED_HOST_PASSWORD || "";
  const name = (env.SEED_HOST_NAME || "").trim() || DEFAULT_HOST_NAME;

  if (!email || !email.includes("@")) {
    throw new Error("Falta SEED_HOST_EMAIL o no es un correo válido.");
  }
  const passwordBytes = Buffer.byteLength(password, "utf8");
  if (passwordBytes < 8 || passwordBytes > 72) {
    throw new Error("Falta SEED_HOST_PASSWORD o no tiene entre 8 y 72 bytes.");
  }
  return { email, password, name };
}

async function main(env = process.env) {
  assertSeedAllowed(env);
  const config = readSeedHostConfig(env);

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    console.log("Aplicando seeds limpios...");

    // Limpiar salas, opciones, participantes y votos
    await prisma.vote.deleteMany();
    await prisma.roundReport.deleteMany();
    await prisma.participant.deleteMany();
    await prisma.option.deleteMany();
    await prisma.room.deleteMany();

    // Asegurar cuenta de anfitrión activa con credenciales del entorno
    const passwordHash = await bcrypt.hash(config.password, 10);
    const host = await prisma.user.upsert({
      where: { email: config.email },
      update: { password_hash: passwordHash, name: config.name },
      create: { email: config.email, name: config.name, password_hash: passwordHash },
    });

    console.log(`Base de datos limpia. Anfitrión listo: ${host.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { assertSeedAllowed, readSeedHostConfig, main };

if (require.main === module) {
  main().catch((e) => {
    console.error("Error en el seed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
