'use client';
/** React-only Sankey value/share inspection bodies; the existing Zero tooltip owns portals, layers and collision handling. */
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../tooltip';
import type { SankeyModel, SankeyModelNode, SankeyModelLink, SankeyTrace } from './sankey-types';

export interface SankeyNodeTooltipContext { node: SankeyModelNode; model: SankeyModel; trace: SankeyTrace; formatValue: (value: number) => string; unit: string; totalLabel: string; }
export interface SankeyLinkTooltipContext { link: SankeyModelLink; model: SankeyModel; trace: SankeyTrace; formatValue: (value: number) => string; unit: string; totalLabel: string; }
export const sankeyPercent = (share: number) => share > 0 && share < .005 ? '<1%' : Math.round(share * 100) + '%';

/** Display supplied aggregates only; the chart never fabricates exact person-level attribution. */
export function SankeyNodeTooltip({ node, model, formatValue, unit, totalLabel }: SankeyNodeTooltipContext) {
  const outgoing = node.outL.length > 0, links = [...(outgoing ? node.outL : node.inL)].sort((a, b) => b.value - a.value);
  return <div className="zero-sankey__inspection">
    <div className="zero-sankey__inspection-title">{node.label}</div>
    <div className="zero-sankey__inspection-value">{formatValue(node.value)}{unit && ' ' + unit}</div>
    <div className="zero-sankey__inspection-sub">{sankeyPercent(node.value / (model.total || 1))} of {totalLabel}</div>
    {links.length > 0 && <div className="zero-sankey__inspection-rows">{links.slice(0, 6).map(link => <div key={link.id}>
      <span>{outgoing ? 'to ' : 'from '}{(outgoing ? link.t : link.s).label}</span><b>{sankeyPercent(link.value / (node.value || 1))}</b>
    </div>)}{links.length > 6 && <div><span>+{links.length - 6} more</span></div>}</div>}
  </div>;
}

/** One ribbon's aggregate value and relative shares use the same formatting as plot labels. */
export function SankeyLinkTooltip({ link, formatValue, unit }: SankeyLinkTooltipContext) {
  return <div className="zero-sankey__inspection"><div className="zero-sankey__inspection-title">{link.s.label} to {link.t.label}</div>
    <div className="zero-sankey__inspection-value">{formatValue(link.value)}{unit && ' ' + unit}</div>
    <div className="zero-sankey__inspection-sub">{sankeyPercent(link.value / (link.s.value || 1))} of {link.s.label}, {sankeyPercent(link.value / (link.t.value || 1))} of {link.t.label}</div>
  </div>;
}

/** An HTML anchor keeps SVG hit testing separate from Zero's native tooltip trigger contract. */
export function SankeyInspection({ open, content, point, upright, plotHeight, onDismiss }: {
  open: boolean; content: React.ReactNode; point: readonly [number, number]; upright: boolean; plotHeight: number; onDismiss: () => void;
}) {
  // On narrow charts, anchor near the opposite end to keep both the finger and the traced journey clear.
  const side = upright ? point[1] > plotHeight / 2 ? 'bottom' : 'top' : 'bottom';
  const y = upright ? point[1] > plotHeight / 2 ? 4 : plotHeight - 4 : point[1];
  return <Tooltip open={open && content !== null} onOpenChange={next => { if (!next && open) onDismiss(); }} delayDuration={0}
    motion="blur" arrow={false} disableHoverableContent>
    <TooltipTrigger asChild><span aria-hidden="true" tabIndex={-1} className="zero-sankey__inspection-anchor"
      style={{ left: point[0], top: y }} /></TooltipTrigger>
    <TooltipContent className="zero-sankey__tooltip" side={side} sideOffset={upright ? 0 : 14} align={upright ? 'center' : 'start'}
      alignOffset={upright ? 0 : 16} collisionPadding={8} arrow={false} onEscapeKeyDown={event => { event.preventDefault(); onDismiss(); }}>
      {content}
    </TooltipContent>
  </Tooltip>;
}
