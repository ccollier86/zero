'use client';

/**
 * features-section.types.ts
 *
 * Defines the public feature-section contracts. This file owns type shapes
 * only; layout and icon rendering live in features-section.tsx.
 */

import type * as React from 'react';

import type { ZeroAnimatedIconName } from '#zero/components/animate-ui/icons';

/** One feature bullet rendered by FeaturesSection. */
export interface FeatureSectionItem {
  /** Stable key for list rendering. */
  id: string;
  /** Feature title. */
  title: React.ReactNode;
  /** Supporting description. */
  description?: React.ReactNode;
  /** Zero animated icon registry name. */
  iconName?: ZeroAnimatedIconName;
  /** Custom icon node when the Zero icon registry does not have a match. */
  icon?: React.ReactNode;
}

export interface FeaturesSectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  /** Small accent label above the headline. */
  eyebrow?: React.ReactNode;
  /** Main section headline. */
  title: React.ReactNode;
  /** Supporting copy below the headline. */
  description?: React.ReactNode;
  /** Feature bullets shown under the intro copy. */
  features?: readonly FeatureSectionItem[];
  /** Visual slot rendered beside the feature copy, commonly a CodeBlock. */
  visual?: React.ReactNode;
  /** Place visual before or after content on large screens. */
  visualPosition?: 'left' | 'right';
  /** Heading element used for the title. */
  titleAs?: 'h2' | 'h3';
  /** Whether to render the subtle bordered showcase panel. */
  framed?: boolean;
  /** Inner layout class override. */
  innerClassName?: string;
  /** Content column class override. */
  contentClassName?: string;
  /** Feature list class override. */
  featureListClassName?: string;
  /** Visual wrapper class override. */
  visualClassName?: string;
}
