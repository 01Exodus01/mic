/**
 * app/api/rooms/[id]/export/wide/route.ts
 * Generates and downloads matrix_wide_metrics.csv for paired hypothesis testing.
 *
 * Headers:
 *   room_id, round, method, effective_voters, collective_tau, delta_tau,
 *   stuart_tau_c, stuart_cix, gamma_decided_pairs, gamma_cix, collective_ranking, room_status
 *
 * Formula injection protected (CWE-1236) and UTF-8 BOM.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { escapeCsvField } from '@/lib/csv';
import { computeGroupConsensus } from '@/lib/algorithms/kendallTau';
import type { Ballot, WeakOrder } from '@/lib/algorithms/types';

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

    // Fetch all votes to reconstruct complete ballots per round if needed
    const allVotes = await prisma.vote.findMany({
      where: {
        option: { room_id: roomId },
      },
      select: {
        round: true,
        participant_id: true,
        option_id: true,
        position: true,
      },
    });

    const optionCount = room.options.length;

    const headers = [
      'room_id',
      'round',
      'method',
      'effective_voters',
      'collective_tau',
      'delta_tau',
      'stuart_tau_c',
      'stuart_cix',
      'gamma_decided_pairs',
      'gamma_cix',
      'collective_ranking',
      'room_status',
    ];
    const lines = [headers.join(',')];

    let prevTau: number | null = null;

    for (const rep of room.reports) {
      const deltaTau =
        prevTau === null
          ? 0
          : Math.round((rep.obtained_tau - prevTau) * 1000) / 1000;
      prevTau = rep.obtained_tau;

      // Extract or compute sensitivity metrics
      let stuartCix = rep.obtained_tau;
      let gammaCix = rep.obtained_tau;

      const argsJson = rep.arguments_json as Record<string, unknown> | null;
      const metricsObj = argsJson?.__metrics as
        | { stuartTauStar?: number; gammaTauStar?: number }
        | undefined;

      if (metricsObj?.stuartTauStar != null && metricsObj?.gammaTauStar != null) {
        stuartCix = metricsObj.stuartTauStar;
        gammaCix = metricsObj.gammaTauStar;
      } else if (Array.isArray(rep.collective_ranking)) {
        // Recalculate from ballots
        const roundVotes = allVotes.filter((v) => v.round === rep.round);
        const pMap = new Map<string, Array<{ option_id: string; position: number }>>();
        for (const rv of roundVotes) {
          const list = pMap.get(rv.participant_id) ?? [];
          list.push({ option_id: rv.option_id, position: rv.position });
          pMap.set(rv.participant_id, list);
        }

        const completeBallots = new Map<string, Ballot>();
        for (const [pid, pVotes] of pMap.entries()) {
          if (pVotes.length === optionCount) {
            completeBallots.set(pid, new Map(pVotes.map((v) => [v.option_id, v.position])));
          }
        }

        if (completeBallots.size > 0) {
          const res = computeGroupConsensus(
            completeBallots,
            rep.collective_ranking as unknown as WeakOrder[]
          );
          stuartCix = res.stuartTauStar;
          gammaCix = res.gammaTauStar;
        }
      }

      const stuartTauC = 2 * stuartCix - 1;
      const gammaVal = 2 * gammaCix - 1;

      let rankingStr = '';
      if (Array.isArray(rep.collective_ranking)) {
        rankingStr = (rep.collective_ranking as Array<{ id: string; midRank: number }>)
          .map((r) => `${r.id}:${r.midRank}`)
          .join(' > ');
      }

      const row = [
        escapeCsvField(roomId),
        escapeCsvField(rep.round),
        escapeCsvField(room.method),
        escapeCsvField(rep.effective_voters),
        escapeCsvField(Number(rep.obtained_tau.toFixed(4))),
        escapeCsvField(Number(deltaTau.toFixed(4))),
        escapeCsvField(Number(stuartTauC.toFixed(4))),
        escapeCsvField(Number(stuartCix.toFixed(4))),
        escapeCsvField(Number(gammaVal.toFixed(4))),
        escapeCsvField(Number(gammaCix.toFixed(4))),
        escapeCsvField(rankingStr),
        escapeCsvField(room.status),
      ];
      lines.push(row.join(','));
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="matrix_wide_metrics_${room.pin}.csv"`,
      },
    });
  } catch (err: unknown) {
    console.error('Error exporting matrix_wide_metrics.csv:', err);
    return new NextResponse('Error generando archivo CSV', { status: 500 });
  }
}
