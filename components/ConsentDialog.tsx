'use client';

/**
 * components/ConsentDialog.tsx
 * Consent button: re-read the room's consent text after accepting it (PT-24).
 */

import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Dialog';

export default function ConsentDialog({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] inline-flex items-center gap-1.5 px-2 text-xs text-[#5A554E] hover:text-[#14171A]"
      >
        <FileText className="w-3.5 h-3.5 stroke-[1.5]" />
        <span>Consentimiento</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <div className="space-y-4">
            <DialogTitle>Consentimiento informado</DialogTitle>
            <DialogDescription>Este es el texto que aceptaste para participar en la sala.</DialogDescription>
            <div className="max-h-[60vh] overflow-auto text-sm text-[#14171A] leading-relaxed whitespace-pre-wrap break-words">{text}</div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-3 text-xs font-medium text-[#14171A]">
                Cerrar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
