'use client';

/**
 * app-shell-utils.tsx
 *
 * Small render helpers shared by AppShell pieces. This file owns icon and link
 * rendering only; shell layout stays in dedicated components.
 */

import type * as React from 'react';

import { ZeroIcon } from '#zero/components/animate-ui/icons/zero-icon';
import type { AppShellIcon } from './app-shell.types';
import { useAppShellLinkComponent } from './app-shell-navigation';

export interface RenderAppShellIconOptions {
  icon?: AppShellIcon;
  className?: string;
  size?: number;
}

/** Render an app-shell icon from a Zero registry name or component. */
export function renderAppShellIcon({
  icon,
  className = 'size-4',
  size,
}: RenderAppShellIconOptions): React.ReactNode {
  if (!icon) return null;

  if (typeof icon === 'string') {
    return <ZeroIcon name={icon} className={className} size={size} />;
  }

  const Icon = icon;
  return <Icon className={className} size={size} />;
}

export interface AppShellAnchorProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick'> {
  href?: string;
  target?: React.HTMLAttributeAnchorTarget;
  rel?: string;
  download?: boolean | string;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  className?: string;
  children: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
}

/** Render a real anchor when href exists and a button otherwise. */
export function AppShellAnchor({
  href,
  disabled = false,
  onClick,
  className,
  children,
  ref,
  ...props
}: AppShellAnchorProps) {
  const Anchor = useAppShellLinkComponent();
  if (href) {
    return (
      <Anchor
        {...props}
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={className}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : props.tabIndex}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          // Slot-composed handlers (tooltip/menu/navigation) need the real
          // event to preserve dismissal and preventDefault semantics.
          onClick?.(event);
        }}
      >
        {children}
      </Anchor>
    );
  }

  return (
    <button
      {...props}
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Build a compact fallback from a display name or email. */
export function getInitials(name?: string, email?: string): string {
  const source = (name || email || 'Zero').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return source.slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}
