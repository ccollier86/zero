/**
 * cta-section.types.ts
 *
 * Defines the public CTA section contract. This file owns type shape only;
 * rendering and tokenized layout live in cta-section.tsx.
 */

import type * as React from 'react';

import type { HeroAction } from '../hero';

export interface CtaSectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: readonly HeroAction[];
  align?: 'center' | 'left';
  framed?: boolean;
  innerClassName?: string;
  contentClassName?: string;
  actionsClassName?: string;
}
