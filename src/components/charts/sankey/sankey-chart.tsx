'use client';
/**
 * Composes the Sankey plot, value inspector, motion control and accessible flow table.
 * Accepts authorized aggregate data only; query/database ownership belongs to the separate charts facade.
 */
import * as React from 'react';
import { Button } from '../../ui/button';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { buildSankeyModel } from './sankey-model';
import { computeSankeyTrace } from './sankey-trace';
import { SankeyPaintRuntime, validateSankeyPaintBudget } from './sankey-runtime';
import { SankeyInspection, SankeyNodeTooltip, SankeyLinkTooltip, sankeyPercent,
  type SankeyNodeTooltipContext, type SankeyLinkTooltipContext } from './sankey-inspection';
import type { SankeyData, SankeyTrace, SankeyTraceTarget, SankeyModel, SankeyLayout } from './sankey-types';

const defaultFormat = (value: number) => Math.round(value).toLocaleString('en-US');
const sameTarget = (a: SankeyTraceTarget | null | undefined, b: SankeyTraceTarget | null | undefined) => a?.kind === b?.kind && a?.id === b?.id;
export interface SankeyTraceInteraction { via: 'pointer' | 'touch' | 'keyboard'; }
/** Controlled or local inspection and particles, with typed React-only tooltip extension points. */
export interface SankeyChartProps extends Omit<React.ComponentProps<'figure'>, 'children' | 'onChange'> {
  data: SankeyData;
  label: string;
  columns?: readonly string[];
  height?: number;
  orientation?: 'auto' | 'horizontal' | 'vertical';
  traceColor?: 'source' | 'mix';
  trace?: SankeyTraceTarget | null;
  defaultTrace?: SankeyTraceTarget | null;
  onTraceChange?: (trace: SankeyTrace | null, interaction: SankeyTraceInteraction) => void;
  particles?: boolean;
  defaultParticles?: boolean;
  onParticlesChange?: (enabled: boolean) => void;
  particleSpeed?: number;
  particleToggle?: boolean;
  motion?: boolean;
  unit?: string;
  totalLabel?: string;
  formatValue?: (value: number) => string;
  emptyLabel?: string;
  accent?: string;
  /** Undefined uses the reference body; null deliberately hides the corresponding inspector. */
  renderNodeTooltip?: (context: SankeyNodeTooltipContext) => React.ReactNode;
  renderLinkTooltip?: (context: SankeyLinkTooltipContext) => React.ReactNode;
}
function validTarget(model: SankeyModel, target: SankeyTraceTarget | null | undefined) {
  return target && (target.kind === 'node' ? model.byId.has(target.id) : model.linkBy.has(target.id)) ? target : null;
}
function hitTarget(event: React.PointerEvent<HTMLElement>): SankeyTraceTarget | null {
  const element = event.target instanceof Element ? event.target.closest('[data-target-id][data-kind]') : null;
  const kind = element?.getAttribute('data-kind'), id = element?.getAttribute('data-target-id');
  return id != null && (kind === 'node' || kind === 'link') ? { kind, id } : null;
}

/** Reference Sankey organism: pure aggregate inputs and existing Zero controls/tooltips, never autonomous data simulation. */
export function SankeyChart({ data, label, columns, height = 340, orientation = 'auto', traceColor = 'source', trace, defaultTrace = null,
  onTraceChange, particles, defaultParticles = true, onParticlesChange, particleSpeed = 1, particleToggle = true, motion = true,
  unit = '', totalLabel = 'the total', formatValue = defaultFormat, emptyLabel = 'No flows yet', accent,
  renderNodeTooltip, renderLinkTooltip, className, style, ...figureProps }: SankeyChartProps) {
  const model = React.useMemo(() => buildSankeyModel(data), [data]);
  validateSankeyPaintBudget(model, traceColor);
  if (!Number.isFinite(particleSpeed) || particleSpeed < 0 || particleSpeed > 10) throw new RangeError('Sankey particleSpeed must be finite and between 0 and 10.');
  const [localTrace, setLocalTrace] = React.useState(defaultTrace), [localParticles, setLocalParticles] = React.useState(defaultParticles);
  const [inspection, setInspection] = React.useState<{ point: readonly [number, number]; open: boolean }>({ point: [0, 0], open: false });
  const [layout, setLayout] = React.useState<Pick<SankeyLayout, 'upright' | 'H' | 'W'>>({ upright: orientation === 'vertical', H: height, W: 600 });
  const figure = React.useRef<HTMLElement | null>(null), plot = React.useRef<HTMLDivElement | null>(null), back = React.useRef<SVGSVGElement | null>(null),
    front = React.useRef<SVGSVGElement | null>(null), canvas = React.useRef<HTMLCanvasElement | null>(null), runtime = React.useRef<SankeyPaintRuntime | null>(null);
  const pinned = React.useRef(false), keyboard = React.useRef<{ ci: number; ni: number } | null>(null);
  const current = validTarget(model, trace === undefined ? localTrace : trace), activeTrace = React.useMemo(() => current ? computeSankeyTrace(model, current) : null,
    [model, current?.kind, current?.id]);
  const enabled = particles ?? localParticles, reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const onLayout = React.useCallback((next: SankeyLayout) => setLayout(old => old.upright === next.upright && old.H === next.H && old.W === next.W
    ? old : { upright: next.upright, H: next.H, W: next.W }), []);
  const options = React.useMemo(() => ({ columns, height, orientation, traceColor, motion, particles: enabled, particleSpeed, formatValue, onLayout }),
    [columns, height, orientation, traceColor, motion, enabled, particleSpeed, formatValue, onLayout]);
  const latestOptions = React.useRef(options); latestOptions.current = options;
  React.useLayoutEffect(() => {
    const paint = new SankeyPaintRuntime({ figure: figure.current!, plot: plot.current!, back: back.current!, front: front.current!, canvas: canvas.current! }, latestOptions.current);
    runtime.current = paint;
    return () => { paint.destroy(); if (runtime.current === paint) runtime.current = null; };
  }, []);
  React.useLayoutEffect(() => { runtime.current?.update(model, options); }, [model, options]);
  React.useLayoutEffect(() => {
    runtime.current?.setTrace(current);
    if (current) setInspection(old => pinned.current || !old.open ? { point: runtime.current?.anchor(current) ?? [0, 0], open: true } : old);
    if (!current) setInspection(old => old.open ? { ...old, open: false } : old);
  }, [model, current?.kind, current?.id, layout.upright, layout.W, layout.H]);
  React.useEffect(() => {
    if (!validTarget(model, trace === undefined ? localTrace : trace)) {
      if (localTrace !== null) setLocalTrace(null); keyboard.current = null; pinned.current = false;
    }
  }, [model, localTrace, trace?.kind, trace?.id]);
  const requestTrace = (next: SankeyTraceTarget | null, via: SankeyTraceInteraction['via']) => {
    const value = validTarget(model, next);
    if (!sameTarget(value, current)) { if (trace === undefined) setLocalTrace(value); onTraceChange?.(value ? computeSankeyTrace(model, value) : null, { via }); }
  };
  const clear = (via: SankeyTraceInteraction['via'] = 'keyboard') => { pinned.current = false; requestTrace(null, via); setInspection(old => ({ ...old, open: false })); };
  const inspect = (target: SankeyTraceTarget, point: readonly [number, number], via: SankeyTraceInteraction['via']) => {
    requestTrace(target, via); setInspection({ point, open: true });
  };
  const localPoint = (event: React.PointerEvent<HTMLDivElement>): readonly [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const goKeyboard = (ci: number, ni: number) => {
    const column = model.cols[ci]; if (!column?.length) return;
    ni = Math.max(0, Math.min(column.length - 1, ni)); keyboard.current = { ci, ni }; pinned.current = true;
    const target = { kind: 'node', id: column[ni]!.id } as const;
    inspect(target, runtime.current?.anchor(target) ?? [0, 0], 'keyboard');
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear(); return; }
    const occupied = model.cols.map((col, i) => col.length ? i : -1).filter(i => i >= 0); if (!occupied.length) return;
    const k = keyboard.current && model.cols[keyboard.current.ci]?.[keyboard.current.ni] ? keyboard.current : { ci: occupied[0]!, ni: 0 };
    const along = layout.upright ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'], across = layout.upright ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    let ci = k.ci, ni = k.ni;
    if (event.key === across[0]) ni--; else if (event.key === across[1]) ni++;
    else if (event.key === along[0] || event.key === along[1]) {
      const index = occupied.indexOf(k.ci), targetColumn = occupied[Math.max(0, Math.min(occupied.length - 1, index + (event.key === along[0] ? -1 : 1)))];
      ci = targetColumn!;
      const geometry = runtime.current?.currentLayout, old = geometry?.nodes.get(model.cols[k.ci]![k.ni]!.id);
      if (old && geometry) {
        const center = (old.c0 + old.c1) / 2; let distance = Infinity;
        model.cols[ci]!.forEach((node, index) => { const g = geometry.nodes.get(node.id)!; const d = Math.abs((g.c0 + g.c1) / 2 - center); if (d < distance) { distance = d; ni = index; } });
      } else ni = 0;
    } else if (event.key === 'Home') { ci = occupied[0]!; ni = 0; } else if (event.key === 'End') { ci = occupied[occupied.length - 1]!; ni = 0; } else return;
    event.preventDefault(); goKeyboard(ci, ni);
  };
  let content: React.ReactNode = null;
  if (activeTrace) {
    if (activeTrace.kind === 'node') {
      const context: SankeyNodeTooltipContext = { node: model.byId.get(activeTrace.id)!, model, trace: activeTrace, formatValue, unit, totalLabel };
      const custom = renderNodeTooltip?.(context); content = custom === undefined ? <SankeyNodeTooltip {...context} /> : custom;
    } else {
      const context: SankeyLinkTooltipContext = { link: model.linkBy.get(activeTrace.id)!, model, trace: activeTrace, formatValue, unit, totalLabel };
      const custom = renderLinkTooltip?.(context); content = custom === undefined ? <SankeyLinkTooltip {...context} /> : custom;
    }
  }
  const descriptionId = React.useId(), liveDescription = activeTrace ? activeTrace.kind === 'node'
    ? `${model.byId.get(activeTrace.id)!.label}, ${formatValue(activeTrace.value)}${unit ? ' ' + unit : ''}, ${sankeyPercent(activeTrace.share)} of ${totalLabel}.`
    : `${model.linkBy.get(activeTrace.id)!.s.label} to ${model.linkBy.get(activeTrace.id)!.t.label}, ${formatValue(activeTrace.value)}${unit ? ' ' + unit : ''}, ${sankeyPercent(activeTrace.share)} of ${totalLabel}.` : '';
  return <figure {...figureProps} ref={figure} data-slot="sankey-chart" className={['zero-sankey', className].filter(Boolean).join(' ')}
    style={{ ...style, ...(accent ? { '--zero-chart-series-1': accent, '--zero-sankey-accent': accent } : {}) } as React.CSSProperties}>
    <div className="zero-sankey__plot" ref={plot} tabIndex={0} role="group" aria-label={`${label}. ${model.links.length} flows across ${model.ncol} stages.`}
      aria-describedby={descriptionId} onKeyDown={onKeyDown} onFocus={event => {
        if (event.currentTarget.matches(':focus-visible') && !current) { const ci = model.cols.findIndex(col => col.length > 0); if (ci >= 0) goKeyboard(ci, 0); }
      }} onBlur={() => { if (keyboard.current) clear(); }} onPointerMove={event => {
        if (event.pointerType !== 'mouse' || pinned.current) return;
        const target = hitTarget(event); if (target) inspect(target, localPoint(event), 'pointer'); else if (current) clear('pointer');
      }} onPointerLeave={event => { if (event.pointerType === 'mouse' && !pinned.current) clear('pointer'); }} onPointerUp={event => {
        if (event.pointerType === 'mouse') return; const target = hitTarget(event);
        if (!target || sameTarget(target, current)) clear('touch'); else { pinned.current = true; inspect(target, localPoint(event), 'touch'); }
      }}>
      <svg ref={back} className="zero-sankey__back" aria-hidden="true" /><canvas ref={canvas} className="zero-sankey__canvas" aria-hidden="true" />
      <svg ref={front} className="zero-sankey__front" aria-hidden="true" />
      {model.links.length === 0 && <div className="zero-sankey__empty">{emptyLabel}</div>}
      <SankeyInspection open={inspection.open && !!current} content={content} point={layout.upright ? [layout.W / 2, inspection.point[1]] : inspection.point}
        upright={layout.upright} plotHeight={layout.H} onDismiss={() => clear()} />
    </div>
    <div className="zero-sankey__footer"><span className="zero-sankey__hint" aria-hidden="true">{layout.upright ? 'Tap a node or flow to trace it' : 'Hover a node or flow to trace it'}</span>
      {particleToggle && !reduced && motion && <Button type="button" variant="ghost" size="xs" animateIcon={false} className="zero-sankey__flow"
        aria-label={enabled ? 'Pause flow particles' : 'Resume flow particles'} aria-pressed={enabled} onClick={() => {
          if (particles === undefined) setLocalParticles(!enabled); onParticlesChange?.(!enabled);
        }}><i aria-hidden="true" />Flow</Button>}
    </div>
    <div className="zero-sankey__sr" id={descriptionId}>Use arrow keys to trace a node, Home and End to jump stages, Escape to clear. Traces assume proportional mixing, not exact individual journeys.</div>
    <div className="zero-sankey__sr" aria-live="polite" aria-atomic="true">{liveDescription}</div>
    <SankeyFlowTable model={model} label={label} formatValue={formatValue} unit={unit} />
  </figure>;
}

/** Server-rendered aggregate fallback remains available without a canvas, mouse or animations. */
export function SankeyFlowTable({ model, label, formatValue = defaultFormat, unit = '' }: {
  model: SankeyModel; label: string; formatValue?: (value: number) => string; unit?: string;
}) {
  return <div className="zero-sankey__sr"><table><caption>{label}</caption><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Value</th><th scope="col">Share of total</th></tr></thead>
    <tbody>{model.links.map(link => <tr key={link.id}><td>{link.s.label}</td><td>{link.t.label}</td><td>{formatValue(link.value)}{unit && ' ' + unit}</td>
      <td>{sankeyPercent(link.value / (model.total || 1))}</td></tr>)}</tbody>
  </table></div>;
}
