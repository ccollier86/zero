'use client';

/** Signature provider and local keyboard history; uses Zero layout tokens, no persistence. */
import * as React from 'react';
import { cn } from '../../lib/utils';
import { SignaturePadContext, SignaturePadConfigContext } from './signature-pad-context';
import { useSignaturePadController, validateSignaturePadOptions } from './use-signature-pad-controller';
import { SignaturePadFormField } from './signature-pad-form-field';
import type { SignaturePadProps } from './signature-pad.props';

/** Compose a drawing surface, optional toolbar and native form field in one pad. */
export function SignaturePad(props: SignaturePadProps) {
  validateSignaturePadOptions(props);
  const { api, config } = useSignaturePadController(props);
  const { value, defaultValue, onValueChange, onStrokeStart, onStrokeEnd, apiRef, scopeKey,
    color, minWidth, maxWidth, smoothing, sizing, pointerTypes, disabled, readOnly,
    name, form, required, format, children, className, onKeyDown, ...divProps } = props;
  return <SignaturePadContext.Provider value={api}><SignaturePadConfigContext.Provider value={config}>
    <div data-slot="signature-pad" data-empty={api.isEmpty || undefined} data-drawing={api.isDrawing || undefined}
      data-disabled={api.disabled || undefined} data-readonly={api.readOnly || undefined}
      className={cn('relative flex w-full min-w-0 flex-col gap-2', className)} {...divProps}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        const target = event.target as HTMLElement;
        if (event.defaultPrevented || !config.interactive || api.isDrawing ||
          target.closest('input,textarea,select,[contenteditable="true"]') || !(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.code.replace(/^Key/, '').toLowerCase();
        if (key === 'z' && !event.shiftKey && api.canUndo) { event.preventDefault(); api.undo(); api.focus(); }
        else if ((key === 'y' || key === 'z' && event.shiftKey) && api.canRedo) { event.preventDefault(); api.redo(); api.focus(); }
      }}>
      {children}<SignaturePadFormField />
    </div>
  </SignaturePadConfigContext.Provider></SignaturePadContext.Provider>;
}
