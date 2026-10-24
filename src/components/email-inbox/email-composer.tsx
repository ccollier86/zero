'use client';
import * as React from 'react';
import { Check, ChevronDown, LoaderCircle, Paperclip, Send, Trash2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { modals } from '../../modals';
import type { EmailComposeValue } from '../../email/inbox/contracts';
import { EmailIconButton, type EmailInboxPartProps } from './email-inbox-parts';

const RichText = React.lazy(async () => ({ default: (await import('./email-rich-text-input')).EmailRichTextInput }));
const ADDRESS = /^[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+$/;
export interface EmailRecipientFieldProps { label: string; value: readonly string[]; onChange: (value: string[]) => void; disabled?: boolean; draft?: string; onDraftChange?: (value: string) => void }
export function EmailRecipientField({ label, value, onChange, disabled, draft, onDraftChange }: EmailRecipientFieldProps) {
  const [local, setLocal] = React.useState(''), [error, setError] = React.useState(''); const id = React.useId();
  const pending = draft ?? local, setPending = (next: string) => { setLocal(next); onDraftChange?.(next); };
  const commit = () => {
    const values = pending.split(/[,;\n]/).map(address => address.trim()).filter(Boolean);
    if (!values.length) return;
    if (values.some(address => !ADDRESS.test(address) || address.length > 320) || values.length + value.length > 100) { setError('Enter valid email addresses, separated by commas.'); return; }
    onChange([...new Set([...value, ...values])]); setPending(''); setError('');
  };
  return <div className="zero-email-recipient-field"><label htmlFor={id}>{label}</label><div className="min-w-0 flex-1"><div className="zero-email-recipient-values">
    {value.map(address => <span className="zero-email-recipient" key={address}>{address}<button type="button" aria-label={`Remove ${address} from ${label}`} disabled={disabled} onClick={() => onChange(value.filter(item => item !== address))}><X aria-hidden="true" className="size-3" /></button></span>)}
    <input id={id} name={`pending-${label.toLowerCase()}`} data-email-recipient={label.toLowerCase()} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="email"
      placeholder={value.length ? '' : 'name@example.com'} value={pending} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined}
      onChange={event => { const next = event.target.value; setPending(next); if (!next) setError(''); }} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === 'Tab' && pending) { if (event.key !== 'Tab') event.preventDefault(); commit(); }
        if (event.key === 'Backspace' && !pending && value.length) onChange(value.slice(0, -1)); }} />
  </div>{error && <p id={id + '-error'} role="alert" className="py-1 text-[11px] text-destructive">{error}</p>}</div></div>;
}

export function EmailComposer({ controller, state, onAction }: EmailInboxPartProps) {
  const draft = state.draft!, account = state.account!, [expanded, setExpanded] = React.useState(!!draft.value.cc.length || !!draft.value.bcc.length || !!draft.value.recipientDrafts?.cc || !!draft.value.recipientDrafts?.bcc);
  const [attaching, setAttaching] = React.useState(false), [localError, setLocalError] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null), generation = React.useRef(0);
  const frozen = !account.capabilities.drafts || ['sending', 'unknown', 'conflict'].includes(draft.status), value = draft.value;
  React.useEffect(() => () => { generation.current++; }, []);
  const change = (next: Partial<EmailComposeValue>) => controller.updateDraft({ ...controller.getSnapshot().draft!.value, ...next });
  const attach = async (files: FileList) => {
    const current = generation.current; setAttaching(true); setLocalError('');
    try {
      const existing = controller.getSnapshot().draft?.value.attachments ?? [], selected = [...files];
      if (existing.length + selected.length > 20 || existing.reduce((total, file) => total + file.size, 0) + selected.reduce((total, file) => total + file.size, 0) > 15 * 1024 * 1024 || selected.some(file => file.size > 10 * 1024 * 1024)) throw new Error('Use up to 20 attachments, 10 MB per file and 15 MB in total.');
      const added = [];
      for (const file of selected) {
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        added.push({ id: crypto.randomUUID(), filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, base64: btoa(binary) });
      }
      if (generation.current === current) change({ attachments: [...(controller.getSnapshot().draft?.value.attachments ?? []), ...added] });
    } catch (error) { if (generation.current === current) setLocalError(error instanceof Error ? error.message : 'Attachment could not be loaded.'); }
    finally { if (generation.current === current) setAttaching(false); if (input.current) input.current.value = ''; }
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLocalError('');
    const form = new FormData(event.currentTarget), next = { ...controller.getSnapshot().draft!.value };
    for (const key of ['to', 'cc', 'bcc'] as const) {
      const pending = String(form.get('pending-' + key) ?? next.recipientDrafts?.[key] ?? '').split(/[,;\n]/).map(address => address.trim()).filter(Boolean);
      if (pending.some(address => !ADDRESS.test(address))) { setLocalError('Check the recipient email addresses before sending.'); return; }
      next[key] = [...new Set([...next[key], ...pending])];
    }
    next.recipientDrafts = { to: '', cc: '', bcc: '' };
    if (!next.to.length || !next.subject.trim() || !next.text.trim() && !next.html?.trim()) { setLocalError('Add a recipient, subject and message before sending.'); return; }
    if (draft.status !== 'unknown') controller.updateDraft(next);
    onAction(() => controller.sendDraft());
  };
  return <form className="zero-email-composer" data-slot="email-composer" onSubmit={submit} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
    <header className="zero-email-composer-heading"><span className="zero-email-compose-label">New message</span><span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
      {draft.status === 'saving' ? <><LoaderCircle className="size-3 animate-spin" />Saving…</> : draft.status === 'saved' ? <><Check className="size-3" />Draft saved</> : draft.status === 'sending' ? 'Submitting…' : draft.dirty ? 'Unsaved changes' : ''}</span>
      <EmailIconButton label="Close and keep draft" disabled={draft.status === 'sending' || draft.status === 'conflict' || attaching} onClick={() => onAction(() => controller.closeDraft())}><X className="size-4" /></EmailIconButton>
    </header>
    <ScrollArea className="min-h-0 flex-1" scrollChaining="auto"><div className="zero-email-composer-content">
      <div className="zero-email-from"><span>From</span>{account.sendAs.length > 1 ? <Select value={value.from} disabled={frozen} onValueChange={from => change({ from })}><SelectTrigger className="h-7 w-auto border-0 px-1 text-xs shadow-none"><SelectValue /></SelectTrigger><SelectContent>{account.sendAs.map(identity => <SelectItem value={identity.id} key={identity.id}>{identity.name ? `${identity.name} <${identity.address}>` : identity.address}</SelectItem>)}</SelectContent></Select>
        : <span className="text-foreground">{account.sendAs[0]?.address}</span>}<Button type="button" size="xs" variant="ghost" className="ml-auto" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Cc / Bcc<ChevronDown className="size-3" /></Button></div>
      <EmailRecipientField label="To" value={value.to} draft={value.recipientDrafts?.to ?? ''} onDraftChange={to => change({ recipientDrafts: { ...controller.getSnapshot().draft!.value.recipientDrafts, to } })} disabled={frozen} onChange={to => change({ to })} />
      {expanded && <><EmailRecipientField label="Cc" value={value.cc} draft={value.recipientDrafts?.cc ?? ''} onDraftChange={cc => change({ recipientDrafts: { ...controller.getSnapshot().draft!.value.recipientDrafts, cc } })} disabled={frozen} onChange={cc => change({ cc })} /><EmailRecipientField label="Bcc" value={value.bcc} draft={value.recipientDrafts?.bcc ?? ''} onDraftChange={bcc => change({ recipientDrafts: { ...controller.getSnapshot().draft!.value.recipientDrafts, bcc } })} disabled={frozen} onChange={bcc => change({ bcc })} /></>}
      <label className="zero-email-subject-field"><span>Subject</span><Input value={value.subject} disabled={frozen} maxLength={998} placeholder="A clear, helpful subject" onChange={event => change({ subject: event.target.value })} /></label>
      <React.Suspense fallback={<div className="min-h-56 py-6 text-xs text-muted-foreground" role="status">Opening editor…</div>}><RichText html={value.html || '<p></p>'} disabled={frozen} onChange={(html, text) => change({ html, text })} /></React.Suspense>
      {!!value.attachments.length && <div className="zero-email-compose-files" aria-label="Attachments">{value.attachments.map(file => <div className="zero-email-compose-file" key={file.id}><Paperclip className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs">{file.filename}</span><span className="text-[10px] text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span><Button type="button" size="icon-xs" variant="ghost" disabled={frozen} aria-label={`Remove attachment ${file.filename}`} onClick={() => change({ attachments: value.attachments.filter(item => item.id !== file.id) })}><X className="size-3" /></Button></div>)}</div>}
      {(localError || draft.error) && <div role="alert" className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">{localError || draft.error}
        {draft.status === 'conflict' && <Button type="button" size="xs" variant="outline" className="mt-2" onClick={() => controller.copyConflictedDraft()}>Keep my changes as a new draft</Button>}</div>}
    </div></ScrollArea>
    <footer className="zero-email-composer-footer"><Button type="submit" size="sm" disabled={!account.capabilities.send || draft.status === 'sending' || draft.status === 'conflict' || attaching}>
      {draft.status === 'sending' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{draft.status === 'unknown' ? 'Check send result' : 'Send message'}</Button>
      <input ref={input} type="file" multiple className="hidden" aria-label="Attach files" onChange={event => { if (event.target.files) void attach(event.target.files); }} />
      <EmailIconButton label="Attach files" disabled={frozen || attaching} onClick={() => input.current?.click()}>{attaching ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</EmailIconButton>
      <span className="hidden text-[10px] text-muted-foreground lg:inline">⌘ / Ctrl + Enter to send</span>
      <span className="ml-auto"><EmailIconButton label="Discard draft" disabled={frozen || attaching} onClick={event => { const trigger = event.currentTarget;
        onAction(async () => { const confirmed = await modals.confirm({ title: 'Discard this draft?', description: 'This removes the saved draft and its attachments.', confirmLabel: 'Discard draft', variant: 'destructive', trigger });
          if (confirmed && controller.getSnapshot().draft?.id === draft.id) await controller.discardDraft(); });
      }}><Trash2 className="size-3.5" /></EmailIconButton></span>
    </footer>
  </form>;
}
