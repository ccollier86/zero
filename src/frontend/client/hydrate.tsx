'use client';

/**
 * hydrate.tsx
 *
 * Compatibility barrel for Zero's browser hydration runtime. Generated app
 * client entries import `startHydration()` from `hydrate-runtime`; this file
 * keeps the historical path valid without importing generated route manifests.
 */

export {
  startHydration,
} from './hydrate-runtime';
export type {
  HydrationManifest,
  HydrationManifestEntry,
} from './hydrate-runtime';
