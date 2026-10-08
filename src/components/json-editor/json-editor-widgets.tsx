'use client';

/** Existing Zero controls adapted to the package's text/select slots. */
import * as React from 'react';
import type { TextEditorProps, SelectProps } from 'json-edit-react';
import { Textarea } from '../ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { cn } from '../../lib/utils';

export interface JsonTextDraftContextValue {
  readonly raw: React.RefObject<string | null>;
  readonly change: (text: string) => void;
  readonly disabled: boolean;
  readonly label: string;
  readonly density?: 'default' | 'compact';
}
export const JsonTextDraftContext = React.createContext<JsonTextDraftContextValue | null>(null);

/** No custom editor primitive or highlighting layer: this is Zero's existing Textarea. */
export function JsonTextEditor({ value, onChange, onKeyDown }: TextEditorProps) {
  const context = React.useContext(JsonTextDraftContext);
  const [text, setText] = React.useState(() => context?.raw.current ?? value);
  const input = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    input.current?.focus();
    if (context?.raw.current !== null && context?.raw.current !== undefined) onChange(context.raw.current);
    // Restore only on this slot's mount, not every controlled object re-render.
  }, []);
  const compact = context?.density === 'compact';
  return <Textarea ref={input} aria-label={context?.label ?? 'JSON text'} value={text}
    disabled={context?.disabled} spellCheck={false} rows={Math.max(compact ? 6 : 14, text.split('\n').length + 1)} wrap="off"
    style={{ overflowY: 'hidden' }}
    className={cn('resize-none font-mono text-xs leading-5', compact ? 'min-h-32' : 'min-h-64')}
    onKeyDown={onKeyDown} onChange={event => {
      const next = event.target.value; setText(next); context?.change(next); onChange(next);
    }} />;
}

export function JsonSelect({ options, value, defaultValue, onChange, onKeyDown, autoFocus, placeholder, name, className }: SelectProps) {
  const context = React.useContext(JsonTextDraftContext);
  return <Select value={value} defaultValue={defaultValue} onValueChange={onChange} disabled={context?.disabled}>
    <SelectTrigger aria-label={name ?? 'JSON value type'} onKeyDown={onKeyDown}
      autoFocus={autoFocus} className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent>{options.filter(Boolean).map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
  </Select>;
}
