/**
 * scripts/worker.js
 * Background worker process that runs every BACKGROUND_WORKER_INTERVAL_SEC (default 60s).
 *
 * Discovers any room where:
 *   status === 'ROUND_OPEN' AND deadline <= NOW()
 *
 * Runs the deterministic aggregation engine and updates room state atomically.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const workerSecret = process.env.WORKER_SECRET;
if (!workerSecret || workerSecret.trim().length < 32) {
  console.error('[GDSS Worker] WORKER_SECRET no está configurado o tiene menos de 32 caracteres. Abortando por seguridad.');
  process.exit(1);
}

const intervalSec = parseInt(process.env.BACKGROUND_WORKER_INTERVAL_SEC || '60', 10);
const intervalMs = Math.max(5, intervalSec) * 1000;

console.log(`[GDSS Worker] Starting background worker (polling interval: ${intervalSec}s)...`);

async function checkExpiredRooms() {
  try {
    const now = new Date();
    const expiredRooms = await prisma.room.findMany({
      where: {
        status: 'ROUND_OPEN',
        deadline: {
          lte: now,
        },
      },
      select: {
        id: true,
        pin: true,
        title: true,
        current_round: true,
        deadline: true,
      },
    });

    if (expiredRooms.length === 0) {
      return;
    }

    console.log(`[GDSS Worker] Found ${expiredRooms.length} room(s) with expired deadlines. Processing...`);

    for (const room of expiredRooms) {
      console.log(`[GDSS Worker] Processing Room PIN ${room.pin} (Round ${room.current_round})...`);
      try {
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const res = await fetch(`${baseUrl}/api/internal/process-deadline`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-worker-secret': workerSecret,
          },
          body: JSON.stringify({ roomId: room.id }),
        });

        if (res.ok) {
          const data = await res.json();
          console.log(`[GDSS Worker] Room ${room.pin} processed successfully: State -> ${data.state}, Voters -> ${data.effectiveVoters ?? data.mEfectivo ?? 0}`);
        } else {
          const errText = await res.text();
          console.error(`[GDSS Worker] Failed to process room ${room.pin}: ${res.status} ${errText}`);
        }
      } catch (err) {
        console.error(`[GDSS Worker] Error processing room ${room.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[GDSS Worker] Polling error:', err);
  }
}

// Initial check on start, then repeat every interval
checkExpiredRooms();
setInterval(checkExpiredRooms, intervalMs);

process.on('SIGINT', async () => {
  console.log('[GDSS Worker] Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[GDSS Worker] Terminating...');
  await prisma.$disconnect();
  process.exit(0);
});
