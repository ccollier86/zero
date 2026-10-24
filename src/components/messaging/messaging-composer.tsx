'use client';

import * as React from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import './messaging.css';

export interface MessagingComposerFile { id: string; name: string; state: 'uploading' | 'ready' | 'failed'; progress?: number }
export interface MessagingComposerProps {
  value: string; onChange: (value: string) => void; onSubmit: () => void;
  disabled?: boolean; sending?: boolean; placeholder?: string; className?: string;
  files?: readonly MessagingComposerFile[]; onAttach?: (files: readonly File[]) => void; onRemoveFile?: (id: string) => void;
  onTyping?: (text: string) => void; onStopTyping?: () => void;
  onCompositionStart?: () => void; onCompositionEnd?: (text: string) => void;
}
/** Controlled composer. Upload/acceptance is supplied by the real service owner, never faked by a timer. */
export function MessagingComposer({ value, onChange, onSubmit, disabled, sending, placeholder = 'Message…', files = [], onAttach, onRemoveFile, onTyping, onStopTyping, onCompositionStart, onCompositionEnd, className }: MessagingComposerProps) {
  const input = React.useRef<HTMLInputElement>(null), composing = React.useRef(false);
  const blocked = disabled || sending || files.some(file => file.state !== 'ready') || !value.trim() && !files.length;
  const submit = () => { if (!blocked) { onStopTyping?.(); onSubmit(); } };
  return <form data-slot="messaging-composer" className={cn('zero-messaging-composer', className)} onSubmit={event => { event.preventDefault(); submit(); }}>
    <Textarea aria-label="Message" placeholder={placeholder} value={value} disabled={disabled || sending} rows={3}
      onChange={event => { onChange(event.target.value); onTyping?.(event.target.value); }} onBlur={() => onStopTyping?.()}
      onCompositionStart={() => { composing.current = true; onCompositionStart?.(); }} onCompositionEnd={event => { composing.current = false; onTyping?.(event.currentTarget.value); onCompositionEnd?.(event.currentTarget.value); }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composing.current) { event.preventDefault(); submit(); } }} />
    {!!files.length && <ul className="zero-messaging-composer-files" aria-label="Attachments">{files.map(file => <li key={file.id}><span>{file.name}</span><small>{file.state === 'ready' ? 'Ready' : file.state === 'failed' ? 'Upload failed' : file.progress !== undefined && Number.isFinite(file.progress) ? `${Math.round(Math.min(100, Math.max(0, file.progress)))}%` : 'Uploading…'}</small>{onRemoveFile && <Button type="button" size="icon-xs" variant="ghost" disabled={disabled || sending} aria-label={`Remove ${file.name}`} onClick={() => onRemoveFile(file.id)}><X className="size-3" /></Button>}</li>)}</ul>}
    <div className="zero-messaging-composer-controls">{onAttach && <><input ref={input} type="file" multiple hidden onChange={event => { const chosen = [...(event.target.files ?? [])]; event.target.value = ''; if (chosen.length) onAttach(chosen); }} /><Button type="button" variant="ghost" size="icon-sm" disabled={disabled || sending} aria-label="Attach files" onClick={() => input.current?.click()}><Paperclip className="size-4" /></Button></>}
      <span className="zero-messaging-composer-hint">Shift + Enter for a new line</span><Button type="submit" size="sm" variant="ghost" disabled={!!blocked} aria-label={sending ? 'Sending message' : 'Send message'}><Send className="size-3.5" />{sending ? 'Sending…' : 'Send'}</Button>
    </div>
  </form>;
}
