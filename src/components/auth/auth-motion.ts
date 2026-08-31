'use client';

/**
 * auth-motion.ts
 *
 * Shared motion presets for Zero auth UI. This file owns auth animation timing
 * only; individual forms own state, validation, and transport behavior.
 */

import type { Transition } from 'motion/react';

/** Landing-hero-matched transition for full auth page/card entrance. */
export const authShellTransition: Transition = {
  duration: 1.18,
  ease: [0.16, 1, 0.3, 1],
  opacity: { duration: 0.92, ease: 'easeOut' },
  filter: { duration: 1.05, ease: 'easeOut' },
};

/** Full auth shell hidden state, matched to Zero's public Hero entrance. */
export const authShellInitial = {
  opacity: 0,
  y: 42,
  scale: 0.985,
  filter: 'blur(18px)',
};

/** Full auth shell visible state, matched to Zero's public Hero entrance. */
export const authShellAnimate = {
  opacity: 1,
  y: 0,
  scale: 1,
  filter: 'blur(0px)',
};

/** Smooth, restrained transition for auth state swaps and feedback panels. */
export const authPresenceTransition: Transition = {
  duration: 0.72,
  ease: [0.22, 1, 0.36, 1],
};

/** Subtle enter state for auth feedback blocks. */
export const authFeedbackInitial = {
  opacity: 0,
  height: 0,
  y: -6,
  filter: 'blur(4px)',
};

/** Subtle visible state for auth feedback blocks. */
export const authFeedbackAnimate = {
  opacity: 1,
  height: 'auto',
  y: 0,
  filter: 'blur(0px)',
};

/** Subtle exit state for auth feedback blocks. */
export const authFeedbackExit = {
  opacity: 0,
  height: 0,
  y: -4,
  filter: 'blur(3px)',
};

/** Smooth form-to-success/content transition for auth panels. */
export const authPanelInitial = {
  opacity: 0,
  y: 10,
  scale: 0.985,
  filter: 'blur(6px)',
};

/** Smooth visible state for auth panels. */
export const authPanelAnimate = {
  opacity: 1,
  y: 0,
  scale: 1,
  filter: 'blur(0px)',
};

/** Smooth leaving state for auth panels. */
export const authPanelExit = {
  opacity: 0,
  y: -8,
  scale: 0.985,
  filter: 'blur(5px)',
};
