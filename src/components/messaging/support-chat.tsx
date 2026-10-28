'use client';
/** Native public website organism. Uses the same keyed transcript, composer, file stages and exact-send reconciliation as staff messaging. */
import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from '../animate-ui/icons/message-circle';
import { Button } from '../ui/button';
import { ModalManager, modals } from '../../modals';
import { useModalHostPresent } from '../../modals/modal-host-context';
import { cn } from '../../lib/utils';
import { createSupportChatClient, forgetExpiredSupportChat, supportWorkspaceSource, type SupportChatClient } from '../../messaging/visitor-client';
import { MessagingWorkspace } from './messaging-workspace';
import { useSupportTyping } from './use-support-typing';
import './messaging.css';
export interface SupportChatProps { entry: string; className?: string; title?: string; description?: string; mode?: 'human' | 'assistant'; resume?: boolean }
export function SupportChat(props: SupportChatProps) {
  const hosted = useModalHostPresent();
  return hosted ? <CustomerChat key={props.entry} {...props} /> : <ModalManager><CustomerChat key={props.entry} {...props} /></ModalManager>;
}
function CustomerChat({ entry, className, title = 'How can we help?', description = 'Start a private conversation with support.', mode, resume = true }: SupportChatProps) {
  const [client, setClient] = useState<SupportChatClient | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), pending = useRef<AbortController | null>(null), current = useRef<SupportChatClient | null>(null);
  const ending = useRef<{ client: SupportChatClient; requestId: string } | null>(null);
  const typing = useSupportTyping(client);
  const connect = async (resumeOnly = false) => {
    if (pending.current) return;
    const abort = pending.current = new AbortController(), epoch = generation.current; setBusy(true);
    try {
      const session = await createSupportChatClient(entry, { mode, resumeOnly, signal: abort.signal });
      if (abort.signal.aborted || epoch !== generation.current) { session.clear(); return; }
      current.current?.clear(); current.current = session; setClient(session); setError(null);
    } catch (failure) {
      if (!abort.signal.aborted && epoch === generation.current) setError(resumeOnly && failure && typeof failure === 'object' && 'status' in failure && failure.status === 403 ? null : 'Support could not connect. Retry, or explicitly forget an expired chat before starting a new one.');
    } finally { if (pending.current === abort) { pending.current = null; if (epoch === generation.current) setBusy(false); } }
  };
  useEffect(() => { if (resume) void connect(true); return () => { generation.current++; pending.current?.abort(); pending.current = null; current.current?.clear(); current.current = null; }; }, []);
  useEffect(() => client?.subscribe(() => { if (current.current === client) { current.current = null; setClient(null); setError('This support session ended. Its retained conversation was not deleted.'); } }), [client]);
  const end = async (trigger: HTMLElement) => {
    if (!client || busy || !await modals.confirm({ title: 'End this chat session?', description: 'You will lose access from this visitor session. Support retains the conversation; this does not erase messages or prove an unconfirmed send failed.', confirmLabel: 'End session', trigger })) return;
    setBusy(true);
    const intent = ending.current?.client === client ? ending.current : { client, requestId: crypto.randomUUID() }; ending.current = intent;
    try { await client.end({ requestId: intent.requestId }); ending.current = null; setClient(null); }
    catch { setError('The end-session result is unconfirmed. Reconnect or explicitly retry ending this same session.'); }
    finally { setBusy(false); }
  };
  const forget = async (trigger: HTMLElement) => {
    if (busy || !await modals.confirm({ title: 'Forget an expired chat?', description: 'This only clears an expired or revoked visitor cookie. It does not delete retained messages, reconnect you to older history or replace a healthy session.', confirmLabel: 'Forget expired chat', trigger })) return;
    setBusy(true); const epoch = generation.current;
    try { await forgetExpiredSupportChat(entry); if (epoch === generation.current) { setError(null); setBusy(false); await connect(); } }
    catch { if (epoch === generation.current) setError('The chat could not be forgotten. Try reconnecting; an active session must be ended from its own controls.'); }
    finally { if (epoch === generation.current) setBusy(false); }
  };
  return <section data-slot="support-chat" className={cn('zero-messaging-support-chat', className)} aria-label="Customer support chat">
    {client?.active ? <><MessagingWorkspace source={supportWorkspaceSource(client)} userId={client.userId} scopeKey={client.scopeKey} conversationId={client.conversationId} layout="conversation" nativeTyping={false} externalTyping={typing} conversationOptions={false}
      headerActions={() => <Button size="xs" variant="ghost" disabled={busy} onClick={event => { void end(event.currentTarget); }}>End chat</Button>} />{error && <p role="alert" className="zero-messaging-workspace-notice">{error}</p>}</>
      : <div className="zero-messaging-workspace-empty"><MessageCircle aria-hidden="true" className="size-7" /><h2>{title}</h2><p>{description}</p>
        {error && <p role="alert" className="zero-messaging-workspace-notice">{error}</p>}<Button disabled={busy} onClick={() => { void connect(); }}>{busy ? 'Connecting…' : error ? 'Reconnect to support' : 'Start a conversation'}</Button>
        {error && <Button size="sm" variant="ghost" disabled={busy} onClick={event => { void forget(event.currentTarget); }}>Forget expired chat</Button>}
        <p className="zero-messaging-workspace-hint">This browser session is temporary. Do not send passwords or payment-card details.</p></div>}
  </section>;
}
