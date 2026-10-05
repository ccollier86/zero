'use client';

import { GripVertical } from 'lucide-react';
import { Group, Panel, Separator, type GroupProps, type PanelProps, type SeparatorProps } from 'react-resizable-panels';
import { cn } from '#zero/lib/utils';

/** Standard shadcn-style composition; the upstream library owns resize and ARIA. */
function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return <Group data-slot="resizable-panel-group"
    className={cn('flex h-full min-h-0 w-full min-w-0', className)} {...props} />;
}

function ResizablePanel(props: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({ withHandle, className, ...props }: SeparatorProps & { withHandle?: boolean }) {
  return <Separator data-slot="resizable-handle"
    className={cn('relative flex w-px items-center justify-center bg-border outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 focus-visible:ring-2 focus-visible:ring-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>span]:rotate-90', className)}
    {...props}>
    {withHandle && <span aria-hidden="true" className="z-10 flex h-6 w-3 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground"><GripVertical className="size-3" /></span>}
  </Separator>;
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
