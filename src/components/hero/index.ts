/**
 * hero/index.ts
 *
 * Public Zero export for public-page Hero components. This file owns the stable
 * package path only; rendering and styling live in sibling modules.
 */

export { Hero } from './hero';
export { HeroActions } from './hero-actions';
export { HeroBackground, HeroImageBackground } from './hero-background';
export type {
  HeroAction,
  HeroBackgroundOptions,
  HeroBackgroundPreset,
  HeroImageBackgroundProps,
  HeroProps,
} from './hero.types';
