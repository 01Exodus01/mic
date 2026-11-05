'use client';

/**
 * components/ExportDownloads.tsx
 * Downloads of the room data (plan de mejora P3): the complete export as a ZIP
 * (research or anonymized for publication).
 */

import React, { useState } from 'react';
import { Download } from 'lucide-react';

const LINK =
  'inline-flex items-center gap-2 px-3.5 py-2 rounded-[6px] border border-[#D9D5CC] bg-white hover:bg-[#EBE7DF] text-[#14171A] text-xs font-mono transition-colors';

export function publicationHref(roomId: string, includeText: boolean): string {
  return `/api/rooms/${roomId}/export/v2?mode=publication${includeText ? '&include_text=1' : ''}`;
}

export default function ExportDownloads({ roomId }: { roomId: string }) {
  const [withText, setWithText] = useState(false);

  return (
    <section className="space-y-4 pt-2">
      <div>
        <h2 className="text-sm font-semibold text-[#14171A]">Exportaciones</h2>
        <p className="text-xs text-[#5A554E] mt-0.5">
          El ZIP trae todos los archivos CSV, un diccionario de datos y un manifiesto con el hash de cada archivo.
          Las personas aparecen solo por su código ciego.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <a href={`/api/rooms/${roomId}/export/v2`} download className={LINK}>
            <Download className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Datos completos (ZIP)</span>
          </a>
          <a href={publicationHref(roomId, withText)} download className={LINK}>
            <Download className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Versión para publicar (ZIP)</span>
          </a>
        </div>
        <p className="text-xs text-[#5A554E]">
          La versión para publicar no trae fechas ni horas (solo segundos desde que abrió cada ronda), ni
          identificadores internos, ni el nombre de la sala, ni el texto de las razones.
        </p>
        <label className="flex items-start gap-2 text-xs text-[#14171A] min-h-[44px]">
          <input
            type="checkbox"
            checked={withText}
            onChange={(e) => setWithText(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#E4572E]"
          />
          <span>Incluir el texto de las razones en la versión para publicar. Márcalo solo si su publicación fue aprobada.</span>
        </label>
      </div>
    </section>
  );
}
