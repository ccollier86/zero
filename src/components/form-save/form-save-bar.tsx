'use client';

/** Compact opt-in save presentation; shared form/controller owns draft and acknowledged outcomes. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { UseFormSaveReturn } from '../../hooks/use-form-save';

export interface FormSaveBarProps {
  readonly controller: UseFormSaveReturn;
  readonly placement?: 'floating' | 'inline';
  readonly saveLabel?: string;
  readonly discardLabel?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Floating mode includes a flow spacer; place once after the page form, never over its last field. */
export function FormSaveBar({ controller, placement = 'floating', saveLabel = 'Save changes',
  discardLabel = 'Discard', className, style }: FormSaveBarProps) {
  const visible = controller.isDirty || controller.isSaving || Boolean(controller.error);
  const barRef = useRef<HTMLElement>(null);
  const [reserve, setReserve] = useState(0);
  useEffect(() => {
    if (!visible || placement !== 'floating') return;
    const element = barRef.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setReserve(Math.ceil(bounds.height + Math.max(0, window.innerHeight - bounds.bottom)));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [placement, visible]);
  if (!visible) return null;
  return <>
    {placement === 'floating' && <div className="form-save-bar__spacer" aria-hidden="true"
      style={reserve ? { minHeight: reserve } : undefined} />}
    <section ref={barRef} data-slot="form-save-bar" data-placement={placement}
      aria-label="Unsaved changes" aria-busy={controller.isSaving || undefined}
      className={cn('form-save-bar', className)} style={style}>
      <div className="form-save-bar__copy">
        <span role="status">{controller.isSaving ? 'Saving your changes…' : 'You have unsaved changes.'}</span>
        {controller.error && <p role="alert" className="form-save-bar__error">{controller.error}</p>}
      </div>
      <div className="form-save-bar__actions">
        <Button type="button" size="sm" variant="ghost" disabled={controller.isSaving}
          onClick={() => { controller.discard(); }}><X aria-hidden="true" />{discardLabel}</Button>
        <Button type="button" size="sm" disabled={controller.isSaving}
          onClick={() => { void controller.save(); }}>
          {controller.isSaving ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Check aria-hidden="true" />}
          {controller.isSaving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </section>
  </>;
}
