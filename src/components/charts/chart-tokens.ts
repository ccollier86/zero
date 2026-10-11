/**
 * Maps ordered chart identities into the shared named categorical palette.
 * This pure presentation helper emits late-bound CSS paint expressions only;
 * it does not read the DOM, alter legacy Recharts tokens or reorder data.
 */
export const CHART_CATEGORICAL_COLORS = Object.freeze(['blue', 'orange', 'green', 'amber'] as const);
export const CHART_FLOW_COLORS = Object.freeze(['blue', 'purple', 'amber', 'teal', 'rose', 'olive'] as const);

/** Resolve the one-based series at its paint site, preserving inherited component-specific overrides. */
export function chartSeriesPaint(index: number, palette: readonly string[], overridePrefix: string): string {
  const safeIndex = Number.isSafeInteger(index) && index > 0 ? index : 1;
  const name = palette[(safeIndex - 1) % palette.length] ?? 'blue';
  return `var(${overridePrefix}${safeIndex}, var(--zero-chart-${name}))`;
}
