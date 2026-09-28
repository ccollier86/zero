/**
 * faq.types.ts
 *
 * Defines the public FAQ component contract. This file owns type shape only;
 * rendering, animation, and state live in faq.tsx.
 */

import type * as React from 'react';

import type { ZeroAnimatedIconName } from '#zero/components/animate-ui/icons';

export interface FaqItem {
  id: string;
  question: React.ReactNode;
  answer: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  iconName?: ZeroAnimatedIconName;
}

export interface FaqProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  items: readonly FaqItem[];
  title?: React.ReactNode;
  description?: React.ReactNode;
  defaultOpenIds?: readonly string[];
  allowMultiple?: boolean;
  animateAnswers?: boolean;
  headerClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  questionClassName?: string;
  answerClassName?: string;
  emptyState?: React.ReactNode;
}
