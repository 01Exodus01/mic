const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const pinHash = '$2a$10$hAXolRB4kLDaRJLYz5uDneQKt0o.Ms0Mvr.XEcFSqPcjW5F/KhVNe';

async function main() {
  console.log('Seeding data for Playwright screen tests...');

  const host = await prisma.usuario.findFirst();
  if (!host) throw new Error('No host user found');


  // 1. Clean previous votes for room 834192 so Ana has an empty ballot
  const room834192 = await prisma.sala.findUnique({
    where: { pin: '834192' },
    include: { participantes: true, proyectos: true },
  });

  if (room834192) {
    // Delete all votes in room 834192 to have empty ballot
    await prisma.voto.deleteMany({
      where: { proyecto: { sala_id: room834192.id } },
    });
    // Ensure deadline is 45 minutes in the future
    await prisma.sala.update({
      where: { id: room834192.id },
      data: {
        estado: 'ROUND_OPEN',
        deadline: new Date(Date.now() + 45 * 60 * 1000),
      },
    });
    console.log('Room 834192 reset with empty votes and active deadline.');
  }

  // 2. Room CLOSED1 (PIN 777777): Round closed with expired deadline
  let closedRoom = await prisma.sala.findUnique({ where: { pin: '777777' } });
  if (closedRoom) {
    await prisma.sala.delete({ where: { id: closedRoom.id } });
  }

  closedRoom = await prisma.sala.create({
    data: {
      pin: '777777',
      titulo: 'Priorización de Equipamiento Comunitario',
      host_id: host.id,
      metodo: 'BORDA',
      min_miembros: 3,
      max_miembros: 20,
      tau_umbral: 0.8,
      max_rondas: 3,
      ronda_actual: 1,
      estado: 'ROUND_OPEN',
      deadline: new Date(Date.now() - 30 * 60 * 1000), // Venció hace 30 minutos
      proyectos: {
        create: [
          { titulo: 'Renovación de luminarias', descripcion: 'Instalación de luminarias solares en áreas comunes.', orden_idx: 0 },
          { titulo: 'Mobiliario ergonómico', descripcion: 'Reemplazo de mesas y sillas de trabajo.', orden_idx: 1 },
          { titulo: 'Sistema de ventilación', descripcion: 'Optimización del flujo de aire y filtros.', orden_idx: 2 },
        ],
      },
      participantes: {
        create: [
          { nickname: 'Elena', pin_hash: pinHash, codigo_ciego: 'Sujeto_01' },
          { nickname: 'Carlos', pin_hash: pinHash, codigo_ciego: 'Sujeto_02' },
          { nickname: 'Mateo', pin_hash: pinHash, codigo_ciego: 'Sujeto_03' },
        ],
      },
    },
  });
  console.log('Room CLOSED1 (777777) created with expired deadline.');

  // 3. Room FEEDB1 (PIN 999999): Round feedback with ties
  let feedbackRoom = await prisma.sala.findUnique({ where: { pin: '999999' } });
  if (feedbackRoom) {
    await prisma.sala.delete({ where: { id: feedbackRoom.id } });
  }

  feedbackRoom = await prisma.sala.create({
    data: {
      pin: '999999',
      titulo: 'Estrategia Anual de Formación y Vinculación',
      host_id: host.id,
      metodo: 'SCHULZE',
      min_miembros: 3,
      max_miembros: 20,
      tau_umbral: 0.8,
      max_rondas: 3,
      ronda_actual: 1,
      estado: 'ROUND_FEEDBACK',
      deadline: new Date(Date.now() - 15 * 60 * 1000),
      proyectos: {
        create: [
          { titulo: 'Plataforma de mentorías entre pares', descripcion: 'Acompañamiento personalizado entre miembros con más experiencia.', orden_idx: 0 },
          { titulo: 'Laboratorio de innovación abierta', descripcion: 'Espacio de experimentación y prototipado rápido de soluciones.', orden_idx: 1 },
          { titulo: 'Incubadora de proyectos piloto', descripcion: 'Financiamiento semilla y asesoría técnica para iniciativas emergentes.', orden_idx: 2 },
          { titulo: 'Feria semestral de vinculación', descripcion: 'Encuentro con organizaciones aliadas y presentación de resultados.', orden_idx: 3 },
        ],
      },
      participantes: {
        create: [
          { nickname: 'Valeria', pin_hash: pinHash, codigo_ciego: 'Sujeto_01' },
          { nickname: 'Andrés', pin_hash: pinHash, codigo_ciego: 'Sujeto_02' },
          { nickname: 'Lucía', pin_hash: pinHash, codigo_ciego: 'Sujeto_03' },
          { nickname: 'Mateo', pin_hash: pinHash, codigo_ciego: 'Sujeto_04' },
        ],
      },
    },
    include: { proyectos: true },
  });

  const pMap = {};
  for (const p of feedbackRoom.proyectos) {
    pMap[p.orden_idx] = p.id;
  }

  // Create report for feedbackRoom with ties (midRank 1.5 for options 0 and 1)
  await prisma.reporteRonda.create({
    data: {
      sala_id: feedbackRoom.id,
      ronda: 1,
      m_efectivo: 4,
      tau_obtenido: 0.68,
      ranking_colectivo: [
        { id: pMap[0], midRank: 1.5, score: 3.5 },
        { id: pMap[1], midRank: 1.5, score: 3.5 },
        { id: pMap[2], midRank: 3.0, score: 2.0 },
        { id: pMap[3], midRank: 4.0, score: 1.0 },
      ],
      argumentos_json: {
        [pMap[0]]: [
          { codigoCiego: 'Sujeto_04', posicion: 1, justificacion: 'Tiene impacto directo en el acompañamiento y desarrollo de habilidades prácticas.' },
          { codigoCiego: 'Sujeto_02', posicion: 2, justificacion: 'Permite una transferencia horizontal muy efectiva y constante entre participantes.' },
        ],
        [pMap[1]]: [
          { codigoCiego: 'Sujeto_01', posicion: 1, justificacion: 'Genera sinergia interdisciplinaria y prototipos aplicables de manera temprana.' },
          { codigoCiego: 'Sujeto_03', posicion: 2, justificacion: 'Fomenta la creatividad grupal y la resolución de problemas reales del entorno.' },
        ],
        [pMap[2]]: [
          { codigoCiego: 'Sujeto_03', posicion: 3, justificacion: 'Requiere mayor madurez de las propuestas antes de poder implementarse de forma viable.' },
        ],
        [pMap[3]]: [
          { codigoCiego: 'Sujeto_04', posicion: 4, justificacion: 'Es una actividad puntual de difusión con menor continuidad formativa en el tiempo.' },
        ],
      },
    },
  });

  console.log('Room FEEDB1 (999999) created with ties report and arguments.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
