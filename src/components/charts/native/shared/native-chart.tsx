'use client';
/** Shared handmade-chart shell, inspection and lifecycle; geometry stays family-owned and data authority stays in /charts/react. */
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../tooltip';
import { useArcChartEnvironment } from '../../arc/shared/use-arc-chart-environment';
export { NATIVE_CHART_MOTION } from './native-motion';
const NativeMotionContext = React.createContext(true);
const palette = ['blue', 'purple', 'amber', 'teal', 'orange', 'green', 'rose', 'olive'] as const;
/** Named family palette is inherited at the paint site; no global series tokens are overwritten. */
export function nativeColor(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Palette index must be nonnegative');
  return `var(--zero-chart-${palette[index % palette.length]})`;
}
export const useNativeChartEnvironment = useArcChartEnvironment;

/** A controlled callback requests state; retired uncontrolled IDs cannot silently reappear later. */
export function useNativeChartSelection(ids: readonly string[], activeId?: string | null, defaultActiveId: string | null = null, onActiveChange?: (id: string | null) => void): readonly [string | null, (id: string | null) => void] {
  const [local, setLocal] = React.useState<string | null>(defaultActiveId);
  const candidate = activeId === undefined ? local : activeId;
  const accepted = candidate !== null && ids.includes(candidate) ? candidate : null;
  React.useEffect(() => { if (activeId === undefined && local !== null && !ids.includes(local)) setLocal(null); }, [activeId, ids, local]);
  const request = (id: string | null) => {
    const next = id !== null && ids.includes(id) ? id : null;
    if (activeId === undefined) setLocal(next);
    if (next !== accepted) onActiveChange?.(next);
  };
  return [accepted, request] as const;
}

export interface NativeChartFrameProps {
  label: string; title?: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode;
  className?: string; motion?: boolean; summary?: string;
}
/** A shrinkable named figure leaves surfaces/card chrome to the application's layout. */
export const NativeChartFrame = React.forwardRef<HTMLElement, NativeChartFrameProps>(function NativeChartFrame(props, ref) {
  const { label, title, subtitle, children, footer, className, motion, summary } = props;
  return <NativeMotionContext.Provider value={motion !== false}><figure ref={ref} className={`zero-native-chart${className ? ` ${className}` : ''}`} aria-label={label} data-zero-native-chart data-motion={motion === false ? 'off' : 'on'}>
    {(title || subtitle) && <figcaption className="zero-native-chart__head">{title && <div className="zero-native-chart__title">{title}</div>}{subtitle && <div className="zero-native-chart__sub">{subtitle}</div>}</figcaption>}
    {children}{footer && <div className="zero-native-chart__footer">{footer}</div>}
    {'summary' in props && <div className="zero-native-chart__sr" aria-live="polite" aria-atomic="true">{summary ?? ''}</div>}
  </figure></NativeMotionContext.Provider>;
});

/** Shared opaque non-interactive analytical card; Zero owns collision handling, portal and overlay stacking. */
export function NativeChartInspector({ open, content, point, onDismiss, side = 'top' }: { open: boolean; content: React.ReactNode; point: readonly [number, number]; onDismiss: () => void; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const motionEnabled = React.useContext(NativeMotionContext);
  return <Tooltip open={open && content !== null} delayDuration={0} motion="blur" arrow={false} disableHoverableContent>
    <TooltipTrigger asChild><span aria-hidden="true" tabIndex={-1} className="zero-native-chart__anchor" style={{ left: point[0], top: point[1] }} /></TooltipTrigger>
    <TooltipContent className="zero-native-chart__tooltip" style={motionEnabled ? undefined : { '--zero-tooltip-motion-blur-enter': '1ms', '--zero-tooltip-motion-blur-exit': '1ms' } as React.CSSProperties} side={side} sideOffset={8} collisionPadding={8} arrow={false} updatePositionStrategy="always" onEscapeKeyDown={event => { event.preventDefault(); onDismiss(); }}>{content}</TooltipContent>
  </Tooltip>;
}

/** Exact admitted values/statistics remain available independently of SVG label sampling and decorative animation. */
export function NativeChartDataTable({ label, columns, rows }: { label: string; columns: readonly string[]; rows: readonly (readonly React.ReactNode[])[] }) {
  return <div className="zero-native-chart__sr"><table><caption>{label}</caption><thead><tr>{columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, column) => column === 0 ? <th scope="row" key={column}>{value}</th> : <td key={column}>{value}</td>)}</tr>)}</tbody></table></div>;
}

/** Legends use explicit series IDs and request visibility changes without mutating caller state. */
export function NativeChartLegend({ items, hiddenIds = [], onToggle }: { items: readonly { id: string; label: string; color?: string }[]; hiddenIds?: readonly string[]; onToggle?: (id: string) => void }) {
  return <div className="zero-native-chart__legend">{items.map((item, index) => onToggle ? <button type="button" key={item.id} aria-pressed={!hiddenIds.includes(item.id)} onClick={() => onToggle(item.id)}><i style={{ backgroundColor: item.color ?? nativeColor(index) }} /><span>{item.label}</span></button> : <span key={item.id}><i style={{ backgroundColor: item.color ?? nativeColor(index) }} /><span>{item.label}</span></span>)}</div>;
}
