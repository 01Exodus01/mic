/**
 * components/ParticipantIdentity.tsx
 * "Conectado como Ana" on the participant's screens (rooms with names), or
 * "Conectado como participante" in rooms with a list. The blind code
 * ("Participante 07") is not shown on screen: it only identifies people in the data.
 */

import React from 'react';

export default function ParticipantIdentity({ displayName }: { displayName?: string | null }) {
  return (
    <span className="text-[#14171A]/80">
      Conectado como{' '}
      {displayName ? <strong className="font-semibold text-[#14171A]">{displayName}</strong> : 'participante'}
    </span>
  );
}
