'use client';

/**
 * hero.types.ts
 *
 * Defines public contracts for Zero's public-page Hero components. This file
 * owns type shapes only; rendering, backgrounds, and action layout live in
 * dedicated hero modules.
 */

import type { ReactNode } from 'react';
import type { ButtonProps } from '../ui/button';

/** Preset background options supported by Zero's public Hero component. */
export type HeroBackgroundPreset =
  | 'aurora'
  | 'gradient'
  | 'stars'
  | 'bubbles'
  | 'hexagon'
  | 'none';

/** Primary or secondary call-to-action rendered inside Hero. */
export interface HeroAction {
  label: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  variant?: ButtonProps['variant'];
  icon?: ReactNode;
  className?: string;
}

/** Configuration for the built-in Hero background layer. */
export interface HeroBackgroundOptions {
  preset?: HeroBackgroundPreset;
  custom?: ReactNode;
  className?: string;
  overlay?: boolean;
  overlayClassName?: string;
  interactive?: boolean;
}

/** Props for the reusable public-page Hero section. */
export interface HeroProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: readonly HeroAction[];
  children?: ReactNode;
  background?: HeroBackgroundOptions | ReactNode;
  align?: 'center' | 'left';
  size?: 'default' | 'compact' | 'full';
  as?: 'section' | 'header';
  titleAs?: 'h1' | 'h2';
  className?: string;
  innerClassName?: string;
  contentClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actionsClassName?: string;
}

/** Props for image-based full-bleed Hero backgrounds. */
export interface HeroImageBackgroundProps {
  src: string;
  alt?: string;
  priority?: boolean;
  className?: string;
  imageClassName?: string;
  overlayClassName?: string;
  children?: ReactNode;
}
