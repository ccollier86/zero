'use client';
/** Race Bar inspection presents real blended values and exact-period comparisons; Zero Tooltip owns portals and collision handling. */
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../tooltip';
import type { RaceBarInspection as Inspection, RaceBarModel } from './race-bar-types';

/** Safe React extension context: displayed values are separate from the exact rounded-period delta. */
export interface RaceBarItemTooltipContext extends Inspection {
  model: RaceBarModel;
  formatValue: (value: number) => string;
  totalLabel: string;
}
function percentageMagnitude(ratio: number) {
  const magnitude = Math.abs(ratio);
  if (magnitude <= Number.MAX_VALUE / 100) return (magnitude * 100).toFixed(1);
  const [coefficient, exponent] = magnitude.toExponential(1).split('e');
  return `${coefficient}e+${Number(exponent) + 2}`;
}

/** Reference inspector with rank/all-items share and an explicitly named previous-period comparison. */
export function RaceBarItemTooltip(context: RaceBarItemTooltipContext) {
  const { item, value, rank, itemCount, share, changeRatio, previousFrame, frame, interpolated, formatValue, totalLabel } = context;
  return <div className="zero-race-bar__inspection">
    <div className="zero-race-bar__inspection-name">{item.label}</div>
    <div className="zero-race-bar__inspection-value">{formatValue(value)}</div>
    <div>Rank {rank + 1} of {itemCount}, {(share * 100).toFixed(1)}% of {totalLabel.toLowerCase()}</div>
    {changeRatio !== null && previousFrame && <div className="zero-race-bar__inspection-delta">
      {changeRatio >= 0 ? '+' : '−'}{percentageMagnitude(changeRatio)}%{interpolated && frame ? ` (${frame.period})` : ''} vs {previousFrame.period}
    </div>}
  </div>;
}

/** A position-only HTML anchor keeps the reference inspector separate from row hit testing. */
export function RaceBarInspector({ open, point, content, onDismiss }: {
  open: boolean; point: readonly [number, number]; content: React.ReactNode; onDismiss: () => void;
}) {
  return <Tooltip open={open && content !== null} delayDuration={0} motion="blur" arrow={false} disableHoverableContent
    onOpenChange={next => { if (!next && open) onDismiss(); }}>
    <TooltipTrigger asChild><span tabIndex={-1} aria-hidden="true" className="zero-race-bar__inspection-anchor" style={{ left: point[0], top: point[1] }} /></TooltipTrigger>
    <TooltipContent className="zero-race-bar__tooltip" side="top" sideOffset={6} align="center" collisionPadding={8} arrow={false}
      onEscapeKeyDown={event => { event.preventDefault(); onDismiss(); }}>{content}</TooltipContent>
  </Tooltip>;
}
