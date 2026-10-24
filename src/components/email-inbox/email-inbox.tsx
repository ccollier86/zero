'use client';
import * as React from 'react';
import { AlertCircle, ArrowLeft, FilePenLine, Mail, ShieldCheck, X } from 'lucide-react';
import { Button } from '../ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import { useListDetailPanels } from '../ui/use-list-detail-panels';
import { TooltipProvider } from '../tooltip';
import { ModalManager } from '../../modals';
import { useModalHostPresent } from '../../modals/modal-host-context';
import { cn } from '../../lib/utils';
import { EmailComposer } from './email-composer';
import { EmailFolderNav, EmailMailboxSwitcher, EmailMessageList, EmailReader } from './email-inbox-parts';
import { useEmailInbox, type UseEmailInboxOptions } from './use-email-inbox';
import { initialEmailInboxState, type EmailInboxController } from './email-inbox-controller';
import './email-inbox.css';

export interface EmailInboxProps extends UseEmailInboxOptions {
  className?: string;
  mailboxSwitcher?: boolean;
  resizable?: boolean;
  /** Extra app-owned toolbar content. It does not replace mail authority or transport. */
  toolbar?: React.ReactNode;
}
/** Ready-to-use, optional Zero email workspace. AppShell remains owned by the host application. */
export function EmailInbox(props: EmailInboxProps) {
  const { controller } = useEmailInbox(props);
  if (!controller) return <div className="zero-email-inbox zero-email-unavailable" role="status"><Mail className="size-6" /><h2>Email workspace</h2><p>Use AppProvider with the email inbox enabled, or supply an authorized source and scopeKey.</p></div>;
  return <EmailInboxWorkspace controller={controller} {...props} />;
}
export interface EmailInboxWorkspaceProps { controller: EmailInboxController; className?: string; mailboxSwitcher?: boolean; resizable?: boolean; toolbar?: React.ReactNode }
export function EmailInboxWorkspace(props: EmailInboxWorkspaceProps) {
  const hosted = useModalHostPresent();
  return hosted ? <Workspace {...props} /> : <div className="zero-email-host"><ModalManager><Workspace {...props} /></ModalManager></div>;
}
const SSR_STATE = initialEmailInboxState();
function Workspace({ controller, className, mailboxSwitcher = true, resizable = true, toolbar }: EmailInboxWorkspaceProps) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => SSR_STATE);
  const hasDetail = !!state.selectedId || !!state.draft, panels = useListDetailPanels('minmax(17rem, 22rem)', 'minmax(0, 1fr)', true, hasDetail);
  const [localError, setLocalError] = React.useState<string | null>(null);
  React.useEffect(() => { setLocalError(null); }, [controller, state.account?.id]);
  const onAction = (work: () => Promise<unknown>) => {
    const captured = state.account?.id; setLocalError(null);
    void work().catch(error => { if (controller.getSnapshot().account?.id === captured) setLocalError(error instanceof Error ? error.message : 'This email operation failed.'); });
  };
  const parts = { controller, state, onAction };
  return <TooltipProvider><section data-slot="email-inbox" className={cn('zero-email-inbox', className)} aria-label="Email workspace">
    {(localError || state.error) && <div role="alert" className="zero-email-alert"><AlertCircle className="size-3.5 shrink-0" /><span className="min-w-0 flex-1">{localError || state.error}</span><Button type="button" size="xs" variant="ghost" onClick={() => onAction(() => controller.retry())}>Retry</Button><Button type="button" size="icon-xs" variant="ghost" aria-label="Dismiss error" onClick={() => { setLocalError(null); controller.clearError(); }}><X className="size-3" /></Button></div>}
    {state.notice && <div role="status" className="zero-email-notice"><ShieldCheck className="size-3.5 shrink-0" /><span>{state.notice}</span></div>}
    <ResizablePanelGroup elementRef={panels.elementRef} groupRef={panels.groupRef} orientation={panels.mobile ? 'vertical' : 'horizontal'} disabled={panels.mobile || !resizable}
      onLayoutChanged={panels.onLayoutChanged} className="min-h-0 min-w-0 flex-1">
      <ResizablePanel id={panels.listId} minSize={panels.mobile ? '0%' : '17rem'} maxSize={panels.listVisible ? '100%' : '0%'} aria-hidden={!panels.listVisible} inert={!panels.listVisible} style={{ overflow: 'hidden' }}>
        <aside className="zero-email-sidebar"><div className="zero-email-mailbox"><span className="zero-email-mailbox-glyph"><Mail className="size-4" /></span><EmailMailboxSwitcher accounts={state.accounts} selected={state.account} enabled={mailboxSwitcher} onChange={id => onAction(() => controller.selectAccount(id))} />{toolbar}</div>
          <div className="zero-email-compose-launch"><Button type="button" size="sm" className="w-full" disabled={!state.account?.capabilities.send} onClick={() => onAction(() => controller.compose())}><FilePenLine className="size-3.5" />Compose</Button></div>
          <EmailFolderNav {...parts} />
          <EmailMessageList {...parts} />
          <div className="zero-email-live-status"><span data-status={state.live} />{state.live === 'connected' ? 'Live updates connected' : state.live === 'reconnecting' ? 'Reconnecting — your mail is still here' : state.live === 'connecting' ? 'Connecting live updates…' : 'Email workspace'}</div>
        </aside>
      </ResizablePanel>
      <ResizableHandle aria-label="Resize email list and reader" disabled={panels.mobile || !resizable} className={panels.mobile ? 'hidden' : 'zero-email-divider'} />
      <ResizablePanel id={panels.detailId} minSize={panels.mobile ? '0%' : '16rem'} maxSize={panels.detailShown ? '100%' : '0%'} aria-hidden={!panels.detailShown} inert={!panels.detailShown} style={{ overflow: 'hidden' }}>
        <div className="zero-email-main">
          {panels.mobile && hasDetail && <div className="zero-email-mobile-back"><Button type="button" variant="ghost" size="sm" onClick={() => onAction(async () => { if (state.draft) await controller.closeDraft(); controller.clearSelection(); })}><ArrowLeft className="size-3.5" />Back to messages</Button></div>}
          {state.draft ? <EmailComposer key={state.draft.id} {...parts} /> : <EmailReader {...parts} />}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </section></TooltipProvider>;
}
