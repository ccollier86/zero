'use client';

/**
 * theme-morph-icon.tsx
 *
 * Renders the self-contained sun/moon SVG used by ThemeTogglerButton. The icon
 * owns visual motion only and remains decorative because the button supplies
 * the accessible name and interaction semantics.
 */

import * as React from 'react';

import type { Resolved } from '@/components/animate-ui/primitives/effects/theme-toggler';

const THEME_MORPH_STYLES = `
.zero-theme-morph {
  color: currentColor;
  overflow: visible;
  transform: rotate(0deg);
}

.zero-theme-morph__disc,
.zero-theme-morph__rays {
  transform-box: fill-box;
  transform-origin: center;
}

.zero-theme-morph__cutout {
  transform: translateX(0);
}

.zero-theme-morph[data-resolved-theme='dark'] {
  transform: rotate(-18deg);
}

.zero-theme-morph[data-resolved-theme='dark'] .zero-theme-morph__disc {
  transform: scale(1.75);
}

.zero-theme-morph[data-resolved-theme='dark'] .zero-theme-morph__cutout {
  transform: translateX(-7px);
}

.zero-theme-morph[data-resolved-theme='dark'] .zero-theme-morph__rays {
  opacity: 0;
  transform: rotate(-35deg) scale(0.65);
}

.zero-theme-morph[data-animate][data-resolved-theme='dark'] {
  animation: zero-theme-root-to-dark 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.zero-theme-morph[data-animate][data-resolved-theme='light'] {
  animation: zero-theme-root-to-light 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.zero-theme-morph[data-animate][data-resolved-theme='dark'] .zero-theme-morph__disc {
  animation: zero-theme-disc-to-dark 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.zero-theme-morph[data-animate][data-resolved-theme='light'] .zero-theme-morph__disc {
  animation: zero-theme-disc-to-light 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.zero-theme-morph[data-animate][data-resolved-theme='dark'] .zero-theme-morph__cutout {
  animation: zero-theme-cutout-to-dark 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.zero-theme-morph[data-animate][data-resolved-theme='light'] .zero-theme-morph__cutout {
  animation: zero-theme-cutout-to-light 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.zero-theme-morph[data-animate][data-resolved-theme='dark'] .zero-theme-morph__rays {
  animation: zero-theme-rays-to-dark 400ms ease-out both;
}

.zero-theme-morph[data-animate][data-resolved-theme='light'] .zero-theme-morph__rays {
  animation: zero-theme-rays-to-light 500ms 80ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes zero-theme-root-to-dark {
  from { transform: rotate(0deg); }
  to { transform: rotate(-18deg); }
}

@keyframes zero-theme-root-to-light {
  from { transform: rotate(-18deg); }
  to { transform: rotate(0deg); }
}

@keyframes zero-theme-disc-to-dark {
  from { transform: scale(1); }
  to { transform: scale(1.75); }
}

@keyframes zero-theme-disc-to-light {
  from { transform: scale(1.75); }
  to { transform: scale(1); }
}

@keyframes zero-theme-cutout-to-dark {
  from { transform: translateX(0); }
  to { transform: translateX(-7px); }
}

@keyframes zero-theme-cutout-to-light {
  from { transform: translateX(-7px); }
  to { transform: translateX(0); }
}

@keyframes zero-theme-rays-to-dark {
  from { opacity: 1; transform: rotate(0deg) scale(1); }
  to { opacity: 0; transform: rotate(-35deg) scale(0.65); }
}

@keyframes zero-theme-rays-to-light {
  from { opacity: 0; transform: rotate(-35deg) scale(0.65); }
  to { opacity: 1; transform: rotate(0deg) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .zero-theme-morph,
  .zero-theme-morph * {
    animation: none !important;
    transition: none !important;
  }
}
`;

type ThemeMorphIconProps = {
  resolved: Resolved;
  animate: boolean;
};

/** Render one masked SVG that morphs continuously between sun and moon. */
function ThemeMorphIcon({ resolved, animate }: ThemeMorphIconProps) {
  const maskId = `zero-theme-mask-${React.useId().replaceAll(':', '')}`;

  return (
    <svg
      className="zero-theme-morph"
      data-animate={animate ? '' : undefined}
      data-resolved-theme={resolved}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="24"
        height="24"
      >
        <rect width="24" height="24" fill="white" />
        <circle
          className="zero-theme-morph__cutout"
          cx="24"
          cy="10"
          r="6"
          fill="black"
        />
      </mask>
      <circle
        className="zero-theme-morph__disc"
        cx="12"
        cy="12"
        r="6"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      <g
        className="zero-theme-morph__rays"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M12 1v2" />
        <path d="M12 21v2" />
        <path d="m4.22 4.22 1.42 1.42" />
        <path d="m18.36 18.36 1.42 1.42" />
        <path d="M1 12h2" />
        <path d="M21 12h2" />
        <path d="m4.22 19.78 1.42-1.42" />
        <path d="m18.36 5.64 1.42-1.42" />
      </g>
    </svg>
  );
}

/** Render the global keyframes beside, rather than inside, the button. */
function ThemeMorphIconStyles() {
  return <style>{THEME_MORPH_STYLES}</style>;
}

export {
  ThemeMorphIcon,
  ThemeMorphIconStyles,
  type ThemeMorphIconProps,
};
