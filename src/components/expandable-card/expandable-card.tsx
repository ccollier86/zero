'use client';

/**
 * expandable-card.tsx
 *
 * Renders Aceternity-style shared-layout expandable cards as a reusable Zero
 * public component. This file owns card expansion state and motion layout IDs;
 * callers own content, navigation destinations, and persistence.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { ZeroIcon } from '#zero/components/animate-ui/icons/zero-icon';
import { buttonVariants } from '#zero/components/ui/button';
import { useClickAway } from '#zero/hooks/use-click-away';
import { cn } from '#zero/lib/utils';

import type { ExpandableCardItem, ExpandableCardsProps } from './expandable-card.types';

/** Render a shared-layout expandable card list or grid. */
export function ExpandableCards({
  items,
  variant = 'list',
  defaultActiveId = null,
  activeId,
  onActiveIdChange,
  renderAction,
  overlayClassName,
  cardClassName,
  expandedClassName,
  emptyState,
  className,
  ...props
}: ExpandableCardsProps) {
  const reactId = React.useId();
  const [internalActiveId, setInternalActiveId] = React.useState<string | null>(defaultActiveId);
  const currentActiveId = activeId === undefined ? internalActiveId : activeId;
  const activeItem = React.useMemo(
    () => items.find((item) => item.id === currentActiveId) ?? null,
    [currentActiveId, items],
  );
  const close = React.useCallback(() => {
    if (activeId === undefined) setInternalActiveId(null);
    onActiveIdChange?.(null);
  }, [activeId, onActiveIdChange]);
  const setActive = React.useCallback(
    (id: string) => {
      if (activeId === undefined) setInternalActiveId(id);
      onActiveIdChange?.(id);
    },
    [activeId, onActiveIdChange],
  );
  const clickAwayRef = useClickAway<HTMLDivElement>(close, { enabled: Boolean(activeItem) });

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }

    if (activeItem) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', onKeyDown);
      return () => {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener('keydown', onKeyDown);
      };
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeItem, close]);

  return (
    <div data-zero-surface="public" className={cn('zero-public', className)} {...props}>
      <AnimatePresence>
        {activeItem ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn('fixed inset-0 z-40 h-full w-full bg-background/45 backdrop-blur-sm', overlayClassName)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {activeItem ? (
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <motion.button
              key={`button-${activeItem.id}-${reactId}`}
              type="button"
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.05 } }}
              className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full border border-public-border bg-public-surface text-public-foreground shadow-[var(--public-shadow-floating)] md:hidden"
              onClick={close}
              aria-label="Close expanded card"
            >
              <ZeroIcon name="x" aria-hidden className="size-4" />
            </motion.button>
            <motion.div
              layoutId={layoutKey('card', activeItem, reactId)}
              ref={clickAwayRef}
              className={cn(
                'flex h-full w-full max-w-[34rem] flex-col overflow-hidden rounded-lg border border-public-border bg-public-surface text-public-surface-foreground shadow-[var(--public-shadow-floating)] md:h-fit md:max-h-[90vh]',
                expandedClassName,
              )}
            >
              {activeItem.imageSrc ? (
                <motion.div layoutId={layoutKey('image', activeItem, reactId)}>
                  <img
                    width={720}
                    height={420}
                    src={activeItem.imageSrc}
                    alt={activeItem.imageAlt ?? stringifyNode(activeItem.title)}
                    className="h-72 w-full object-cover object-top"
                  />
                </motion.div>
              ) : null}

              <div className="min-h-0">
                <div className="flex items-start justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <motion.h3
                      layoutId={layoutKey('title', activeItem, reactId)}
                      className="text-lg font-semibold leading-6 text-public-foreground"
                    >
                      {activeItem.title}
                    </motion.h3>
                    {activeItem.description ? (
                      <motion.p
                        layoutId={layoutKey('description', activeItem, reactId)}
                        className="mt-1 text-sm text-public-muted-foreground"
                      >
                        {activeItem.description}
                      </motion.p>
                    ) : null}
                    {activeItem.meta ? (
                      <div className="mt-3 text-xs text-public-muted-foreground">{activeItem.meta}</div>
                    ) : null}
                  </div>
                  {renderExpandableAction(activeItem, 'expanded', renderAction, reactId)}
                </div>

                <div className="relative px-5 pb-5">
                  <motion.div
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex max-h-[18rem] flex-col items-start gap-4 overflow-auto pb-8 text-sm leading-7 text-public-muted-foreground [mask:linear-gradient(to_bottom,white,white,transparent)] [scrollbar-width:none] [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch]"
                  >
                    {renderContent(activeItem.content)}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {items.length === 0 ? (
        <div className="rounded-lg border border-public-border bg-public-surface p-6 text-sm text-public-muted-foreground shadow-[var(--public-shadow-floating)]">
          {emptyState ?? 'No cards have been added yet.'}
        </div>
      ) : (
        <ul
          className={cn(
            variant === 'grid'
              ? 'mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-2'
              : 'mx-auto grid w-full max-w-3xl grid-cols-1 gap-3',
          )}
        >
          {items.map((item) => (
            <li key={item.id}>
              <motion.div
                layoutId={layoutKey('card', item, reactId)}
                role="button"
                tabIndex={0}
                onClick={() => setActive(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActive(item.id);
                  }
                }}
                className={cn(
                  'group cursor-pointer rounded-lg border border-transparent p-4 outline-none transition-colors hover:border-public-border hover:bg-public-accent-soft/55 focus-visible:ring-2 focus-visible:ring-public-ring',
                  variant === 'grid' ? 'flex flex-col gap-4' : 'flex flex-col items-center justify-between gap-4 md:flex-row',
                  cardClassName,
                )}
              >
                <div className={cn('flex min-w-0 gap-4', variant === 'grid' ? 'w-full flex-col' : 'flex-col md:flex-row')}>
                  {item.imageSrc ? (
                    <motion.div layoutId={layoutKey('image', item, reactId)} className="shrink-0">
                      <img
                        width={320}
                        height={220}
                        src={item.imageSrc}
                        alt={item.imageAlt ?? stringifyNode(item.title)}
                        className={cn(
                          'rounded-lg object-cover object-top',
                          variant === 'grid' ? 'h-56 w-full' : 'h-40 w-40 md:size-14',
                        )}
                      />
                    </motion.div>
                  ) : null}
                  <div className={cn('min-w-0', variant === 'grid' ? 'text-center' : 'text-center md:text-left')}>
                    <motion.h3
                      layoutId={layoutKey('title', item, reactId)}
                      className="text-base font-medium text-public-foreground"
                    >
                      {item.title}
                    </motion.h3>
                    {item.description ? (
                      <motion.p
                        layoutId={layoutKey('description', item, reactId)}
                        className="mt-1 text-sm text-public-muted-foreground"
                      >
                        {item.description}
                      </motion.p>
                    ) : null}
                  </div>
                </div>
                {variant === 'list'
                  ? renderExpandableAction(item, 'preview', renderAction, reactId)
                  : null}
              </motion.div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function renderExpandableAction(
  item: ExpandableCardItem,
  location: 'preview' | 'expanded',
  renderAction: ExpandableCardsProps['renderAction'],
  reactId: string,
) {
  if (renderAction) return renderAction(item, location);
  if (!item.actionLabel) return null;

  const className = cn(
    buttonVariants({ variant: location === 'expanded' ? 'default' : 'secondary', size: 'sm' }),
    'rounded-full',
  );

  if (item.actionHref) {
    return (
      <motion.a
        layoutId={layoutKey('action', item, reactId)}
        href={item.actionHref}
        className={className}
        onClick={(event) => event.stopPropagation()}
      >
        {item.actionLabel}
      </motion.a>
    );
  }

  return (
    <motion.span layoutId={layoutKey('action', item, reactId)} className={className}>
      {item.actionLabel}
    </motion.span>
  );
}

function renderContent(content: ExpandableCardItem['content']) {
  if (typeof content === 'function') return content();
  return content ?? null;
}

function layoutKey(part: string, item: ExpandableCardItem, reactId: string): string {
  return `zero-expandable-${part}-${item.id}-${reactId}`;
}

function stringifyNode(node: React.ReactNode): string {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : 'Expandable card';
}
