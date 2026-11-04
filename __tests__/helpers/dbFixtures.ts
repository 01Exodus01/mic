/**
 * __tests__/helpers/dbFixtures.ts
 * Fixtures for integration tests that run against a real, migrated PostgreSQL
 * database (TEST_DATABASE_URL). Each fixture creates its own host and cascades
 * on cleanup, so tests never touch other data.
 */

import { PrismaClient, Prisma, RoomStatus } from '@prisma/client';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
export const hasTestDb = Boolean(TEST_DB_URL);

let counter = 0;

function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.toUpperCase();
}

function uniquePin(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pin = '';
  for (let i = 0; i < 6; i++) pin += alphabet[Math.floor(Math.random() * alphabet.length)];
  return pin;
}

export interface RoomFixture {
  hostId: string;
  roomId: string;
  pin: string;
  optionIds: string[];
  participantIds: string[];
  blindCodes: string[];
}

export interface RoomFixtureOptions {
  participants?: number;
  options?: number;
  status?: RoomStatus;
  currentRound?: number;
  room?: Partial<Prisma.RoomUncheckedCreateInput>;
}

export async function createRoomFixture(
  prisma: PrismaClient,
  opts: RoomFixtureOptions = {}
): Promise<RoomFixture> {
  const suffix = uniqueSuffix();
  const host = await prisma.user.create({
    data: { email: `fixture-${suffix.toLowerCase()}@example.test`, name: 'Anfitrión fixture', password_hash: 'x' },
  });
  const optionCount = opts.options ?? 3;
  let room = null;
  for (let attempt = 0; attempt < 5 && !room; attempt++) {
    try {
      room = await prisma.room.create({
        data: {
          pin: uniquePin(),
          title: `Sala fixture ${suffix}`,
          host_id: host.id,
          status: opts.status ?? 'ROUND_OPEN',
          current_round: opts.currentRound ?? 1,
          deadline: new Date(Date.now() + 60 * 60 * 1000),
          ...opts.room,
          options: {
            create: Array.from({ length: optionCount }, (_, i) => ({
              title: `Opción ${i + 1}`,
              description: '',
              order_index: i,
            })),
          },
        },
        include: { options: { orderBy: { order_index: 'asc' } } },
      });
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  if (!room) throw new Error('fixture room not created');

  const participantIds: string[] = [];
  const blindCodes: string[] = [];
  for (let i = 0; i < (opts.participants ?? 3); i++) {
    const blindCode = `Participante ${String(i + 1).padStart(2, '0')}`;
    const p = await prisma.participant.create({
      data: { room_id: room.id, nickname: `Persona ${i + 1}`, pin_hash: 'x', blind_code: blindCode },
    });
    participantIds.push(p.id);
    blindCodes.push(blindCode);
  }

  return {
    hostId: host.id,
    roomId: room.id,
    pin: room.pin,
    optionIds: room.options.map((o) => o.id),
    participantIds,
    blindCodes,
  };
}

export async function cleanupFixture(prisma: PrismaClient, fixture: RoomFixture | null): Promise<void> {
  if (!fixture) return;
  await prisma.user.deleteMany({ where: { id: fixture.hostId } });
}
