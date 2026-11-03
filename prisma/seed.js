const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Aplicando seeds limpios...");

  // Limpiar salas, opciones, participantes y votos
  await prisma.vote.deleteMany();
  await prisma.roundReport.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.option.deleteMany();
  await prisma.room.deleteMany();

  // Asegurar cuenta de anfitrión activa
  // Correo: docente@universidad.edu
  // Contraseña: DocentePass123!
  const host = await prisma.user.upsert({
    where: { email: "docente@universidad.edu" },
    update: {
      password_hash: "$2a$10$WKcf8V0LYsPvex7cP.TMHukv2b/rxvPMIA/7h0XywVEjvRp3RIOai",
      name: "Prof. Alejandro Ramírez",
    },
    create: {
      id: "usr_host_alejandro",
      email: "docente@universidad.edu",
      name: "Prof. Alejandro Ramírez",
      password_hash: "$2a$10$WKcf8V0LYsPvex7cP.TMHukv2b/rxvPMIA/7h0XywVEjvRp3RIOai",
    },
  });

  console.log(`Base de datos limpia. Anfitrión listo: ${host.email}`);
}

main()
  .catch((e) => {
    console.error("Error al limpiar la base de datos:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
