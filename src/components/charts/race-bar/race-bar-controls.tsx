'use client';
/** Composable playback/timeline chrome. The parent paint clock owns fractional position; controls only request interaction. */
import * as React from 'react';
import { Button } from '../../ui/button';
import type { RaceBarModel } from './race-bar-types';

/** Reference 30px shared Zero action; visual state is playback intent rather than off-screen effective pause. */
export function RaceBarPlaybackButton({ playing, atEnd, disabled, onToggle }: { playing: boolean; atEnd: boolean; disabled: boolean; onToggle: () => void }) {
  const state = playing ? 'pause' : atEnd ? 'replay' : 'play';
  return <Button variant="outline" size="icon-xs" animateIcon={false} type="button" className="zero-race-bar__button" data-icon={state}
    disabled={disabled} aria-label={state === 'pause' ? 'Pause' : state === 'replay' ? 'Replay' : 'Play'} onClick={onToggle}>
    {state === 'play' ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86l-6.1-3.8A.5.5 0 0 0 3.5 2.2z" fill="currentColor" /></svg>
      : state === 'pause' ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2" width="2.3" height="8" rx=".7" fill="currentColor" /><rect x="7.2" y="2" width="2.3" height="8" rx=".7" fill="currentColor" /></svg>
      : <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><path d="M2.6 6.5a3.9 3.9 0 1 0 1.15-2.76" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M3.2 1.4v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
  </Button>;
}

/** Native accessible range overlays the reference marks/track/thumb, with captured continuous drag and snap-on-release. */
export function RaceBarTimeline({ model, sliderRef, fillRef, thumbRef, onKeyDown, onScrub, onEndScrub }: {
  model: RaceBarModel; sliderRef: React.RefObject<HTMLInputElement | null>; fillRef: React.RefObject<HTMLDivElement | null>;
  thumbRef: React.RefObject<HTMLDivElement | null>; onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  onScrub: (position: number) => void; onEndScrub: () => void;
}) {
  const dragging = React.useRef<number | null>(null);
  const position = (event: React.PointerEvent<HTMLInputElement>) => { const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * Math.max(0, model.frames.length - 1) : 0; };
  const end = (event: React.PointerEvent<HTMLInputElement>) => { if (dragging.current !== event.pointerId) return;
    dragging.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); onEndScrub(); };
  return <div className="zero-race-bar__timeline">
    <div className="zero-race-bar__track" aria-hidden="true"><div className="zero-race-bar__fill" ref={fillRef} /><div className="zero-race-bar__marks">{model.frames.map((frame, index) =>
      <i key={frame.id} className="zero-race-bar__mark" data-frame={index} style={{ left: (model.frames.length > 1 ? index / (model.frames.length - 1) * 100 : 0) + '%' }} />)}</div></div>
    <div className="zero-race-bar__thumb" ref={thumbRef} aria-hidden="true" />
    <input ref={sliderRef} className="zero-race-bar__range" type="range" min={0} max={Math.max(0, model.frames.length - 1)} step="any" defaultValue={0}
      aria-label="Period" disabled={model.frames.length < 2} onKeyDown={onKeyDown}
      onChange={event => { if (dragging.current === null) { onScrub(Number(event.currentTarget.value)); onEndScrub(); } }}
      onPointerDown={event => { if (model.frames.length < 2 || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus();
        dragging.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); onScrub(position(event)); }}
      onPointerMove={event => { if (dragging.current === event.pointerId) onScrub(position(event)); }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={event => { if (dragging.current !== null) { dragging.current = null; onEndScrub(); } }} />
  </div>;
}
