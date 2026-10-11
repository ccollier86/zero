'use client';

/** Compact source-format selector with the editor's shared magnetic pill; the narrow variant reuses Zero's morph Select. */
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DOCUMENT_FORMATS, DOCUMENT_FORMAT_LABELS } from './document-source';
import type { DocumentFormat } from './document.types';

export function DocumentFormatControl({ format, disabled, onChange }: { format: DocumentFormat; disabled: boolean; onChange: (format: DocumentFormat) => void }) {
  const group = React.useRef<HTMLDivElement>(null), pill = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const element = group.current; if (!element) return;
    const paint = () => { const button = element.querySelector<HTMLButtonElement>(`[data-source-format="${format}"]`);
      if (pill.current && button) { pill.current.style.transform = `translateX(${button.offsetLeft}px)`; pill.current.style.width = `${button.offsetWidth}px`; } };
    paint(); const observer = new ResizeObserver(paint); observer.observe(element); return () => observer.disconnect();
  }, [format]);
  return <div className="zero-document-formats">
    <div ref={group} className="zero-document-format-segment" role="group" aria-label="Source format" onKeyDown={event => {
      if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = DOCUMENT_FORMATS.indexOf(format), next = event.key === 'Home' ? DOCUMENT_FORMATS[0] : event.key === 'End' ? DOCUMENT_FORMATS.at(-1)!
        : DOCUMENT_FORMATS[(index + (event.key === 'ArrowLeft' ? -1 : 1) + DOCUMENT_FORMATS.length) % DOCUMENT_FORMATS.length]!;
      onChange(next); group.current?.querySelector<HTMLButtonElement>(`[data-source-format="${next}"]`)?.focus();
    }}><span ref={pill} className="zero-document-format-pill" aria-hidden="true" />
      {DOCUMENT_FORMATS.map(item => <button key={item} type="button" data-source-format={item} aria-pressed={format === item}
        tabIndex={format === item ? 0 : -1} disabled={disabled} onClick={() => onChange(item)}>{DOCUMENT_FORMAT_LABELS[item]}</button>)}
    </div>
    <div className="zero-document-format-select"><Select value={format} disabled={disabled} onValueChange={value => onChange(value as DocumentFormat)}>
      <SelectTrigger aria-label="Source format"><SelectValue /></SelectTrigger>
      <SelectContent>{DOCUMENT_FORMATS.map(item => <SelectItem key={item} value={item}>{DOCUMENT_FORMAT_LABELS[item]}</SelectItem>)}</SelectContent>
    </Select></div>
  </div>;
}
