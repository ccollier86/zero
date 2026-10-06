'use client';

/** Zero action controls over one ink/history API; Save awaits app acceptance, not pointer events. */
import * as React from 'react';
import { Eraser, Undo2, Redo2, Save, LoaderCircle } from 'lucide-react';
import { Button, type ButtonProps } from '../ui/button';
import { useSignaturePad, useSignaturePadConfig } from './signature-pad-context';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import type { SignaturePadExportOptions, SignaturePadFormat, SignaturePadStroke } from './signature-pad.types';

type ControlProps = ButtonProps;

/** Clear is undoable; focus returns to the drawing area if the action disables its button. */
export function SignaturePadClear({ children, onClick, disabled, ...props }: ControlProps) {
  const api = useSignaturePad(), config = useSignaturePadConfig('SignaturePadClear');
  return <Button type="button" variant="outline" size="icon-sm" aria-label={children === undefined ? 'Clear signature' : undefined}
    data-slot="signature-pad-clear" {...props} disabled={disabled || api.isEmpty || !config.interactive || api.isDrawing}
    onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) { api.clear(); api.focus(); } }}>
    {children ?? <Eraser aria-hidden="true" />}
  </Button>;
}

/** Undo one accepted edit, including clear; never changes another pad or an input field. */
export function SignaturePadUndo({ children, onClick, disabled, ...props }: ControlProps) {
  const api = useSignaturePad(), config = useSignaturePadConfig('SignaturePadUndo');
  return <Button type="button" variant="outline" size="icon-sm" aria-label={children === undefined ? 'Undo' : undefined}
    data-slot="signature-pad-undo" {...props} disabled={disabled || !api.canUndo || !config.interactive || api.isDrawing}
    onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) { api.undo(); api.focus(); } }}>
    {children ?? <Undo2 aria-hidden="true" />}
  </Button>;
}

/** Redo the latest undone edit until a new accepted stroke invalidates redo history. */
export function SignaturePadRedo({ children, onClick, disabled, ...props }: ControlProps) {
  const api = useSignaturePad(), config = useSignaturePadConfig('SignaturePadRedo');
  return <Button type="button" variant="outline" size="icon-sm" aria-label={children === undefined ? 'Redo' : undefined}
    data-slot="signature-pad-redo" {...props} disabled={disabled || !api.canRedo || !config.interactive || api.isDrawing}
    onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) { api.redo(); api.focus(); } }}>
    {children ?? <Redo2 aria-hidden="true" />}
  </Button>;
}

/** A save callback owns persistence; the control keeps its exact immutable draft locked while awaiting it. */
export interface SignaturePadSaveProps extends ControlProps {
  format?: SignaturePadFormat;
  options?: SignaturePadExportOptions;
  /** False declines this draft without success feedback; rejection is a failed save. */
  onSave?: (value: string, strokes: readonly SignaturePadStroke[]) => void | false | Promise<void | false>;
  /** Compositions may present their own receipt/error instead of duplicate feedback. */
  showFeedback?: boolean;
}

/** Prevent duplicate saves and stale completion feedback; no SVG, signer data or errors enter telemetry. */
export function SignaturePadSave({ format = 'svg', options, onSave, showFeedback = true, children, onClick, disabled, ...props }: SignaturePadSaveProps) {
  const api = useSignaturePad(), config = useSignaturePadConfig('SignaturePadSave');
  const [pending, setPending] = React.useState(false), [result, setResult] = React.useState<'saved' | 'failed' | null>(null);
  const current = React.useRef({ api, config }); current.current = { api, config };
  const mounted = React.useRef(true), active = React.useRef(false), intent = React.useRef(0);
  const releaseLock = React.useRef<(() => void) | null>(null);
  React.useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; intent.current++; releaseLock.current?.(); releaseLock.current = null;
  }; }, []);
  React.useEffect(() => {
    intent.current++; active.current = false; setPending(false); setResult(null);
    releaseLock.current?.(); releaseLock.current = null;
  }, [config.epoch]);
  const save = async () => {
    const source = current.current;
    if (active.current || !source.config.interactive || source.api.isEmpty || source.api.isDrawing || !onSave) return;
    const attempt = ++intent.current, owner = source.config.epoch;
    active.current = true; setPending(true); setResult(null);
    const release = source.config.lockInteractions();
    releaseLock.current = release;
    const isCurrent = () => mounted.current && attempt === intent.current && owner === current.current.config.epoch;
    try {
      const strokes = source.api.strokes;
      const value = source.api.serialize(format, options);
      const accepted = await onSave(value, strokes);
      if (isCurrent() && accepted !== false) setResult('saved');
    } catch {
      if (isCurrent()) {
        setResult('failed');
        emitFrontendCode(OBS_CODES.FRONTEND_SIGNATURE_PAD_SAVE_FAILED, { metadata: { operation: 'save' } });
      }
    } finally {
      release();
      if (releaseLock.current === release) releaseLock.current = null;
      if (isCurrent()) { active.current = false; setPending(false); }
    }
  };
  return <>
    <Button type="button" variant="outline" size="icon-sm" aria-label={children === undefined ? 'Save signature' : undefined}
      data-slot="signature-pad-save" {...props} aria-busy={pending || undefined}
      disabled={disabled || !onSave || api.isEmpty || api.isDrawing || !config.interactive || pending}
      onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) void save(); }}>
      {pending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
      {children ?? (!pending && <Save aria-hidden="true" />)}
    </Button>
    {showFeedback && result && <span role={result === 'failed' ? 'alert' : 'status'}
      className={result === 'failed' ? 'max-w-40 text-xs text-destructive' : 'sr-only'}>
      {result === 'failed' ? 'Unable to save. Please try again.' : 'Signature accepted by the save callback.'}
    </span>}
  </>;
}
