'use client';

import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '#zero/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './resizable';
import { cn } from '#zero/lib/utils';
import { useListDetailPanels } from './use-list-detail-panels';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ListDetailLayoutProps {
  /** Left panel content (DataTable, list, etc.) */
  list: React.ReactNode;
  /** Right panel content (detail view, form, etc.) */
  detail: React.ReactNode;
  /** Bottom bar content (navigation bar, actions, etc.) */
  bottomBar?: React.ReactNode;
  /** Whether a record is selected (controls detail panel visibility on mobile) */
  hasSelection?: boolean;
  /**
   * Whether the selected detail is open on mobile. Defaults to `hasSelection`
   * for backwards compatibility. Desktop rendering is unaffected.
   */
  mobileDetailOpen?: boolean;
  /** Return from the mobile detail pane to the list pane. */
  onMobileBack?: () => void;
  /** Visible and accessible label for the mobile list return action. */
  mobileBackLabel?: string;
  /** Key for the selected record — triggers crossfade animation on change */
  selectedKey?: string;
  /** Width ratio for list panel. Default: '3fr' */
  listWidth?: string;
  /** Width ratio for detail panel. Default: '2fr' */
  detailWidth?: string;
  /** Desktop detail visibility; mobile selected-record inspection remains independent. Default: true. */
  detailVisible?: boolean;
  /** Enable a pointer/keyboard desktop separator. Existing widths apply until resized. */
  resizable?: boolean;
  className?: string;
}

// ─── Animation ──────────────────────────────────────────────────────────────

const detailVariants = {
  initial: { opacity: 0, x: 20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 25 },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.15 },
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

function ListDetailLayout({
  list,
  detail,
  bottomBar,
  hasSelection = false,
  mobileDetailOpen,
  onMobileBack,
  mobileBackLabel = 'Back to list',
  selectedKey,
  listWidth = '3fr',
  detailWidth = '2fr',
  detailVisible = true,
  resizable = false,
  className,
}: ListDetailLayoutProps) {
  const [mobileDismissed, setMobileDismissed] = React.useState(false);
  const showMobileDetail = hasSelection && (mobileDetailOpen ?? !mobileDismissed);
  const listPanelRef = React.useRef<HTMLDivElement>(null);
  const mobileBackRef = React.useRef<HTMLButtonElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const previousMobileDetailOpenRef = React.useRef(false);
  const panels = useListDetailPanels(listWidth, detailWidth, detailVisible, showMobileDetail);
  const canResize = resizable && detailVisible && !panels.mobile;
  React.useEffect(() => { setMobileDismissed(false); }, [hasSelection, selectedKey]);

  const rememberListTarget = React.useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const candidate = target.closest<HTMLElement>(FOCUSABLE_SELECTOR);
    if (candidate && listPanelRef.current?.contains(candidate)) {
      restoreFocusRef.current = candidate;
    }
  }, []);

  React.useEffect(() => {
    const wasOpen = previousMobileDetailOpenRef.current;
    previousMobileDetailOpenRef.current = showMobileDetail;
    if (!showMobileDetail || wasOpen) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && listPanelRef.current?.contains(activeElement)) {
      restoreFocusRef.current = activeElement;
    }
    if (isVisiblyRendered(mobileBackRef.current)) mobileBackRef.current.focus();
  }, [showMobileDetail]);

  const handleMobileBack = React.useCallback(() => {
    if (mobileDetailOpen === undefined) setMobileDismissed(true);
    onMobileBack?.();
    requestAnimationFrame(() => {
      const listPanel = listPanelRef.current;
      const preferred = restoreFocusRef.current;
      if (isVisiblyRendered(preferred)) {
        preferred.focus();
        return;
      }
      const fallback = listPanel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (isVisiblyRendered(fallback)) fallback.focus();
      else if (isVisiblyRendered(listPanel)) listPanel.focus();
    });
  }, [mobileDetailOpen, onMobileBack]);

  return (
    <div
      data-slot="list-detail-layout"
      className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}
    >
      {/* One shared tree prevents duplicate effects, form state, and DOM IDs. */}
      <ResizablePanelGroup
        elementRef={panels.elementRef}
        groupRef={panels.groupRef}
        orientation={panels.mobile ? 'vertical' : 'horizontal'}
        disabled={!canResize}
        onLayoutChanged={panels.onLayoutChanged}
        data-slot="list-detail-panes"
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {/* List panel */}
        <ResizablePanel id={panels.listId} minSize={canResize ? '12rem' : '0%'}
          maxSize={panels.listVisible ? '100%' : '0%'} aria-hidden={!panels.listVisible}
          inert={!panels.listVisible} className="flex min-h-0 min-w-0 flex-col" style={{ overflow: 'hidden' }}>
        <div
          ref={listPanelRef}
          data-slot="list-detail-list"
          tabIndex={-1}
          className={cn(
            'min-h-0 min-w-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            showMobileDetail && 'hidden md:block',
          )}
          onFocusCapture={(event) => rememberListTarget(event.target)}
          onPointerDownCapture={(event) => rememberListTarget(event.target)}
        >
          {list}
        </div>
        </ResizablePanel>

        {/* Vertical separator */}
        <ResizableHandle aria-label="Resize list and detail panels" disabled={!canResize}
          withHandle={canResize} className={cn('hidden md:flex', (!detailVisible || panels.mobile) && 'md:hidden', canResize && 'w-2 bg-muted/15 hover:bg-accent')} />

        {/* Detail panel */}
        <ResizablePanel id={panels.detailId} minSize={canResize ? '16rem' : '0%'}
          maxSize={panels.detailShown ? '100%' : '0%'} aria-hidden={!panels.detailShown}
          inert={!panels.detailShown} className="flex min-h-0 min-w-0 flex-col" style={{ overflow: 'hidden' }}>
        <div data-slot="list-detail-detail" className={cn(
          'relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          showMobileDetail ? 'flex' : 'hidden',
          detailVisible ? 'md:flex' : 'md:hidden',
        )}>
          {showMobileDetail && (
            <div className="shrink-0 border-b border-border bg-background px-2 py-1.5 md:hidden">
              <Button
                ref={mobileBackRef}
                type="button"
                variant="ghost"
                size="sm"
                disabled={mobileDetailOpen !== undefined && !onMobileBack}
                onClick={handleMobileBack}
              >
                <ArrowLeft aria-hidden="true" />
                {mobileBackLabel}
              </Button>
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedKey ?? '__empty'}
              variants={detailVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              data-slot="list-detail-detail-scroll"
              className="min-h-0 min-w-0 flex-1 overflow-auto"
            >
              {detail}
            </motion.div>
          </AnimatePresence>
        </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Bottom bar */}
      {bottomBar && (
        <div data-slot="list-detail-bottom-bar" className="z-10 shrink-0 border-t border-border bg-background">{bottomBar}</div>
      )}
    </div>
  );
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisiblyRendered(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(element?.isConnected && element.getClientRects().length > 0);
}

export { ListDetailLayout };
