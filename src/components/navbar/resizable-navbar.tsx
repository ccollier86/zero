'use client';

/**
 * resizable-navbar.tsx
 *
 * Renders Zero's public-page resizable navbar. This file owns scroll-triggered
 * shell motion, magnetic link highlighting, and mobile menu interaction only;
 * callers own routing, auth actions, and page-specific content.
 */

import * as React from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from 'motion/react';

import { Menu } from '@/components/animate-ui/icons/menu';
import { X } from '@/components/animate-ui/icons/x';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  ResizableNavbarAction,
  ResizableNavbarBrand,
  ResizableNavbarItem,
  ResizableNavbarProps,
} from './resizable-navbar.types';

const NAVBAR_TRANSITION = {
  type: 'spring' as const,
  stiffness: 200,
  damping: 42,
  mass: 0.7,
};

const HOVER_TRANSITION = {
  type: 'spring' as const,
  stiffness: 360,
  damping: 32,
  mass: 0.7,
};

/**
 * Render a top navbar that stays attached at the top, then detaches and
 * shrinks into a floating blurred surface after the page scrolls.
 */
export function ResizableNavbar({
  brand,
  items,
  actions = [],
  className,
  desktopClassName,
  mobileClassName,
  itemClassName,
  activeItemClassName,
  menuClassName,
  ariaLabel = 'Primary navigation',
  scrollThreshold = 96,
  expandedWidth = 'min(100%, 80rem)',
  compactWidth = 'min(calc(100% - 2rem), 54rem)',
  detachedOffset = 16,
}: ResizableNavbarProps) {
  const [detached, setDetached] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, 'change', (latest) => {
    setDetached(latest > scrollThreshold);
  });

  return (
    <header
      data-zero-surface="public"
      className={cn('fixed inset-x-0 top-0 z-50 w-full px-3 sm:px-4', className)}
    >
      <DesktopResizableNavbar
        ariaLabel={ariaLabel}
        brand={brand}
        items={items}
        actions={actions}
        detached={detached}
        expandedWidth={expandedWidth}
        compactWidth={compactWidth}
        detachedOffset={detachedOffset}
        itemClassName={itemClassName}
        activeItemClassName={activeItemClassName}
        className={desktopClassName}
      />
      <MobileResizableNavbar
        ariaLabel={ariaLabel}
        brand={brand}
        items={items}
        actions={actions}
        detached={detached}
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        detachedOffset={detachedOffset}
        itemClassName={itemClassName}
        menuClassName={menuClassName}
        className={mobileClassName}
      />
    </header>
  );
}

interface DesktopResizableNavbarProps {
  ariaLabel: string;
  brand?: ResizableNavbarBrand;
  items: readonly ResizableNavbarItem[];
  actions: readonly ResizableNavbarAction[];
  detached: boolean;
  expandedWidth: string;
  compactWidth: string;
  detachedOffset: number;
  itemClassName?: string;
  activeItemClassName?: string;
  className?: string;
}

function DesktopResizableNavbar({
  ariaLabel,
  brand,
  items,
  actions,
  detached,
  expandedWidth,
  compactWidth,
  detachedOffset,
  itemClassName,
  activeItemClassName,
  className,
}: DesktopResizableNavbarProps) {
  return (
    <motion.nav
      aria-label={ariaLabel}
      animate={{
        width: detached ? compactWidth : expandedWidth,
        y: detached ? detachedOffset : 0,
        borderRadius: detached ? 999 : 0,
        backdropFilter: detached ? 'blur(18px)' : 'blur(0px)',
      }}
      transition={NAVBAR_TRANSITION}
      className={cn(
        'mx-auto hidden h-16 items-center justify-between gap-4 border border-transparent bg-transparent px-4 text-public-foreground transition-colors lg:flex',
        detached && 'border-public-border bg-public-glass shadow-[var(--public-shadow-floating)] backdrop-blur-xl',
        className,
      )}
    >
      <NavbarBrand brand={brand} />
      <NavbarItems
        items={items}
        itemClassName={itemClassName}
        activeItemClassName={activeItemClassName}
      />
      <NavbarActions actions={actions} />
    </motion.nav>
  );
}

interface MobileResizableNavbarProps {
  ariaLabel: string;
  brand?: ResizableNavbarBrand;
  items: readonly ResizableNavbarItem[];
  actions: readonly ResizableNavbarAction[];
  detached: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detachedOffset: number;
  itemClassName?: string;
  menuClassName?: string;
  className?: string;
}

function MobileResizableNavbar({
  ariaLabel,
  brand,
  items,
  actions,
  detached,
  open,
  onOpenChange,
  detachedOffset,
  itemClassName,
  menuClassName,
  className,
}: MobileResizableNavbarProps) {
  const toggleLabel = open ? 'Close navigation menu' : 'Open navigation menu';

  return (
    <motion.nav
      aria-label={ariaLabel}
      animate={{
        y: detached ? detachedOffset : 0,
        width: detached ? 'min(calc(100vw - 2rem), 36rem)' : '100%',
        borderRadius: detached ? 24 : 0,
        backdropFilter: detached ? 'blur(18px)' : 'blur(0px)',
      }}
      transition={NAVBAR_TRANSITION}
      className={cn(
        'relative mx-auto flex h-auto min-h-16 flex-col border border-transparent bg-transparent px-2 py-2 text-public-foreground transition-colors lg:hidden',
        detached && 'border-public-border bg-public-glass shadow-[var(--public-shadow-floating)] backdrop-blur-xl',
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <NavbarBrand brand={brand} />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={toggleLabel}
          aria-expanded={open}
          className="text-public-muted-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring"
          onClick={() => onOpenChange(!open)}
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </Button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              'absolute inset-x-0 top-[calc(100%+0.5rem)] z-50 flex flex-col gap-2 rounded-2xl border border-public-border bg-public-glass p-2 text-public-glass-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl',
              menuClassName,
            )}
          >
            {items.map((item) => (
              <NavbarMobileItem
                key={`${item.label}-${item.href}`}
                item={item}
                className={itemClassName}
                onClick={() => onOpenChange(false)}
              />
            ))}
            {actions.length > 0 && (
              <div className="mt-2 grid gap-2 border-t border-public-border pt-2">
                {actions.map((action) => (
                  <NavbarActionButton
                    key={`${action.label}-${action.href ?? 'button'}`}
                    action={action}
                    className="w-full justify-center"
                    onClick={() => {
                      action.onClick?.();
                      onOpenChange(false);
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

function NavbarBrand({ brand }: { brand?: ResizableNavbarBrand }) {
  const href = brand?.href ?? '/';
  const content = renderBrandContent(brand);

  return (
    <a
      href={href}
      className="flex min-w-0 shrink-0 items-center gap-2 rounded-full px-2 py-1 text-sm font-semibold text-public-foreground outline-none transition-colors hover:text-public-accent focus-visible:ring-2 focus-visible:ring-public-ring/60"
    >
      {content}
    </a>
  );
}

function renderBrandContent(brand: ResizableNavbarBrand | undefined) {
  if (brand?.children) return brand.children;

  return (
    <>
      {brand?.logoSrc ? (
        <img
          src={brand.logoSrc}
          alt={brand.logoAlt ?? brand.label ?? 'Logo'}
          className="h-8 w-auto shrink-0 object-contain"
        />
      ) : brand?.mark ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-public-accent text-public-accent-foreground">
          {brand.mark}
        </span>
      ) : null}
      {brand?.label && <span className="truncate">{brand.label}</span>}
    </>
  );
}

function NavbarItems({
  items,
  itemClassName,
  activeItemClassName,
}: {
  items: readonly ResizableNavbarItem[];
  itemClassName?: string;
  activeItemClassName?: string;
}) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const activeIndex = items.findIndex((item) => item.active);
  const highlighted = hovered ?? (activeIndex >= 0 ? activeIndex : null);
  const layoutId = React.useId().replace(/:/g, '');

  return (
    <div
      onMouseLeave={() => setHovered(null)}
      className="flex min-w-0 flex-1 items-center justify-center gap-1 text-sm font-medium"
    >
      {items.map((item, index) => {
        const active = highlighted === index;
        return (
          <a
            key={`${item.label}-${item.href}`}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noreferrer' : undefined}
            aria-current={item.active ? 'page' : undefined}
            onMouseEnter={() => setHovered(index)}
            className={cn(
              'relative inline-flex items-center gap-2 rounded-full px-3 py-2 text-public-muted-foreground outline-none transition-colors hover:text-public-foreground focus-visible:ring-2 focus-visible:ring-public-ring/60',
              item.active && 'text-public-foreground',
              active && activeItemClassName,
              itemClassName,
            )}
          >
            {active && (
              <motion.span
                layoutId={`zero-navbar-hover-${layoutId}`}
                transition={HOVER_TRANSITION}
                className="absolute inset-0 rounded-full bg-public-accent-soft"
              />
            )}
            {item.icon && <span className="relative z-10 flex size-4 items-center justify-center">{item.icon}</span>}
            <span className="relative z-10 whitespace-nowrap">{item.label}</span>
          </a>
        );
      })}
    </div>
  );
}

function NavbarMobileItem({
  item,
  className,
  onClick,
}: {
  item: ResizableNavbarItem;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={item.href}
      target={item.external ? '_blank' : undefined}
      rel={item.external ? 'noreferrer' : undefined}
      aria-current={item.active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-public-muted-foreground transition-colors hover:bg-public-accent-soft hover:text-public-foreground',
        item.active && 'bg-public-accent-soft text-public-foreground',
        className,
      )}
    >
      {item.icon && <span className="flex size-4 items-center justify-center">{item.icon}</span>}
      <span>{item.label}</span>
    </a>
  );
}

function NavbarActions({ actions }: { actions: readonly ResizableNavbarAction[] }) {
  if (actions.length === 0) return <div className="w-24" aria-hidden="true" />;

  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      {actions.map((action) => (
        <NavbarActionButton key={`${action.label}-${action.href ?? 'button'}`} action={action} />
      ))}
    </div>
  );
}

function NavbarActionButton({
  action,
  className,
  onClick,
}: {
  action: ResizableNavbarAction;
  className?: string;
  onClick?: () => void;
}) {
  const variant = action.variant ?? 'default';
  const actionClassName = cn(getPublicActionClassName(variant), action.className, className);
  const content = (
    <>
      {action.icon}
      <span>{action.label}</span>
    </>
  );

  if (action.href) {
    return (
      <Button asChild size="sm" variant={variant} className={actionClassName}>
        <a
          href={action.href}
          target={action.external ? '_blank' : undefined}
          rel={action.external ? 'noreferrer' : undefined}
          onClick={() => {
            action.onClick?.();
            onClick?.();
          }}
        >
          {content}
        </a>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={actionClassName}
      onClick={onClick ?? action.onClick}
    >
      {content}
    </Button>
  );
}

function getPublicActionClassName(variant: ResizableNavbarAction['variant']): string {
  switch (variant) {
    case 'destructive':
      return '';
    case 'ghost':
      return 'text-public-muted-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring';
    case 'link':
      return 'text-public-accent hover:text-public-accent hover:underline focus-visible:ring-public-ring';
    case 'outline':
      return 'border-public-border bg-public-glass text-public-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring';
    case 'secondary':
      return 'bg-public-muted text-public-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring';
    case 'default':
    case null:
    case undefined:
      return 'bg-public-accent text-public-accent-foreground hover:bg-public-accent/90 focus-visible:ring-public-ring';
  }

  return '';
}
