'use client';
import { useState } from 'react';
// The compact overflow/ellipsis glyph is not in Zero's current icon catalog.
import { Ellipsis } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { MESSAGING_REACTIONS, type DurableMessage } from '../../messaging/contracts';
import { modals } from '../../modals';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';

/** Ordinary native mutations, never optimistic deletion or delivery claims. */
export function WorkspaceMessageActions({ message, controller }: { message: DurableMessage; controller: MessagingWorkspaceController }) {
  const [open, setOpen] = useState(false), [edit, setEdit] = useState<{ text: string; revision: number } | null>(null);
  const state = controller.getSnapshot(), own = message.authorKind === 'user' && message.authorId === controller.userId;
  const busy = !!state.command && state.command.phase !== 'rejected';
  const update = async (action: 'reaction' | 'edit', text: string, selected = false) => {
    await controller.changeMessage(action === 'edit' && edit ? { ...message, revision: edit.revision } : message, action, text, selected);
    if (controller.current() && !controller.getSnapshot().command) { setOpen(false); setEdit(null); }
  };
  const remove = async (trigger: HTMLElement) => {
    const captured = message;
    if (!await modals.confirm({ title: 'Remove message?', description: 'The message is replaced with a removal marker. This does not recall an already delivered external message.',
      confirmLabel: 'Remove message', variant: 'destructive', trigger })) return;
    if (controller.current() && controller.getSnapshot().selectedId === captured.conversationId) {
      setOpen(false); await controller.changeMessage(captured, 'remove', '');
    }
  };
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setEdit(null); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Message options" disabled={busy}><Ellipsis /></Button></PopoverTrigger>
    <PopoverContent align={own ? 'end' : 'start'} className="zero-messaging-message-actions" aria-label="Message actions">
      {edit ? <><Textarea aria-label="Edit message" value={edit.text} maxLength={state.capabilities?.maxMessageLength ?? 20000} disabled={busy}
        onChange={event => setEdit({ ...edit, text: event.target.value })} />
        <div className="zero-messaging-workspace-tools"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEdit(null)}>Cancel edit</Button>
          <Button size="sm" disabled={busy || !edit.text.trim()} onClick={() => { void update('edit', edit.text); }}>Save message</Button></div></>
        : <><div className="zero-messaging-message-reaction-picker" role="group" aria-label="Choose reaction">{MESSAGING_REACTIONS.map(emoji => {
          const selected = message.reactions.some(row => row.emoji === emoji && row.selected);
          return <Button key={emoji} size="icon-sm" variant={selected ? 'secondary' : 'ghost'} aria-label={`React ${emoji}`} aria-pressed={selected} disabled={busy}
            onClick={() => { void update('reaction', emoji, !selected); }}>{emoji}</Button>;
        })}</div>
          {own && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEdit({ text: message.text, revision: message.revision })}>Edit message</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={event => { void remove(event.currentTarget); }}>Remove message</Button></>}
        </>}
      {state.command?.error && <p role="alert" className="zero-messaging-workspace-hint">{state.command.error}</p>}
    </PopoverContent>
  </Popover>;
}
