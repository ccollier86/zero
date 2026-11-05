/** Axis text rendering consumes reserved geometry. Complete shortened labels remain available without mutating chart data. */
import { ChartAxisLabel as AxisText } from '../shared/chart-axis-text';
import type { CartesianLayout } from './cartesian-types';
export function CartesianAxes({ geometry }: { geometry: CartesianLayout }) {
  return <>{geometry.axes.map(({ axis, ticks, caption }) => <g key={axis.id} data-chart-axis={axis.id}>
    {ticks.map(tick => <AxisText key={tick.value} value={tick.textLayout} />)}
    {caption && <AxisText value={caption} caption={axis.id} />}
  </g>)}{geometry.independentTicks.map(tick => <AxisText key={tick.coordinate} value={tick.textLayout} />)}
    {geometry.independentCaption && <AxisText value={geometry.independentCaption} caption="independent" />}
  </>;
}
