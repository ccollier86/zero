/**
 * bento-grid.types.ts
 *
 * Defines public contracts for Zero's public bento grid. This file owns type
 * shape only; rendering and class mapping live in bento-grid.tsx.
 */

import type * as React from 'react';

import type { ZeroAnimatedIconName } from '#zero/components/animate-ui/icons';

export type BentoGridColumns = 2 | 3 | 4;
export type BentoGridSpan = 1 | 2 | 3 | 4;

export interface BentoGridProps extends React.ComponentProps<'div'> {
  columns?: BentoGridColumns;
  children?: React.ReactNode;
}

export interface BentoGridItemProps extends Omit<React.ComponentProps<'article'>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  header?: React.ReactNode;
  icon?: React.ReactNode;
  iconName?: ZeroAnimatedIconName;
  span?: BentoGridSpan;
}
