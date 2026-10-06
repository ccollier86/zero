'use client';

/** Native form association, required feedback and cancelled-reset handling; never submits a request. */
import * as React from 'react';
import { useSignaturePad, useSignaturePadConfig } from './signature-pad-context';
import { serializeSignaturePad } from './signature-export';

/** A visually hidden text proxy participates in native constraints; a hidden input cannot. */
export function SignaturePadFormField() {
  const api = useSignaturePad(), config = useSignaturePadConfig('SignaturePadFormField');
  const input = React.useRef<HTMLInputElement | null>(null);
  const current = React.useRef({ api, config }); current.current = { api, config };
  const serialized = serializeSignaturePad(api.strokes, config.format);
  React.useEffect(() => {
    const root = input.current?.getRootNode();
    if (!root) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onReset = (event: Event) => {
      if (event.target !== input.current?.form) return;
      const owner = current.current.config.epoch;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (event.defaultPrevented || owner !== current.current.config.epoch || !input.current) return;
        current.current.api.reset();
        current.current.config.setInvalid(false);
        // A locked/controlled pad can reject reset. The proxy must still match
        // its authoritative current mark after the browser's default reset.
        input.current.value = current.current.api.serialize(current.current.config.format);
      }, 0);
      timers.add(timer);
    };
    root.addEventListener('reset', onReset, true);
    return () => { root.removeEventListener('reset', onReset, true); for (const timer of timers) clearTimeout(timer); };
  }, [config.name, config.required, config.form]);
  if (config.name === undefined && !config.required) return null;
  return <>
    <input ref={input} id={config.fieldId} type="text" name={config.name} form={config.form}
      value={serialized} onChange={() => {}} required={config.required} readOnly={api.readOnly}
      disabled={api.disabled} tabIndex={-1} aria-hidden="true" data-slot="signature-pad-field"
      className="pointer-events-none absolute bottom-0 left-1/2 size-px opacity-0"
      onFocus={api.focus} onInvalid={(event) => { event.preventDefault(); config.setInvalid(true); api.focus(); }} />
    {config.invalid && <p id={config.errorId} role="alert" className="text-xs text-destructive">Add your signature before submitting this form.</p>}
  </>;
}
