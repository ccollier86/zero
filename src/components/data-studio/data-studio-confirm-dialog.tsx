'use client';

/** Composes existing Dialog controls around one awaited, lifetime-fenced confirmation. */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../animate-ui/components/radix/dialog';
import { Button } from '../ui/button';
import { dataStudioDialogErrorMessage } from './data-studio-dialog-field';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';

export interface DataStudioConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly busy?: boolean;
  readonly destructive?: boolean;
  /** Distinguish record/action replacements without relying on display text. */
  readonly operationKey?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => Promise<unknown>;
}

export function DataStudioConfirmDialog(props: DataStudioConfirmDialogProps) {
  const close = React.useRef<(() => void) | null>(null);
  return <Dialog open={props.open} onOpenChange={next => next ? props.onOpenChange(true) : close.current?.()}>
    {props.open && <ConfirmationSession key={props.operationKey ?? props.title + props.description}
      {...props} closeRef={close} />}
  </Dialog>;
}

function ConfirmationSession({ closeRef, ...props }: DataStudioConfirmDialogProps & { closeRef: React.RefObject<(() => void) | null> }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false), [accepted, setAccepted] = React.useState(false);
  const mounted = React.useRef(true), inFlight = React.useRef(false), done = React.useRef(false);
  const current = React.useRef(props); current.current = props;
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const notifyClose = () => {
    if (!mounted.current) return;
    try { current.current.onOpenChange(false); }
    catch { emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, { metadata: { surface: 'confirmation', stage: 'accepted-close' } }); }
  };
  const requestClose = () => { if (mounted.current && !current.current.busy && !inFlight.current) notifyClose(); };
  closeRef.current = requestClose;
  React.useEffect(() => {
    const request = requestClose; closeRef.current = request;
    return () => { if (closeRef.current === request) closeRef.current = null; };
  }, [closeRef, requestClose]);
  const confirm = async () => {
    if (!mounted.current || current.current.busy || inFlight.current || done.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      await current.current.onConfirm();
      if (mounted.current) { done.current = true; setAccepted(true); }
      notifyClose();
    } catch (cause) {
      if (mounted.current) {
        setError(dataStudioDialogErrorMessage(cause));
        emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, { metadata: { surface: 'confirmation', stage: 'confirm' } });
      }
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const blocked = Boolean(props.busy) || pending;
  return <DialogContent>
    <DialogHeader className="pr-10"><DialogTitle>{props.title}</DialogTitle><DialogDescription>{props.description}</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {accepted && <p role="status" className="text-xs text-muted-foreground">Action completed successfully.</p>}
    <DialogFooter>
      <Button type="button" variant="outline" disabled={blocked} onClick={requestClose}>{accepted ? 'Close' : 'Cancel'}</Button>
      <Button type="button" variant={props.destructive ? 'destructive' : 'default'} disabled={blocked || accepted}
        onClick={() => { void confirm(); }}>{pending ? 'Working…' : accepted ? 'Completed' : props.confirmLabel}</Button>
    </DialogFooter>
  </DialogContent>;
}
