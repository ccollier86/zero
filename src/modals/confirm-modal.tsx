'use client';

import { useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoldButton } from './hold-button';
import type { ModalInstance } from './modal.types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConfirmModalContentProps {
  modal: ModalInstance;
  onResult: (confirmed: boolean) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConfirmModalContent({ modal, onResult }: ConfirmModalContentProps) {
  const opts = modal.confirmOptions!;
  const isDestructive = opts.variant === 'destructive';

  const handleConfirm = useCallback(() => onResult(true), [onResult]);
  const handleCancel = useCallback(() => onResult(false), [onResult]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {isDestructive && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
        )}
        <div>
          <h2 className="text-base font-semibold text-foreground">{opts.title}</h2>
          {opts.description && (
            <p className="mt-1 text-sm text-muted-foreground">{opts.description}</p>
          )}
        </div>
      </div>

      {/* Hold-to-confirm or standard buttons */}
      {opts.holdToConfirm ? (
        <div>
          <p className="mb-3 text-xs text-muted-foreground">
            Press and hold the button below to confirm.
          </p>
          <HoldButton
            onConfirm={handleConfirm}
            holdDuration={opts.holdDuration ?? 1500}
          />
        </div>
      ) : null}

      {/* Footer */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={handleCancel}>
          {opts.cancelLabel ?? 'Cancel'}
        </Button>
        {!opts.holdToConfirm && (
          <Button
            variant={isDestructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
          >
            {opts.confirmLabel ?? 'Confirm'}
          </Button>
        )}
      </div>
    </div>
  );
}
