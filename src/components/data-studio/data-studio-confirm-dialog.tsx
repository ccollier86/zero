'use client';

/**
 * data-studio-confirm-dialog.tsx
 *
 * Reusable async confirmation boundary for destructive Data Studio actions.
 */

import * as React from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../animate-ui/components/radix/dialog';
import { Button } from '../ui/button';
import { dataStudioDialogErrorMessage } from './data-studio-dialog-field';

export interface DataStudioConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly busy?: boolean;
  readonly destructive?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => Promise<unknown>;
}

export function DataStudioConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  destructive = false,
  onOpenChange,
  onConfirm,
}: DataStudioConfirmDialogProps) {
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => {
              setError(null);
              void onConfirm()
                .then(() => onOpenChange(false))
                .catch((cause) => setError(dataStudioDialogErrorMessage(cause)));
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
