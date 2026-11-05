/** SVG label presentation retains complete shortened text; geometry and exact measurements remain caller-owned. */
import type { ChartAxisText } from './chart-text-layout';
export function ChartAxisLabel({ value, className = 'zero-native-chart__axis', caption }: { value: ChartAxisText; className?: string; caption?: string }) {
  if (!value.text) return null;
  return <text className={className} x={value.x} y={value.y} textAnchor={value.anchor} data-chart-axis-caption={caption}>
    {value.text}{value.text !== value.fullText && <title>{value.fullText}</title>}
  </text>;
}
