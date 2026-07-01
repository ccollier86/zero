/**
 * expandable-card.types.ts
 *
 * Defines data contracts for Zero's expandable card gallery. This file owns
 * public types only; animation and rendering live in expandable-card.tsx.
 */

import type * as React from 'react';

export interface ExpandableCardItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  imageSrc?: string;
  imageAlt?: string;
  actionLabel?: React.ReactNode;
  actionHref?: string;
  content?: React.ReactNode | (() => React.ReactNode);
  meta?: React.ReactNode;
}

export interface ExpandableCardsProps extends React.ComponentProps<'div'> {
  items: readonly ExpandableCardItem[];
  variant?: 'list' | 'grid';
  defaultActiveId?: string | null;
  activeId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
  renderAction?: (item: ExpandableCardItem, location: 'preview' | 'expanded') => React.ReactNode;
  overlayClassName?: string;
  cardClassName?: string;
  expandedClassName?: string;
  emptyState?: React.ReactNode;
}
