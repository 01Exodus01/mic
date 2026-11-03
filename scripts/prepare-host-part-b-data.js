const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pinHash = '$2a$10$hAXolRB4kLDaRJLYz5uDneQKt0o.Ms0Mvr.XEcFSqPcjW5F/KhVNe'; // 1234

async function main() {
  console.log('Preparing rich test data for Host Part B screenshots...');

  // 1. Room DRAFT (101010): add participants if not present
  const rDraft = await prisma.sala.findUnique({
    where: { pin: '101010' },
    include: { participantes: true },
  });
  if (rDraft && rDraft.participantes.length === 0) {
    await prisma.participante.createMany({
      data: [
        { sala_id: rDraft.id, nickname: 'Ana', pin_hash: pinHash, codigo_ciego: 'Sujeto_01' },
        { sala_id: rDraft.id, nickname: 'Carlos', pin_hash: pinHash, codigo_ciego: 'Sujeto_02' },
        { sala_id: rDraft.id, nickname: 'Sofía', pin_hash: pinHash, codigo_ciego: 'Sujeto_03' },
      ],
    });
    console.log('Added participants to room 101010 (DRAFT)');
  }

  // 2. Room ROUND_OPEN (834192): ensure 2 participants have votes in round 1
  const rOpen = await prisma.sala.findUnique({
    where: { pin: '834192' },
    include: { participantes: true, proyectos: true },
  });
  if (rOpen) {
    // Delete existing votes in room 834192
    await prisma.voto.deleteMany({
      where: { proyecto: { sala_id: rOpen.id } },
    });
    // Add votes for 2 of the participants
    const voters = rOpen.participantes.slice(0, 2);
    for (const v of voters) {
      for (let i = 0; i < rOpen.proyectos.length; i++) {
        await prisma.voto.create({
          data: {
            participante_id: v.id,
            proyecto_id: rOpen.proyectos[i].id,
            ronda: 1,
            posicion: i + 1,
            justificacion: 'Razón completa y detallada de más de 25 caracteres para este voto.',
          },
        });
      }
    }
    // Update deadline to +45 minutes
    await prisma.sala.update({
      where: { id: rOpen.id },
      data: {
        estado: 'ROUND_OPEN',
        deadline: new Date(Date.now() + 45 * 60 * 1000),
      },
    });
    console.log('Room 834192 configured with 2 votes out of 5 participants.');
  }

  // 3. Room QUORUM_UNMET (777777): 1 voter out of 3 participants, expired deadline
  const rQuorum = await prisma.sala.findUnique({
    where: { pin: '777777' },
    include: { participantes: true, proyectos: true },
  });
  if (rQuorum) {
    await prisma.voto.deleteMany({
      where: { proyecto: { sala_id: rQuorum.id } },
    });
    if (rQuorum.participantes.length > 0) {
      const v = rQuorum.participantes[0];
      for (let i = 0; i < rQuorum.proyectos.length; i++) {
        await prisma.voto.create({
          data: {
            participante_id: v.id,
            proyecto_id: rQuorum.proyectos[i].id,
            ronda: 1,
            posicion: i + 1,
            justificacion: 'Justificación completa de más de 25 caracteres de prueba.',
          },
        });
      }
    }
    await prisma.sala.update({
      where: { id: rQuorum.id },
      data: {
        estado: 'QUORUM_UNMET',
        deadline: new Date(Date.now() - 30 * 60 * 1000),
      },
    });
    console.log('Room 777777 configured with QUORUM_UNMET (1 of 3 voted).');
  }

  // 4. Room CONCLUDED (303030): add participants if not present
  const rConcluded = await prisma.sala.findUnique({
    where: { pin: '303030' },
    include: { participantes: true, proyectos: true },
  });
  if (rConcluded && rConcluded.participantes.length === 0) {
    await prisma.participante.createMany({
      data: [
        { sala_id: rConcluded.id, nickname: 'Mariana', pin_hash: pinHash, codigo_ciego: 'Sujeto_01' },
        { sala_id: rConcluded.id, nickname: 'Diego', pin_hash: pinHash, codigo_ciego: 'Sujeto_02' },
        { sala_id: rConcluded.id, nickname: 'Lucía', pin_hash: pinHash, codigo_ciego: 'Sujeto_03' },
        { sala_id: rConcluded.id, nickname: 'Gabriel', pin_hash: pinHash, codigo_ciego: 'Sujeto_04' },
      ],
    });
    console.log('Added participants to room 303030 (CONCLUDED)');
  }

  console.log('Finished setting up Part B data.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
