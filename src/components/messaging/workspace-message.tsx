'use client';
import { useEffect, useState } from 'react';
import type { DurableMessage } from '../../messaging/contracts';
import type { MessagingParticipant, NativeMessagingAttachmentDisplay } from '../../messaging/presentation';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import { NativeMessageBubble } from './message-bubble';
import { Button } from '../ui/button';
import { WorkspaceMessageActions } from './workspace-message-actions';
export function WorkspaceMessage({ message, controller, participant, enter = false }: { message: DurableMessage; controller: MessagingWorkspaceController; participant: MessagingParticipant; enter?: boolean }) {
  const [animateEntry] = useState(enter);
  const [files, setFiles] = useState<readonly NativeMessagingAttachmentDisplay[]>([]), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const ids = JSON.stringify(message.attachmentIds), selection = controller.getSnapshot().selectedId;
  useEffect(() => {
    const stop = new AbortController(); setFiles([]); setFailed(false);
    if (message.deleted || !message.attachmentIds.length) return () => stop.abort();
    void Promise.all(message.attachmentIds.map(id => controller.source.attachments.get(message.conversationId, id, { signal: stop.signal }))).then(values => {
      if (stop.signal.aborted || !controller.current() || controller.getSnapshot().selectedId !== selection) return;
      if (values.some(row => row.conversationId !== message.conversationId || row.messageId !== message.id || row.state !== 'ready')) throw new Error();
      setFiles(values.map(row => ({ id: row.id, conversationId: row.conversationId, name: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes })));
    }).catch(() => { if (!stop.signal.aborted && controller.current()) setFailed(true); });
    return () => stop.abort();
  }, [controller, message.id, message.conversationId, message.deleted, ids, attempt, selection]);
  const download = async (file: NativeMessagingAttachmentDisplay) => {
    try { const blob = await controller.attachment(file.id); const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = file.name; link.rel = 'noopener'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (controller.current()) setFailed(true); }
  };
  return <div className="zero-messaging-workspace-message" data-visibility={message.visibility} data-message-entry={animateEntry || undefined}>
    {message.visibility === 'staff' && <small className="zero-messaging-private-note">Private team note</small>}
    <NativeMessageBubble sequence={message.sequence} own={message.authorId === controller.userId} message={{ id: message.id, author: participant, text: message.deleted ? 'Message removed' : message.text,
      createdAt: message.createdAt, edited: !!message.editedAt, attachments: message.deleted ? [] : files, reactions: message.deleted ? [] : message.reactions,
      delivery: message.authorId === controller.userId ? 'accepted' : undefined }} onAttachment={file => { void download(file); }}
      onReaction={!message.deleted && !controller.getSnapshot().conversation?.archived && !controller.getSnapshot().command ? emoji => {
        void controller.changeMessage(message, 'reaction', emoji, !message.reactions.some(row => row.emoji === emoji && row.selected));
      } : undefined}
      actions={!message.deleted && !controller.getSnapshot().conversation?.archived ? <WorkspaceMessageActions message={message} controller={controller} /> : undefined} />
    {!failed && !message.deleted && message.attachmentIds.length > files.length && <small role="status">Loading attachments…</small>}
    {failed && <Button size="xs" variant="ghost" onClick={() => setAttempt(value => value + 1)}>Retry attachments</Button>}
  </div>;
}
