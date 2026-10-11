/**
 * Historical component dependency edges retained by source-copy after family
 * moves. These exact app-owned destinations apply to transitive imports as well
 * as direct requests; this manifest adds no public component IDs or overwrite policy.
 */

const EDGES: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.fromEntries(
  Object.entries({
    'components/popover/index.ts': ['components/animate-ui/components/radix/popover.tsx'],
    'components/ui/card.tsx': ['components/ui/card-status.tsx', 'components/ui/card-presentation.ts'],
    'components/ui/card-status.tsx': ['components/ui/card-presentation.ts'],
    'components/ui/content-card.tsx': ['components/ui/card.tsx', 'components/ui/card-status.tsx',
      'components/ui/card-presentation.ts', 'components/ui/content-card.css'],
    'components/ui/select.tsx': ['components/ui/select-morph.css', 'components/ui/select-morph-motion.ts',
      'components/ui/select-magnetic.ts', 'components/ui/select-motion-geometry.ts', 'components/ui/select-paint.ts'],
    'components/ui/select-morph-motion.ts': ['components/ui/select-motion-geometry.ts', 'components/ui/select-paint.ts'],
    'components/ui/select-magnetic.ts': ['components/ui/select-motion-geometry.ts'],
    'components/ui/calendar.tsx': ['components/ui/calendar-month-presentation.tsx', 'components/ui/calendar-view-context.tsx'],
    'components/ui/calendar-month-presentation.tsx': ['components/ui/calendar-view-context.tsx', 'components/ui/calendar-view-model.ts',
      'components/ui/calendar-view-motion.ts', 'components/ui/picker-value-text.tsx',
      'components/overlays/overlay-scope.tsx', 'components/overlays/menu-active-highlight.tsx',
      'components/overlays/scroll-viewport-decoration.tsx'],
    'components/ui/calendar-view-motion.ts': ['components/ui/calendar-motion.ts', 'components/ui/calendar-view-context.tsx'],
    'components/ui/picker-value-text.tsx': ['components/ui/calendar-motion.ts'],
    'components/ui/date-picker.tsx': ['components/ui/calendar.tsx', 'components/ui/date-picker-value.ts',
      'components/ui/picker-value-text.tsx', 'components/ui/picker-popover-motion.ts'],
    'components/ui/date-range-picker.tsx': ['components/ui/calendar.tsx'],
    'components/ui/time-picker.tsx': ['components/ui/picker-value-text.tsx', 'components/ui/time-picker-value.ts',
      'components/overlays/menu-active-highlight.tsx', 'components/overlays/scroll-viewport-decoration.tsx'],
    'components/animate-ui/components/radix/popover.tsx': ['components/animate-ui/primitives/radix/popover.tsx',
      'components/overlays/overlay-scope.tsx', 'components/overlays/anchored-surface-motion.ts',
      'components/overlays/scroll-viewport-decoration.tsx', 'components/overlays/scroll-viewport-metrics.ts'],
    'components/animate-ui/primitives/radix/popover.tsx': ['components/overlays/overlay-scope.tsx',
      'components/overlays/anchored-surface-motion.ts'],
    'components/overlays/anchored-surface-motion.ts': ['components/overlays/anchored-surface.css'],
    'components/overlays/menu-active-highlight.tsx': ['components/overlays/menu-active-highlight.css'],
    'components/overlays/scroll-viewport-decoration.tsx': ['components/overlays/use-scroll-viewport.ts',
      'components/overlays/scroll-viewport-metrics.ts', 'components/overlays/scroll-viewport.css'],
    'components/overlays/use-scroll-viewport.ts': ['components/overlays/scroll-viewport-metrics.ts'],
  }).map(([source, companions]) => [source, Object.freeze(companions)]),
));

const EMPTY: readonly string[] = Object.freeze([]);

/** Return immutable exact former dependencies for an admitted source-relative file, never a directory sweep. */
export function getComponentCompatibilityCompanions(sourceRel: string): readonly string[] {
  return Object.hasOwn(EDGES, sourceRel) ? EDGES[sourceRel]! : EMPTY;
}
