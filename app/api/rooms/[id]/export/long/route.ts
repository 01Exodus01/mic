/**
 * app/api/rooms/[id]/export/long/route.ts
 * Generates and downloads matrix_long.csv for academic and statistical analysis.
 *
 * Headers:
 *   room_id, round, method, blind_code, option_id, position, justification_text,
 *   voter_tau_b, voter_cix, stuart_tau_c, stuart_cix, gamma_decided_pairs, gamma_cix, room_status
 *
 * Strict Zero-PII: uses blind_code, never nickname or real identity.
 * Formula injection protected (CWE-1236) and UTF-8 BOM.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { escapeCsvField } from '@/lib/csv';
import { computeVoterCIX } from '@/lib/algorithms/kendallTau';
import type { Ballot, WeakOrder, VoterCIX } from '@/lib/algorithms/types';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('No autorizado', { status: 401 });
    }

    const hostId = (session.user as { id: string }).id;
    const roomId = params.id;

    // Verify room exists and belongs to host
    const room = await prisma.room.findFirst({
      where: { id: roomId, host_id: hostId },
      include: {
        options: { orderBy: { order_index: 'asc' } },
        reports: { orderBy: { round: 'asc' } },
      },
    });

    if (!room) {
      return new NextResponse('Sala no encontrada', { status: 404 });
    }

    // Fetch all votes across all rounds
    const votes = await prisma.vote.findMany({
      where: {
        option: { room_id: roomId },
      },
      include: {
        participant: { select: { id: true, blind_code: true } },
      },
      orderBy: [
        { round: 'asc' },
        { participant: { blind_code: 'asc' } },
        { position: 'asc' },
      ],
    });

    // Map reports by round
    const reportMap = new Map<number, typeof room.reports[0]>();
    for (const rep of room.reports) {
      reportMap.set(rep.round, rep);
    }

    // Build ballots per (round, participant)
    const optionCount = room.options.length;
    const votesByRoundPart = new Map<string, Array<{ option_id: string; position: number }>>();
    for (const v of votes) {
      const key = `${v.round}:${v.participant_id}`;
      const list = votesByRoundPart.get(key) ?? [];
      list.push({ option_id: v.option_id, position: v.position });
      votesByRoundPart.set(key, list);
    }

    // Compute voter metrics cache
    const voterMetricsCache = new Map<string, VoterCIX>();
    for (const [key, pVotes] of votesByRoundPart.entries()) {
      const [roundStr, partId] = key.split(':');
      const roundNum = parseInt(roundStr, 10);
      const rep = reportMap.get(roundNum);

      if (rep && Array.isArray(rep.collective_ranking) && pVotes.length === optionCount) {
        const ballot: Ballot = new Map(pVotes.map((pv) => [pv.option_id, pv.position]));
        const metrics = computeVoterCIX(
          ballot,
          rep.collective_ranking as unknown as WeakOrder[],
          partId
        );
        voterMetricsCache.set(key, metrics);
      }
    }

    const headers = [
      'room_id',
      'round',
      'method',
      'blind_code',
      'option_id',
      'position',
      'justification_text',
      'voter_tau_b',
      'voter_cix',
      'stuart_tau_c',
      'stuart_cix',
      'gamma_decided_pairs',
      'gamma_cix',
      'room_status',
    ];

    const lines = [headers.join(',')];

    for (const v of votes) {
      const metricsKey = `${v.round}:${v.participant_id}`;
      const m = voterMetricsCache.get(metricsKey);

      const row = [
        escapeCsvField(roomId),
        escapeCsvField(v.round),
        escapeCsvField(room.method),
        escapeCsvField(v.participant.blind_code),
        escapeCsvField(v.option_id),
        escapeCsvField(v.position),
        escapeCsvField(v.justification),
        escapeCsvField(m != null && m.tauB != null ? Number(m.tauB.toFixed(4)) : ''),
        escapeCsvField(m != null && m.cix != null ? Number(m.cix.toFixed(4)) : ''),
        escapeCsvField(m != null && m.stuartTauC != null ? Number(m.stuartTauC.toFixed(4)) : ''),
        escapeCsvField(m != null && m.stuartCix != null ? Number(m.stuartCix.toFixed(4)) : ''),
        escapeCsvField(m != null && m.gamma != null ? Number(m.gamma.toFixed(4)) : ''),
        escapeCsvField(m != null && m.gammaCix != null ? Number(m.gammaCix.toFixed(4)) : ''),
        escapeCsvField(room.status),
      ];
      lines.push(row.join(','));
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="matrix_long_${room.pin}.csv"`,
      },
    });
  } catch (err: unknown) {
    console.error('Error exporting matrix_long.csv:', err);
    return new NextResponse('Error generando archivo CSV', { status: 500 });
  }
}
