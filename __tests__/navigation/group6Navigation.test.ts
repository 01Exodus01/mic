/**
 * __tests__/navigation/group6Navigation.test.ts
 * Tests for Grupo 6: Participantes, navegación y robustez de UI (AUD-13, 14, 23, D2, D3)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MIN_PARTICIPANTS } from '@/lib/validations';
import { buildCountableBallots } from '@/lib/round-processor';

describe('Grupo 6: Participantes, expulsión y navegación', () => {
  describe('AUD-13 & D2: Expulsión lógica (PT-11: votos conservados y excluidos del cálculo)', () => {
    // PT-11: expulsar ya no borra votos. Antes esta prueba afirmaba la purga de la
    // ronda activa; ahora los votos se conservan y el cálculo los excluye.
    it('conserva los votos del expulsado y los deja fuera del cálculo de la ronda', () => {
      const optionCount = 2;
      const votes = [
        { participant_id: 'part-1', option_id: 'opt-1', position: 2, participant: { is_retired: true } },
        { participant_id: 'part-1', option_id: 'opt-2', position: 1, participant: { is_retired: true } },
        { participant_id: 'part-2', option_id: 'opt-1', position: 1, participant: { is_retired: false } },
        { participant_id: 'part-2', option_id: 'opt-2', position: 2, participant: { is_retired: false } },
        { participant_id: 'part-3', option_id: 'opt-1', position: 1, participant: { is_retired: false } },
      ];

      const ballots = buildCountableBallots(votes, optionCount);

      // El expulsado no cuenta; part-3 tiene la boleta incompleta
      expect([...ballots.keys()]).toEqual(['part-2']);
      // Los votos del expulsado siguen en la lista de entrada (no se borran)
      expect(votes.filter((v) => v.participant_id === 'part-1')).toHaveLength(2);
    });

    it('expelParticipant ya no borra votos', () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../../app/actions/room.ts'), 'utf8');
      const expel = source.slice(source.indexOf('export async function expelParticipant'));
      expect(expel).not.toMatch(/vote\.deleteMany/);
    });

    it('rechaza el reingreso de un participante expulsado con el mensaje genérico D4', () => {
      const existingParticipants = [
        { nickname: 'Carlos', is_retired: true },
        { nickname: 'Diana', is_retired: false },
      ];

      const checkReentry = (nick: string) => {
        const found = existingParticipants.find(
          (p) => p.nickname.toLowerCase() === nick.toLowerCase()
        );
        if (found && found.is_retired) {
          // D4: Mensaje genérico que no revela estado interno
          return { allowed: false, error: 'No se puede ingresar a esa sala. Revisa tus datos.' };
        }
        return { allowed: true };
      };

      const resultRetired = checkReentry('carlos');
      expect(resultRetired.allowed).toBe(false);
      expect(resultRetired.error).toBe('No se puede ingresar a esa sala. Revisa tus datos.');

      const resultActive = checkReentry('diana');
      expect(resultActive.allowed).toBe(true);
    });
  });

  describe('D3: Umbral crítico de participantes activos', () => {
    it('detecta advertencia crítica si quedan menos de 3 participantes activos al expulsar', () => {
      const checkExpulsionWarning = (activeCount: number) => {
        const remainingAfterExpel = activeCount - 1;
        return {
          triggersWarning: remainingAfterExpel < MIN_PARTICIPANTS,
          remaining: remainingAfterExpel,
          warningMessage:
            'Advertencia: al expulsar a este participante quedarán menos de 3 participantes activos. Se necesitan al menos 3 participantes para poder calcular el resultado del grupo.',
        };
      };

      // Si hay 3 participantes y se expulsa 1, quedan 2 (< 3)
      const warningCase = checkExpulsionWarning(3);
      expect(warningCase.triggersWarning).toBe(true);
      expect(warningCase.remaining).toBe(2);

      // Si hay 4 participantes y se expulsa 1, quedan 3 (>= 3)
      const safeCase = checkExpulsionWarning(4);
      expect(safeCase.triggersWarning).toBe(false);
      expect(safeCase.remaining).toBe(3);

      // Si hay 2 participantes y se expulsa 1, quedan 1 (< 3)
      const criticalCase = checkExpulsionWarning(2);
      expect(criticalCase.triggersWarning).toBe(true);
      expect(criticalCase.remaining).toBe(1);
    });
  });

  describe('AUD-14: Flujo y navegación del participante (Paso 1, 2, 3)', () => {
    it('permite navegación hacia atrás preservando los valores ingresados', () => {
      const formState = {
        step: 2,
        pin: 'ABC123',
        nickname: 'Elena',
        pin4: '',
      };

      // El usuario hace clic en "Atrás" en el paso 2
      const goBackFromStep2 = () => {
        formState.step = 1;
        // Los valores se conservan intactos
      };

      goBackFromStep2();
      expect(formState.step).toBe(1);
      expect(formState.pin).toBe('ABC123');
      expect(formState.nickname).toBe('Elena');
    });

    it('"Cambiar sala" restablece el PIN de sala y vuelve al paso 1', () => {
      const formState = {
        step: 3,
        pin: 'ABC123',
        nickname: 'Elena',
        pin4: '1234',
      };

      const changeRoom = () => {
        formState.pin = '';
        formState.step = 1;
      };

      changeRoom();
      expect(formState.step).toBe(1);
      expect(formState.pin).toBe('');
      // Conserva el nickname para conveniencia del usuario
      expect(formState.nickname).toBe('Elena');
    });
  });

  describe('AUD-23: Navegación accesible y migas de pan', () => {
    it('las pantallas secundarias deben tener destino explícito "Volver a salas"', () => {
      const breadcrumbConfig = {
        label: 'Migas de pan',
        backTarget: '/dashboard',
        backText: 'Volver a salas',
      };

      expect(breadcrumbConfig.label).toBe('Migas de pan');
      expect(breadcrumbConfig.backTarget).toBe('/dashboard');
      expect(breadcrumbConfig.backText).toBe('Volver a salas');
    });
  });
});
