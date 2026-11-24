'use client';

/**
 * components/RoomRosterManager.tsx
 * Host panel for course-roster rooms (PT-21): add one person, paste or upload
 * a list, remove, regenerate a code. New codes are shown once, with a CSV
 * download to hand them out; on screen they are blurred until the host shows
 * one (or all), so a projected or shared screen does not give them away.
 * Shows who has joined, never what anyone voted.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, Eye, EyeOff, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import {
  addRoomMember,
  importRoomMembers,
  getRoomMembers,
  removeRoomMember,
  regenerateMemberCode,
  type IssuedMemberCode,
  type RoomMemberItem,
} from '@/app/actions/room';
import { escapeCsvField } from '@mic/backend/shared/csv';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Dialog';

/** CSV with label and code, BOM and formula-injection protection. */
export function buildCodesCsv(issued: IssuedMemberCode[]): string {
  const lines = ['label,access_code', ...issued.map((i) => `${escapeCsvField(i.label)},${escapeCsvField(i.code)}`)];
  return '﻿' + lines.join('\r\n');
}

function downloadCsv(issued: IssuedMemberCode[], roomPin: string) {
  const blob = new Blob([buildCodesCsv(issued)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `access_codes_${roomPin}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RoomRosterManager({ roomId, roomPin, readOnly = false }: { roomId: string; roomPin: string; readOnly?: boolean }) {
  const [members, setMembers] = useState<RoomMemberItem[]>([]);
  const [label, setLabel] = useState('');
  const [bulk, setBulk] = useState('');
  const [issued, setIssued] = useState<IssuedMemberCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toRemove, setToRemove] = useState<RoomMemberItem | null>(null);
  // Codes shown on screen (blurred by default); keys are `${memberId}-${code}`
  const [shown, setShown] = useState<Set<string>>(new Set());
  const codeKey = (i: IssuedMemberCode) => `${i.memberId}-${i.code}`;
  const allShown = issued.length > 0 && issued.every((i) => shown.has(codeKey(i)));
  const toggleCode = (key: string) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const load = useCallback(async () => {
    const res = await getRoomMembers(roomId);
    if (res.success && res.data) setMembers(res.data.members);
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  type RosterResult = { success: boolean; error?: string; data?: { issued?: IssuedMemberCode[] | IssuedMemberCode } | void };
  const run = async (action: () => Promise<RosterResult>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.success) {
        setError(res.error || 'No se pudo actualizar la lista.');
        return false;
      }
      const issuedNow = res.data ? res.data.issued : undefined;
      if (issuedNow) {
        const list = Array.isArray(issuedNow) ? issuedNow : [issuedNow];
        setIssued((prev) => [...prev, ...list]);
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (await run(() => importRoomMembers(roomId, text))) toast.success('Lista cargada.');
  };

  const active = members.filter((m) => !m.isRemoved);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-bold text-ink">Lista de participantes</h2>
        <p className="text-xs text-ink-2 mt-0.5">
          Cada persona entra con el PIN del grupo y su código personal. {active.length} en la lista,{' '}
          {active.filter((m) => m.joined).length} ya ingresaron.
        </p>
      </div>

      {issued.length > 0 && (
        <div className="p-4 rounded-[6px] border border-warn bg-paper space-y-2" role="status">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs font-semibold text-ink">
              Códigos nuevos. Solo se muestran ahora: descárgalos o cópialos antes de salir.
            </p>
            <button
              type="button"
              onClick={() => setShown(allShown ? new Set() : new Set(issued.map(codeKey)))}
              aria-pressed={allShown}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 rounded-[6px] border border-line bg-paper text-xs font-medium text-ink hover:bg-subtle"
            >
              {allShown ? <EyeOff className="w-3.5 h-3.5 stroke-[1.5]" /> : <Eye className="w-3.5 h-3.5 stroke-[1.5]" />}
              {allShown ? 'Ocultar todos' : 'Mostrar todos'}
            </button>
          </div>
          <ul className="text-xs font-mono divide-y divide-line max-h-72 overflow-auto">
            {issued.map((i) => {
              const key = codeKey(i);
              const visible = shown.has(key);
              return (
                <li key={key} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate font-sans text-ink">{i.label}</span>
                  <span className="relative inline-flex items-center justify-end shrink-0 min-w-[160px] min-h-[32px]">
                    <span
                      className={`text-ink font-bold tracking-wider transition-[filter] ${visible ? '' : 'blur-[5px] select-none'}`}
                      aria-hidden={!visible}
                    >
                      {i.code}
                    </span>
                    {visible ? (
                      <button
                        type="button"
                        onClick={() => toggleCode(key)}
                        className="ml-2 min-h-[32px] px-1.5 text-ink-2 hover:text-ink"
                        aria-label={`Ocultar el código de ${i.label}`}
                        title="Ocultar código"
                      >
                        <EyeOff className="w-3.5 h-3.5 stroke-[1.5]" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleCode(key)}
                        className="absolute inset-0 m-auto h-[28px] w-fit px-2.5 rounded-[4px] border border-line bg-paper/95 font-sans text-[11px] font-medium text-ink hover:bg-subtle inline-flex items-center gap-1"
                        aria-label={`Mostrar el código de ${i.label}`}
                      >
                        <Eye className="w-3.5 h-3.5 stroke-[1.5]" />
                        Mostrar código
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => downloadCsv(issued, roomPin)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-[6px] border border-line bg-paper text-xs font-medium hover:bg-subtle"
            >
              <Download className="w-4 h-4 stroke-[1.5]" />
              Descargar códigos (CSV)
            </button>
            <button
              type="button"
              onClick={() => {
                setIssued([]);
                setShown(new Set());
              }}
              className="min-h-[44px] text-xs text-ink-2 hover:text-ink"
            >
              Listo, quitar de la pantalla (no se vuelven a mostrar)
            </button>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="grid gap-4 md:grid-cols-2">
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => addRoomMember(roomId, label))) setLabel('');
            }}
          >
            <label htmlFor="roster-label" className="block text-xs font-semibold text-ink">
              Agregar una persona
            </label>
            <div className="flex gap-2">
              <input
                id="roster-label"
                value={label}
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Matrícula o usuario"
                className="flex-1 min-w-0 h-11 px-3 rounded-[6px] border border-line bg-paper text-xs focus:outline-none focus:border-brand"
              />
              <button
                type="submit"
                disabled={busy || label.trim().length === 0}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-[6px] bg-brand text-white text-xs font-semibold disabled:opacity-40"
              >
                <Plus className="w-4 h-4 stroke-[1.5]" />
                Agregar
              </button>
            </div>
          </form>

          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => importRoomMembers(roomId, bulk))) setBulk('');
            }}
          >
            <label htmlFor="roster-bulk" className="block text-xs font-semibold text-ink">
              Pegar varias (una por línea)
            </label>
            <textarea
              id="roster-bulk"
              rows={3}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              className="w-full p-2.5 rounded-[6px] border border-line bg-paper text-xs font-mono focus:outline-none focus:border-brand"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy || bulk.trim().length === 0}
                className="min-h-[44px] px-3 rounded-[6px] border border-line bg-paper text-xs font-medium hover:bg-subtle disabled:opacity-40"
              >
                Agregar la lista
              </button>
              <label className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-[6px] border border-line bg-paper text-xs font-medium hover:bg-subtle cursor-pointer">
                <Upload className="w-4 h-4 stroke-[1.5]" />
                Subir CSV
                <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
          </form>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {members.length > 0 && (
        <div className="border border-line rounded-[6px] bg-paper overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-canvas text-ink-2">
                <th className="py-2 px-3 font-medium">Persona</th>
                <th className="py-2 px-3 font-medium">Estado</th>
                {!readOnly && <th className="py-2 px-3 font-medium text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((m) => (
                <tr key={m.id} className={m.isRemoved ? 'text-ink-2' : ''}>
                  <td className="py-2 px-3 font-mono">{m.label}</td>
                  <td className="py-2 px-3">{m.isRemoved ? 'Quitada de la lista' : m.joined ? 'Ingresó' : 'No ha ingresado'}</td>
                  {!readOnly && (
                    <td className="py-1 px-3 text-right whitespace-nowrap">
                      {!m.isRemoved && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(() => regenerateMemberCode(roomId, m.id))}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1 px-2 text-ink hover:text-brand"
                            aria-label={`Regenerar código de ${m.label}`}
                          >
                            <RefreshCw className="w-4 h-4 stroke-[1.5]" />
                            <span className="hidden sm:inline">Nuevo código</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setToRemove(m)}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1 px-2 text-danger"
                            aria-label={`Quitar a ${m.label}`}
                          >
                            <Trash2 className="w-4 h-4 stroke-[1.5]" />
                            <span className="hidden sm:inline">Quitar</span>
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <DialogContent>
          <div className="space-y-4">
            <DialogTitle>¿Quitar a {toRemove?.label} de la lista?</DialogTitle>
            <DialogDescription>
              Su código dejará de funcionar. Si ya ingresó, deja de participar; sus selecciones anteriores se conservan.
            </DialogDescription>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setToRemove(null)} className="min-h-[44px] text-xs text-ink-2 hover:text-ink">
                Volver
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = toRemove;
                  setToRemove(null);
                  if (target) await run(() => removeRoomMember(roomId, target.id));
                }}
                className="min-h-[44px] px-3.5 rounded-[6px] bg-danger text-white text-xs font-semibold"
              >
                Quitar de la lista
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
