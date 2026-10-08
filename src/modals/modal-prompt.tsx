'use client';

/** Single-field prompts use the standard native-form shell; caller validation remains explicit. */
import * as React from 'react';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import type { ModalDescriptor, ModalContext, ModalDecisionOptions } from './modal-system.types';

export interface ModalPromptOptions extends Omit<ModalDecisionOptions, 'holdToConfirm' | 'holdDuration'> {
  readonly label?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly validate?: (value: string) => string | null | Promise<string | null>;
}

function PromptField({ options, context, read }: {
  options: ModalPromptOptions; context: ModalContext<string>; read: React.MutableRefObject<string>;
}) {
  const [value,setValue] = React.useState(options.value ?? '');
  const id=React.useId();
  read.current = value;
  return <form id={`zero-prompt-form-${context.id}`} className="space-y-2">
    <Label htmlFor={id}>{options.label ?? 'Name'}</Label>
    <Input id={id} value={value} required={options.required} placeholder={options.placeholder} autoComplete="off"
      onChange={event => { setValue(event.target.value); context.setDirty(event.target.value !== (options.value ?? '')); }} />
  </form>;
}

/** Internal factory receives no manager; its callbacks are admitted/fenced by the shared kernel. */
export function createModalPromptDescriptor(options: ModalPromptOptions): ModalDescriptor<string> {
  const read = { current: options.value ?? '' };
  return { ...options, size:'sm', guard:false,
    body:context => <PromptField options={options} context={context} read={read} />,
    actions:[{ id:'cancel',label:options.cancelLabel ?? 'Cancel',role:'cancel' },
      { id:'submit',label:options.confirmLabel ?? 'Save',variant:'primary',submit:true,onClick:async context => {
        const value=read.current.trim();
        const problem=await options.validate?.(value);
        if(context.signal.aborted) return false;
        if(problem || options.required && !value) { context.setError(problem || 'Enter a value.'); return false; }
        return value;
      } }],
  };
}
