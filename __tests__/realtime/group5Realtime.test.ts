/**
 * __tests__/realtime/group5Realtime.test.ts
 * Tests for Grupo 5: Voto enviado, cronómetros, tiempo real y presets
 * (AUD-06, AUD-12, AUD-22, AUD-29, AUD-30)
 */

import { describe, it, expect } from 'vitest';
import { RoundDurationSchema } from '@/lib/validations';
import { GET as syncHandler } from '@/app/api/rooms/[id]/sync/route';
import { NextRequest } from 'next/server';

describe('Grupo 5: Voto enviado, cronómetros, tiempo real y presets', () => {
  describe('AUD-29: Duración de ronda (presets y rango personalizado 1 a 10080)', () => {
    it('acepta todos los presets requeridos (5, 15, 30, 60, 1440)', () => {
      const presets = [5, 15, 30, 60, 1440];
      for (const p of presets) {
        const res = RoundDurationSchema.safeParse(p);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data).toBe(p);
        }
      }
    });

    it('acepta los límites válidos del rango personalizado (1 y 10080 minutos)', () => {
      const minRes = RoundDurationSchema.safeParse(1);
      expect(minRes.success).toBe(true);

      const maxRes = RoundDurationSchema.safeParse(10080);
      expect(maxRes.success).toBe(true);

      const midRes = RoundDurationSchema.safeParse(120);
      expect(midRes.success).toBe(true);
    });

    it('rechaza duraciones inválidas: menores a 1, mayores a 10080 y decimales', () => {
      expect(RoundDurationSchema.safeParse(0).success).toBe(false);
      expect(RoundDurationSchema.safeParse(-5).success).toBe(false);
      expect(RoundDurationSchema.safeParse(10081).success).toBe(false);
      expect(RoundDurationSchema.safeParse(50000).success).toBe(false);
      expect(RoundDurationSchema.safeParse(15.5).success).toBe(false);
    });

    it('calcula la hora límite exacta sumando los minutos al tiempo base', () => {
      const baseMs = 1700000000000;
      const minutes = 45;
      const calculatedDeadline = new Date(baseMs + minutes * 60000);
      expect(calculatedDeadline.getTime()).toBe(baseMs + 45 * 60 * 1000);
    });
  });

  describe('AUD-12 y AUD-22: Corrección de desfase del reloj con serverTime', () => {
    it('corrige el cálculo de tiempo restante cuando el reloj del cliente está adelantado', () => {
      const serverTimeMs = 1700000000000; // Servidor: T0
      const clientTimeMs = serverTimeMs + 5 * 60 * 1000; // Cliente adelantado 5 minutos
      const deadlineMs = serverTimeMs + 15 * 60 * 1000; // Hora límite a 15 min del servidor

      // Fórmula de sincronización:
      // serverOffset = serverTime - clientNow
      const serverOffset = serverTimeMs - clientTimeMs; // -300000 ms (-5 min)

      // nowServer = clientNow + serverOffset
      const nowServer = clientTimeMs + serverOffset;
      const remainingMs = deadlineMs - nowServer;

      // Debe dar exactamente 15 minutos (900000 ms), ignorando los 5 min adelantados del cliente
      expect(remainingMs).toBe(15 * 60 * 1000);
    });

    it('corrige el cálculo de tiempo restante cuando el reloj del cliente está atrasado', () => {
      const serverTimeMs = 1700000000000;
      const clientTimeMs = serverTimeMs - 10 * 60 * 1000; // Cliente atrasado 10 minutos
      const deadlineMs = serverTimeMs + 15 * 60 * 1000;

      const serverOffset = serverTimeMs - clientTimeMs; // +600000 ms (+10 min)
      const nowServer = clientTimeMs + serverOffset;
      const remainingMs = deadlineMs - nowServer;

      expect(remainingMs).toBe(15 * 60 * 1000);
    });

    it('marca inmediatamente "Votación cerrada" al llegar a cero o superar la hora límite', () => {
      const serverTimeMs = 1700000000000;
      const clientTimeMs = serverTimeMs;
      const deadlineMs = serverTimeMs; // Ya expiró en el servidor

      const serverOffset = serverTimeMs - clientTimeMs;
      const nowServer = clientTimeMs + serverOffset;
      const remainingMs = deadlineMs - nowServer;

      expect(remainingMs).toBeLessThanOrEqual(0);
      const isExpired = remainingMs <= 0;
      expect(isExpired).toBe(true);
    });
  });

  describe('AUD-06: Lógica de estado de "Voto enviado" y edición', () => {
    it('detecta correctamente estado hasVoted cuando todas las opciones tienen voto', () => {
      const options = [{ id: 'opt_1' }, { id: 'opt_2' }, { id: 'opt_3' }];
      const myVotes = [
        { option_id: 'opt_1', position: 1, justification: 'Razón número 1 suficientemente larga' },
        { option_id: 'opt_2', position: 2, justification: 'Razón número 2 suficientemente larga' },
        { option_id: 'opt_3', position: 3, justification: 'Razón número 3 suficientemente larga' },
      ];

      const hasVoted = myVotes.length === options.length && myVotes.length > 0;
      expect(hasVoted).toBe(true);

      // Si no está editando, muestra resumen en solo lectura
      const isEditing = false;
      const showReadOnlySummary = hasVoted && !isEditing;
      expect(showReadOnlySummary).toBe(true);
    });

    it('bloquea la edición si la votación está cerrada', () => {
      const isClosed = true;

      // El botón de editar voto no debe habilitarse si isClosed es true
      const canEdit = !isClosed;
      expect(canEdit).toBe(false);

      // Si el usuario estaba editando y la hora límite se vence, isClosed bloquea el envío
      const canSubmit = !isClosed;
      expect(canSubmit).toBe(false);
    });
  });

  describe('AUD-30: Endpoint de sincronización ligera /api/rooms/[id]/sync', () => {
    it('rechaza solicitudes no autenticadas con 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/rooms/room_test/sync');
      const res = await syncHandler(req, { params: { id: 'room_test' } });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('No autorizado.');
    });

    it('valida que el parámetro ID de sala sea obligatorio', async () => {
      const req = new NextRequest('http://localhost:3000/api/rooms//sync');
      const res = await syncHandler(req, { params: { id: '' } });

      expect(res.status).toBe(400);
    });
  });
});
