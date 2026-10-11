'use client';
/** Funnel inspection composes supplied aggregate counts into the shared Zero tooltip portal/collision engine. */
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../tooltip';
import { chartSeriesPaint, CHART_CATEGORICAL_COLORS } from '../chart-tokens';
import type { FunnelInspection, FunnelModel } from './funnel-types';

/** Custom React inspector extensions receive exact aggregates and nullable zero-baseline rates. */
export interface FunnelStageTooltipContext extends FunnelInspection {
  model: FunnelModel; formatValue: (value: number) => string; unit: string;
}
const percent = (ratio: number | null) => ratio === null ? '—' : (ratio > 0 && ratio < .1 ? (ratio * 100).toFixed(1) : Math.round(ratio * 100)) + '%';

/** Reference stage inspector names each visible segment and explicitly identifies the previous-step denominator. */
export function FunnelStageTooltip({ stage, view, rows, total, keptFromPrevious, previousStage, formatValue, unit }: FunnelStageTooltipContext) {
  return <div className="zero-funnel__inspection">
    <div className="zero-funnel__inspection-title">{stage.label}</div>
    {rows.map(row => <div key={row.segment?.id ?? '__total'} className="zero-funnel__inspection-row">
      <span>{row.segment && view.kind === 'split' && <i aria-hidden="true" style={{ background: chartSeriesPaint(row.segment.series, CHART_CATEGORICAL_COLORS, '--zero-funnel-series-') }} />}{row.segment?.label ?? 'Total'}</span>
      <b>{formatValue(row.value)}</b>
    </div>)}
    {view.kind === 'split' && <div className="zero-funnel__inspection-row"><span>Total</span><b>{formatValue(total)}</b></div>}
    <div className="zero-funnel__inspection-sub">{previousStage ? keptFromPrevious === null ? 'No previous-step baseline' : `${percent(keptFromPrevious)} kept from ${previousStage.label.charAt(0).toLowerCase() + previousStage.label.slice(1)}` : `Entry step${unit ? ', ' + unit : ''}`}</div>
  </div>;
}

/** Noninteractive position anchor keeps plot hit testing separate from Zero's owned tooltip layer. */
export function FunnelInspector({ open, content, point, vertical, stepSize, plot, onDismiss }: {
  open: boolean; content: React.ReactNode; point: readonly [number, number]; vertical: boolean; stepSize: number; plot?: HTMLElement | null; onDismiss: () => void;
}) {
  return <Tooltip open={open && content !== null} delayDuration={0} motion="blur" arrow={false} disableHoverableContent
    onOpenChange={next => { if (!next && open) onDismiss(); }}>
    {/* The complete stage span gives Zero's collision flip the opposite stage edge, not an overlapping trailing-edge point. */}
    <TooltipTrigger asChild><span tabIndex={-1} aria-hidden="true" className="zero-funnel__inspection-anchor" style={vertical
      ? { left: point[0], top: point[1] - stepSize, width: 1, height: stepSize }
      : { left: point[0] - stepSize, top: point[1], width: stepSize, height: 1 }} /></TooltipTrigger>
    <TooltipContent className="zero-funnel__tooltip" side={vertical ? 'bottom' : 'right'} sideOffset={vertical ? 6 : 8}
      align="center" collisionPadding={8} collisionBoundary={plot ?? undefined} arrow={false} onEscapeKeyDown={event => { event.preventDefault(); onDismiss(); }}>{content}</TooltipContent>
  </Tooltip>;
}
