'use client';
/** Funnel view/flow chrome reuses Zero Button and Switch; state and measured band geometry belong to the organism. */
import * as React from 'react';
import { Button } from '../../ui/button';
import { Switch } from '../../ui/switch';
import type { FunnelModel, FunnelView } from './funnel-types';

/** Animated segment selection and independent aggregate-flow switch. All actions request parent state. */
export function FunnelControls({ model, view, flow, showView = true, showFlow = true, onViewChange, onFlowChange }: {
  model: FunnelModel; view: FunnelView; flow: boolean; showView?: boolean; showFlow?: boolean;
  onViewChange: (view: FunnelView) => void; onFlowChange: (flow: boolean) => void;
}) {
  const host = React.useRef<HTMLDivElement | null>(null), pill = React.useRef<HTMLSpanElement | null>(null);
  const splitId = React.useId(), flowId = React.useId();
  React.useLayoutEffect(() => {
    const place = () => { const selected = host.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!selected || !pill.current || !host.current) return; const box = selected.getBoundingClientRect(), parent = host.current.getBoundingClientRect();
      pill.current.style.width = box.width + 'px'; pill.current.style.height = box.height + 'px'; pill.current.style.transform = `translate(${box.left - parent.left}px,${box.top - parent.top}px)`; };
    place(); if (!host.current) return;
    const resize = new ResizeObserver(place); resize.observe(host.current);
    void document.fonts?.ready.then(place);
    return () => resize.disconnect();
  }, [model, view]);
  return <div className="zero-funnel__controls">
    {showView && model.segments.length > 0 && <>
      <div ref={host} className="zero-funnel__segments" role="group" aria-label="Segment">
        <span ref={pill} className="zero-funnel__pill" aria-hidden="true" />
        <Button variant="ghost" size="sm" animateIcon={false} type="button" aria-pressed={view.kind !== 'segment'}
          onClick={() => onViewChange({ kind: view.kind === 'split' ? 'split' : 'total' })}>All</Button>
        {model.segments.map(segment => <Button key={segment.id} variant="ghost" size="sm" animateIcon={false} type="button"
          aria-pressed={view.kind === 'segment' && view.id === segment.id} onClick={() => onViewChange({ kind: 'segment', id: segment.id })}>{segment.label}</Button>)}
      </div>
      <label htmlFor={splitId} className="zero-funnel__switch-label"><Switch id={splitId} className="zero-funnel__switch" pressedWidth={14}
        checked={view.kind === 'split'} onCheckedChange={checked => onViewChange({ kind: checked ? 'split' : 'total' })} />Split</label>
    </>}
    {showFlow && <label htmlFor={flowId} className="zero-funnel__switch-label"><Switch id={flowId} className="zero-funnel__switch" pressedWidth={14}
      checked={flow} onCheckedChange={onFlowChange} />Flow</label>}
  </div>;
}
