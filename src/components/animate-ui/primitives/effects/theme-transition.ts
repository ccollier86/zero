type Direction = 'btt' | 'ttb' | 'ltr' | 'rtl';

type ThemeTransitionOrigin = Readonly<{
  x: number;
  y: number;
  source?: HTMLElement;
}>;

type ViewportSize = Readonly<{
  width: number;
  height: number;
}>;

type CircularThemeTransitionOptions = {
  direction: Direction;
  origin?: ThemeTransitionOrigin;
  commit: () => void;
};

const THEME_TRANSITION_DURATION_MS = 650;
const THEME_TRANSITION_EASING = 'cubic-bezier(.22, 1, .36, 1)';

const THEME_TRANSITION_STYLES = `
html[data-zero-theme-transition]::view-transition-old(root),
html[data-zero-theme-transition]::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}
html[data-zero-theme-transition]::view-transition-old(root) { z-index: 1; }
html[data-zero-theme-transition]::view-transition-new(root) { z-index: 2; }
html[data-zero-theme-transition]::view-transition-group(zero-theme-toggle) {
  z-index: 3;
}
html[data-zero-theme-transition]::view-transition-old(zero-theme-toggle) {
  animation: zero-theme-toggle-out 420ms cubic-bezier(.4, 0, .2, 1) both;
}
html[data-zero-theme-transition]::view-transition-new(zero-theme-toggle) {
  animation: zero-theme-toggle-in 500ms cubic-bezier(.22, 1, .36, 1) both;
}
@keyframes zero-theme-toggle-out {
  to { opacity: 0; transform: rotate(-70deg) scale(.64); }
}
@keyframes zero-theme-toggle-in {
  from { opacity: 0; transform: rotate(70deg) scale(.64); }
}
@media (prefers-reduced-motion: reduce) {
  html[data-zero-theme-transition]::view-transition-group(root),
  html[data-zero-theme-transition]::view-transition-group(zero-theme-toggle) {
    animation-duration: 0.01ms !important;
  }
}`;

let activeThemeTransition: Promise<void> | null = null;

function getFallbackOrigin(
  direction: Direction,
  viewport: ViewportSize,
): ThemeTransitionOrigin {
  switch (direction) {
    case 'rtl':
      return { x: viewport.width, y: viewport.height / 2 };
    case 'ttb':
      return { x: viewport.width / 2, y: 0 };
    case 'btt':
      return { x: viewport.width / 2, y: viewport.height };
    case 'ltr':
    default:
      return { x: 0, y: viewport.height / 2 };
  }
}

function getCircularClipKeyframes(
  origin: ThemeTransitionOrigin,
  viewport: ViewportSize,
): [string, string] {
  const x = clamp(origin.x, 0, viewport.width);
  const y = clamp(origin.y, 0, viewport.height);
  const farthestX = Math.max(x, viewport.width - x);
  const farthestY = Math.max(y, viewport.height - y);
  const radius = Math.ceil(Math.hypot(farthestX, farthestY));
  const center = `${formatPixel(x)} ${formatPixel(y)}`;

  return [`circle(0px at ${center})`, `circle(${radius}px at ${center})`];
}

function canAnimateThemeTransition(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof document.startViewTransition === 'function' &&
    typeof document.documentElement.animate === 'function'
  );
}

function hasActiveThemeTransition(): boolean {
  return activeThemeTransition !== null;
}

function startCircularThemeTransition(
  options: CircularThemeTransitionOptions,
): Promise<boolean> {
  if (activeThemeTransition) return Promise.resolve(false);

  const work = performCircularThemeTransition(options);
  activeThemeTransition = work;

  return work.then(() => true).finally(() => {
    if (activeThemeTransition === work) activeThemeTransition = null;
  });
}

async function performCircularThemeTransition({
  direction,
  origin,
  commit,
}: CircularThemeTransitionOptions): Promise<void> {
  const root = document.documentElement;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const transitionOrigin = origin ?? getFallbackOrigin(direction, viewport);
  const [fromClip, toClip] = getCircularClipKeyframes(
    transitionOrigin,
    viewport,
  );
  const source = transitionOrigin.source;
  const previousTransitionName = source?.style.getPropertyValue(
    'view-transition-name',
  );

  root.dataset.zeroThemeTransition = '';
  source?.style.setProperty('view-transition-name', 'zero-theme-toggle');

  try {
    let transition: ViewTransition;
    try {
      transition = document.startViewTransition(commit);
    } catch {
      commit();
      return;
    }

    try {
      await transition.ready;
      const reveal = root.animate(
        { clipPath: [fromClip, toClip] },
        {
          duration: THEME_TRANSITION_DURATION_MS,
          easing: THEME_TRANSITION_EASING,
          pseudoElement: '::view-transition-new(root)',
        },
      );
      await Promise.allSettled([reveal.finished, transition.finished]);
    } catch {
      await transition.finished.catch(() => undefined);
    }
  } finally {
    delete root.dataset.zeroThemeTransition;
    restoreViewTransitionName(source, previousTransitionName);
  }
}

function restoreViewTransitionName(
  source: HTMLElement | undefined,
  previousValue: string | undefined,
): void {
  if (!source) return;
  if (previousValue) {
    source.style.setProperty('view-transition-name', previousValue);
  } else {
    source.style.removeProperty('view-transition-name');
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function formatPixel(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

export {
  THEME_TRANSITION_STYLES,
  canAnimateThemeTransition,
  getCircularClipKeyframes,
  getFallbackOrigin,
  hasActiveThemeTransition,
  startCircularThemeTransition,
  type Direction,
  type ThemeTransitionOrigin,
  type ViewportSize,
};
