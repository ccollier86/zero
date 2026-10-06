'use client';

/**
 * Owns hover-only hints for collapsed desktop sidebar controls. Reuses Zero's
 * public tooltip for positioning; does not own navigation or highlight effects.
 */
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#zero/components/tooltip';
import { HighlightItem } from '#zero/components/animate-ui/primitives/effects/highlight';
import { cn } from '#zero/lib/utils';

/** Keep the actual control mounted while collapse/mobile state changes. */
export function CollapsedSidebarTooltip({
  children,
  enabled,
  tooltip,
  activeClassName,
}: {
  children: React.ReactElement;
  enabled: boolean;
  tooltip: React.ComponentProps<typeof TooltipContent>;
  activeClassName: string;
}) {
  const [open, setOpen] = React.useState(false);
  const hovering = React.useRef(false);
  const dismissed = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) {
      hovering.current = false;
      dismissed.current = false;
      setOpen(false);
    }
  }, [enabled]);

  function dismiss() {
    dismissed.current = true;
    setOpen(false);
  }

  return (
    <Tooltip
      open={enabled && open}
      onOpenChange={(nextOpen) => {
        // Radix also requests opening on focus. Sidebar labels are hover-only:
        // clicking/focus restoration must never leave a persistent hint behind.
        setOpen(nextOpen && enabled && hovering.current && !dismissed.current);
      }}
    >
      <HighlightItem activeClassName={activeClassName}>
        <TooltipTrigger
          asChild
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            hovering.current = true;
            dismissed.current = false;
          }}
          onPointerLeave={() => {
            hovering.current = false;
            dismissed.current = false;
            setOpen(false);
          }}
          onPointerDown={dismiss}
          onClick={dismiss}
        >
          {children}
        </TooltipTrigger>
      </HighlightItem>
      {enabled ? (
        <TooltipContent
          side="right"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          hideWhenDetached
          {...tooltip}
          onEscapeKeyDown={(event) => {
            tooltip.onEscapeKeyDown?.(event);
            if (!event.defaultPrevented) dismiss();
          }}
          className={cn('pointer-events-none', tooltip.className)}
        />
      ) : null}
    </Tooltip>
  );
}
