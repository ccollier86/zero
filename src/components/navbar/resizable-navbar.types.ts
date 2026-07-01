/**
 * resizable-navbar.types.ts
 *
 * Defines the public data contracts for Zero's resizable navbar. This file owns
 * component types only; rendering and scroll behavior live in
 * resizable-navbar.tsx.
 */

import type { ReactNode } from 'react';
import type { ButtonProps } from '../ui/button';

/** Link item rendered inside the resizable navbar. */
export interface ResizableNavbarItem {
  label: string;
  href: string;
  active?: boolean;
  external?: boolean;
  icon?: ReactNode;
}

/** Action rendered at the right side of the navbar and in the mobile menu. */
export interface ResizableNavbarAction {
  label: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  variant?: ButtonProps['variant'];
  icon?: ReactNode;
  className?: string;
}

/** Brand content rendered on the left side of the navbar. */
export interface ResizableNavbarBrand {
  label?: string;
  href?: string;
  logoSrc?: string;
  logoAlt?: string;
  mark?: ReactNode;
  children?: ReactNode;
}

/** Props for Zero's public-page resizable/floating navbar component. */
export interface ResizableNavbarProps {
  brand?: ResizableNavbarBrand;
  items: readonly ResizableNavbarItem[];
  actions?: readonly ResizableNavbarAction[];
  className?: string;
  desktopClassName?: string;
  mobileClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
  scrollThreshold?: number;
  expandedWidth?: string;
  compactWidth?: string;
  detachedOffset?: number;
}
