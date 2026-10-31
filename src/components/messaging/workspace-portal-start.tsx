'use client';
/** Limited member entry using the same native popover, scroll treatment and magnetic menu affordance as the staff workspace. */
import { useState } from 'react';
import { Plus } from '../animate-ui/icons/plus';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger, PopoverViewport } from '../popover';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
import { WorkspaceSupportStart } from './workspace-support-start';

export function WorkspacePortalStart({ controller, state }: { controller: MessagingWorkspaceController; state: MessagingWorkspaceState }) {
  const [open, setOpen] = useState(false), [container, setContainer] = useState<HTMLDivElement | null>(null);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="sm" variant="outline"><Plus />New message</Button></PopoverTrigger>
    <PopoverContent align="end" className="zero-messaging-start" aria-label="Start a message"><h3>New message</h3>
      <PopoverViewport className="zero-messaging-start-body" style={{ maxHeight: 'min(30rem, calc(var(--radix-popover-content-available-height, 100dvh) - 4rem))' }}>
        <div ref={setContainer}><MenuActiveHighlight container={container} activeSelector="[aria-pressed=true]" hoverSelector="button:not(:disabled)" preserveSelectionFill={false} />
          <WorkspaceSupportStart controller={controller} state={state} onStarted={() => setOpen(false)} />
        </div>
        {state.command?.error && <p role="alert" className="zero-messaging-workspace-notice">{state.command.error}</p>}
        {state.command?.phase === 'unknown' && <div className="zero-messaging-workspace-tools"><Button size="xs" onClick={() => { void controller.checkCommand(); }}>Check change</Button>
          <Button size="xs" variant="outline" onClick={() => { void controller.retryCommand(); }}>Retry same change</Button></div>}
      </PopoverViewport>
    </PopoverContent></Popover>;
}
