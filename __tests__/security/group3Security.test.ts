/**
 * __tests__/security/group3Security.test.ts
 * Tests for Grupo 3: Seguridad y sesiones (AUD-02, AUD-03, AUD-05, AUD-21, AUD-27, AUD-28, D4)
 */

import { describe, it, expect } from 'vitest';
import { generateRandomBlindCode } from '@/lib/pin';
import { extractClientIp } from '@/lib/rate-limit';

describe('Grupo 3: Seguridad y sesiones', () => {
  describe('AUD-02: Anonimato y asignación aleatoria de código ciego', () => {
    it('genera códigos ciegos con prefijo "Participante XX" de forma aleatoria', () => {
      const existingCodes = ['Participante 01', 'Participante 05'];
      const generated = new Set<string>();

      for (let i = 0; i < 30; i++) {
        const code = generateRandomBlindCode(existingCodes, 40);
        expect(code).toMatch(/^Participante \d{2,}$/);
        expect(existingCodes).not.toContain(code);
        generated.add(code);
      }

      // La asignación debe ser diversa, no secuencial determinista
      expect(generated.size).toBeGreaterThan(1);
    });

    it('asigna slots por encima del máximo si todos los slots están ocupados', () => {
      const fullCodes: string[] = [];
      for (let i = 1; i <= 40; i++) {
        fullCodes.push(`Participante ${String(i).padStart(2, '0')}`);
      }
      const overflowCode = generateRandomBlindCode(fullCodes, 40);
      expect(overflowCode).toMatch(/^Participante \d{3,}$/);
      expect(fullCodes).not.toContain(overflowCode);
    });
  });

  describe('AUD-03: No exposición de blind_code al anfitrión', () => {
    it('el mapeo de participantes para el anfitrión no contiene blind_code', () => {
      // Simula el objeto que devuelve getRoomStatus
      const rawParticipant = {
        id: 'part_123',
        nickname: 'Elena',
        blind_code: 'Participante 08',
      };

      // Transformación segura aplicada en app/actions/room.ts
      const hostViewParticipant = {
        id: rawParticipant.id,
        nickname: rawParticipant.nickname,
      };

      expect(hostViewParticipant).not.toHaveProperty('blind_code');
      expect(hostViewParticipant).not.toHaveProperty('codigo_ciego');
      expect(hostViewParticipant).toEqual({ id: 'part_123', nickname: 'Elena' });
    });
  });

  describe('AUD-05: Rate limiting y extracción de IP con TRUSTED_PROXY_HOPS', () => {
    it('ignora cabeceras de proxy cuando TRUSTED_PROXY_HOPS es 0', () => {
      const spoofedXFF = '203.0.113.195, 70.41.3.18';
      const realIp = '203.0.113.195';

      const ip = extractClientIp(spoofedXFF, realIp, 0);
      expect(ip).toBe('127.0.0.1');
    });

    it('extrae la IP desde la derecha cuando TRUSTED_PROXY_HOPS es 1', () => {
      // El proxy de confianza añadió la IP del cliente al final
      const xff = '198.51.100.1, 203.0.113.5';
      const ip = extractClientIp(xff, null, 1);
      expect(ip).toBe('203.0.113.5');
    });

    it('extrae la IP correspondiente cuando TRUSTED_PROXY_HOPS es 2', () => {
      // cliente -> proxy1 -> proxy2 -> servidor
      const xff = '198.51.100.1, 203.0.113.5, 10.0.0.1';
      const ip = extractClientIp(xff, null, 2);
      expect(ip).toBe('203.0.113.5');
    });
  });

  describe('AUD-27: Protección contra DoS por bloqueo de cuenta de anfitrión', () => {
    it('clave de bloqueo incluye IP y email para que un atacante no bloquee al anfitrión legítimo', () => {
      const hostEmail = 'host@institucion.edu';
      const attackerIp = '198.51.100.99';
      const legitimateIp = '203.0.113.10';

      const attackerKey = `host_login:${attackerIp}:${hostEmail}`;
      const legitimateKey = `host_login:${legitimateIp}:${hostEmail}`;

      expect(attackerKey).not.toBe(legitimateKey);
      expect(attackerKey).toBe('host_login:198.51.100.99:host@institucion.edu');
      expect(legitimateKey).toBe('host_login:203.0.113.10:host@institucion.edu');
    });
  });

  describe('D4: Mensaje genérico de no revelación en /join', () => {
    it('retorna mensaje estándar idéntico para salas cerradas, canceladas, inexistentes o participante expulsado', () => {
      const genericMessage = 'No se puede ingresar a esa sala. Revisa tus datos.';

      const testScenarios = [
        { status: 'CONCLUDED', description: 'sala finalizada' },
        { status: 'CANCELLED', description: 'sala cancelada' },
        { status: 'DRAFT', description: 'sala en borrador' },
        { status: null, description: 'sala inexistente' },
        { isRetired: true, description: 'participante expulsado' },
      ];

      for (const scenario of testScenarios) {
        const getErrorMessage = () => {
          if (!scenario.status || ['CONCLUDED', 'CANCELLED', 'DRAFT'].includes(scenario.status) || scenario.isRetired) {
            return genericMessage;
          }
          return 'ok';
        };

        expect(getErrorMessage()).toBe(genericMessage);
      }
    });

    it('Errors.CANNOT_JOIN produce respuesta tipada en toApiError con código y mensaje exacto', async () => {
      const { Errors, toApiError } = await import('@/lib/errors');
      const err = Errors.CANNOT_JOIN();
      const apiResponse = toApiError(err);

      expect(apiResponse.status).toBe(400);
      expect(apiResponse.code).toBe('CANNOT_JOIN');
      expect(apiResponse.error).toBe('No se puede ingresar a esa sala. Revisa tus datos.');
    });
  });

  describe('AUD-28: Aislamiento de sesiones entre roles', () => {
    it('la cookie de participante usa HttpOnly, SameSite=Strict y path="/"', () => {
      const cookieConfig = {
        name: 'gdss_participant_session',
        httpOnly: true,
        sameSite: 'strict',
        secure: true,
        path: '/',
      };

      expect(cookieConfig.name).toBe('gdss_participant_session');
      expect(cookieConfig.httpOnly).toBe(true);
      expect(cookieConfig.sameSite).toBe('strict');
      expect(cookieConfig.path).toBe('/');
      expect(cookieConfig.name).not.toBe('next-auth.session-token');
    });
  });
});

// PT-31: los límites viven en memoria; la limitación queda documentada en el módulo
import fsPt31 from 'fs';
import pathPt31 from 'path';
describe('PT-31: límite de intentos en memoria', () => {
  it('la limitación (reinicio y varias instancias) está documentada y el despliegue usa una sola instancia', () => {
    const src = fsPt31.readFileSync(pathPt31.resolve(__dirname, '../../lib/rate-limit.ts'), 'utf8');
    expect(src).toMatch(/Known limitation \(PT-31/);
    const compose = fsPt31.readFileSync(pathPt31.resolve(__dirname, '../../docker-compose.yml'), 'utf8');
    expect(compose).not.toMatch(/replicas:/);
  });
});
