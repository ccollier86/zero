/**
 * animated-list.types.ts
 *
 * Defines the public animated-list contracts. This file owns type shape only;
 * timed reveal behavior lives in animated-list.tsx.
 */

import type * as React from 'react';

import type { ZeroAnimatedIconName } from '@/components/animate-ui/icons';

export interface AnimatedListProps extends React.ComponentProps<'div'> {
  children: React.ReactNode;
  delay?: number;
}

export interface AnimatedListItemProps {
  children: React.ReactNode;
}

export interface AnimatedListCardProps extends Omit<React.ComponentProps<'figure'>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  iconName?: ZeroAnimatedIconName;
  color?: string;
}
