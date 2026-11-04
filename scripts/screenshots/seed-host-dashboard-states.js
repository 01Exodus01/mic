const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding rooms in all 6 states for host dashboard...');

  const host = await prisma.usuario.findFirst({
    where: { email: 'docente@universidad.edu' },
  });
  if (!host) throw new Error('Host user not found');

  const states = [
    {
      pin: '101010',
      titulo: 'Plan de Sostenibilidad y Ahorro Energético',
      estado: 'DRAFT',
      ronda_actual: 1,
      max_rondas: 3,
      min_miembros: 3,
      max_miembros: 20,
      tau_umbral: 0.8,
      metodo: 'BORDA',
      optionsCount: 4,
    },
    {
      pin: '834192',
      titulo: 'Priorización de Proyectos de Innovación Social 2026',
      estado: 'ROUND_OPEN',
      ronda_actual: 1,
      max_rondas: 3,
      min_miembros: 3,
      max_miembros: 20,
      tau_umbral: 0.8,
      metodo: 'BORDA',
      optionsCount: 4,
    },
    {
      pin: '777777',
      titulo: 'Priorización de Equipamiento Comunitario',
      estado: 'QUORUM_UNMET',
      ronda_actual: 1,
      max_rondas: 3,
      min_miembros: 3,
      max_miembros: 20,
      tau_umbral: 0.8,
      metodo: 'BORDA',
      optionsCount: 3,
    },
    {
      pin: '202020',
      titulo: 'Revisión Presupuestaria de Proyectos',
      estado: 'PROCESSING',
      ronda_actual: 2,
      max_rondas: 3,
      min_miembros: 3,
      max_miembros: 25,
      tau_umbral: 0.85,
      metodo: 'SCHULZE',
      optionsCount: 5,
    },
    {
      pin: '999999',
      titulo: 'Estrategia Anual de Formación y Vinculación',
      estado: 'ROUND_FEEDBACK',
      ronda_actual: 1,
      max_rondas: 3,
      min_miembros: 3,
      max_miembros: 20,
      tau_umbral: 0.8,
      metodo: 'BORDA',
      optionsCount: 4,
      tau_obtenido: 0.68,
    },
    {
      pin: '303030',
      titulo: 'Adjudicación de Fondos de Innovación',
      estado: 'CONCLUDED',
      ronda_actual: 2,
      max_rondas: 3,
      min_miembros: 3,
      max_miembros: 30,
      tau_umbral: 0.75,
      metodo: 'KEMENY_YOUNG',
      optionsCount: 4,
      tau_obtenido: 0.82,
    },
  ];

  for (const item of states) {
    let sala = await prisma.sala.findUnique({
      where: { pin: item.pin },
      include: { proyectos: true, reportes: true },
    });

    if (sala) {
      await prisma.sala.update({
        where: { id: sala.id },
        data: {
          titulo: item.titulo,
          estado: item.estado,
          ronda_actual: item.ronda_actual,
          max_rondas: item.max_rondas,
          max_miembros: item.max_miembros,
          tau_umbral: item.tau_umbral,
          metodo: item.metodo,
          deadline: item.estado === 'ROUND_OPEN' ? new Date(Date.now() + 60 * 60 * 1000) : null,
        },
      });
      console.log(`Updated room ${item.pin} (${item.estado})`);
    } else {
      const proyectosData = [];
      for (let i = 0; i < item.optionsCount; i++) {
        proyectosData.push({
          titulo: `Opción ${String.fromCharCode(65 + i)}`,
          descripcion: `Descripción detallada de la propuesta ${String.fromCharCode(65 + i)}`,
          orden_idx: i,
        });
      }

      sala = await prisma.sala.create({
        data: {
          pin: item.pin,
          titulo: item.titulo,
          host_id: host.id,
          metodo: item.metodo,
          max_miembros: item.max_miembros,
          tau_umbral: item.tau_umbral,
          max_rondas: item.max_rondas,
          ronda_actual: item.ronda_actual,
          estado: item.estado,
          deadline: item.estado === 'ROUND_OPEN' ? new Date(Date.now() + 60 * 60 * 1000) : null,
          proyectos: { create: proyectosData },
        },
      });
      console.log(`Created room ${item.pin} (${item.estado})`);
    }

    if (item.tau_obtenido != null) {
      const existingReport = await prisma.reporteRonda.findFirst({
        where: { sala_id: sala.id, ronda: item.ronda_actual },
      });
      if (!existingReport) {
        await prisma.reporteRonda.create({
          data: {
            sala_id: sala.id,
            ronda: item.ronda_actual,
            m_efectivo: 4,
            ranking_colectivo: [
              { id: 'opt1', titulo: 'Opción A', midRank: 1.0 },
              { id: 'opt2', titulo: 'Opción B', midRank: 2.0 },
            ],
            tau_obtenido: item.tau_obtenido,
            argumentos_json: {},
          },
        });
        console.log(`Created report for ${item.pin} with tau ${item.tau_obtenido}`);
      }
    }
  }

  console.log('Seeding finished successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
