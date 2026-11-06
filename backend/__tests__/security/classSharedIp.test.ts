/**
 * backend/__tests__/security/classSharedIp.test.ts
 * A whole class usually reaches the server from one public IP. 70 people
 * joining (PIN check, name check, join: 3 calls each) within a minute must not
 * be rate limited, while a script hammering the endpoint still is.
 */

import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '@mic/backend/rate-limit';
import { CLASS_IP_LIMIT, ROSTER_FAILS_PER_IP } from '@mic/backend/services/participant';

describe('límites por IP con una clase detrás de la misma red', () => {
  it('70 personas pasan los 3 pasos de ingreso en un minuto', () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    for (const step of ['room_query', 'nick_query', 'join']) {
      for (let person = 0; person < 70; person++) {
        expect(checkRateLimit(`${step}:${ip}`, CLASS_IP_LIMIT, 60).allowed, `${step} #${person}`).toBe(true);
      }
    }
  });

  it('un script sin pausa se corta igual', () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
    let allowed = 0;
    for (let i = 0; i < CLASS_IP_LIMIT + 50; i++) if (checkRateLimit(`join:${ip}`, CLASS_IP_LIMIT, 60).allowed) allowed++;
    expect(allowed).toBe(CLASS_IP_LIMIT);
  });

  it('los códigos mal escritos de una clase no bloquean la sala enseguida', () => {
    // Up to 2 typos per person for 70 people before the IP is locked for that room
    expect(ROSTER_FAILS_PER_IP).toBeGreaterThanOrEqual(140);
  });
});
