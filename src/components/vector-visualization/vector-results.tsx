'use client';

/** Accessible compact ranked results with stable row identity and reference FLIP motion; no retrieval policy. */
import * as React from 'react';
import { useReducedMotion } from 'motion/react';
import { Button } from '../ui/button';
import { DenseList, DenseListItem } from '../dense-list';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import type { VectorVisualizationCandidate } from '../../vector/visualization-types';
import { formatVectorScore, vectorClusterSeries } from './visualization-geometry';
import { VisualizationRankDelta, VisualizationSourceTile } from './visualization-parts';

const useLayout = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;
const ownAnimations = new WeakMap<HTMLElement, Animation[]>();

/** Read durations from the scoped token cascade, including caller custom properties and reduced motion. */
function motionValue(styles: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = styles.getPropertyValue(property).trim(), number = parseFloat(value);
  return Number.isFinite(number) ? Math.max(0, number * (value.endsWith('ms') ? 1 : value.endsWith('s') ? 1000 : 1)) : fallback;
}

/** FLIP reused rows from their current in-flight pose; effect cleanup cancels only owned animations. */
function useResultMotion(ref: React.RefObject<HTMLUListElement | null>, signature: string, operationId: string | undefined,
  motionEnabled: boolean, paused: boolean) {
  const reduced = useReducedMotion(), before = React.useRef(new Map<string, number>()), owner = React.useRef(operationId);
  useLayout(() => {
    const node = ref.current; if (!node) return;
    if (owner.current !== operationId) { before.current.clear(); owner.current = operationId; }
    const styles = getComputedStyle(node), move = motionValue(styles, '--zero-viz-motion-rank-move', 700),
      stagger = motionValue(styles, '--zero-viz-motion-rank-stagger', 70),
      enter = motionValue(styles, '--zero-viz-motion-result-enter', 400), ease = styles.getPropertyValue('--zero-viz-ease').trim() || 'cubic-bezier(.2,0,0,1)';
    const next = new Map<string, number>();
    const bodyTop = node.getBoundingClientRect().top;
    for (const row of node.querySelectorAll<HTMLElement>(':scope > [data-record-id]')) {
      const id = row.dataset.recordId!, previous = before.current.get(id), style = getComputedStyle(row),
        matrix = style.transform === 'none' ? null : new DOMMatrixReadOnly(style.transform), dyInFlight = matrix?.m42 ?? 0;
      for (const animation of ownAnimations.get(row) ?? []) animation.cancel();
      const top = row.getBoundingClientRect().top - bodyTop;
      next.set(id, top);
      // A paused presentation must still reveal newly accepted results instantly.
      if (!motionEnabled || paused || reduced || typeof row.animate !== 'function') continue;
      const animation = previous === undefined
        ? row.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: enter, easing: ease })
        : Math.abs(previous + dyInFlight - top) > .5 ? row.animate([{ transform: `translateY(${previous + dyInFlight - top}px)` }, { transform: 'none' }],
          { duration: move, delay: Number(row.dataset.rankOrder ?? 0) * stagger, easing: ease, fill: 'backwards' }) : undefined;
      if (animation) ownAnimations.set(row, [animation]);
    }
    before.current = next;
  }, [signature, operationId, motionEnabled, reduced, paused]);
  useLayout(() => { const node = ref.current; return () => {
    for (const row of node?.querySelectorAll<HTMLElement>(':scope > [data-record-id]') ?? []) {
      for (const animation of ownAnimations.get(row) ?? []) animation.cancel(); ownAnimations.delete(row);
    }
  }; }, []);
}

/** Final accepted ranks replace found-order candidates without replacing surviving DOM rows. */
export function VectorResults({ candidates = [], results, topK, operationId, onSelectRecord, selectedRecordId,
  motionEnabled = true, paused = false, clusters = [] }: {
  candidates?: readonly VectorVisualizationCandidate[]; results?: readonly VectorVisualizationCandidate[];
  topK?: number; operationId?: string; onSelectRecord?: (id: string) => void; selectedRecordId?: string;
  motionEnabled?: boolean; paused?: boolean;
  clusters?: readonly { id: string }[];
}) {
  const ref = React.useRef<HTMLUListElement>(null), ranked = results !== undefined;
  const resultIds = new Set(results?.map(item => item.id));
  const rows = ranked ? [...results, ...candidates.filter(item => !resultIds.has(item.id))]
    : [...candidates].sort((a, b) => a.foundRank - b.foundRank);
  const signature = JSON.stringify(rows.map(item => [item.id, item.rank, item.foundRank, item.score.value]));
  useResultMotion(ref, signature, operationId, motionEnabled, paused);
  const max = Math.max(1e-9, ...rows.filter(item => Number.isFinite(item.score.value)).map(item => Math.abs(item.score.value)));
  return <section className="zero-viz__results" data-slot="vector-results" aria-label={ranked ? 'Search results' : 'Search candidates'}>
    <div className="zero-viz__section-heading"><h3>{ranked ? 'Results' : 'Candidates'}</h3>
      {topK !== undefined && <span aria-label={ranked ? `Requested top ${topK}; ${results.length} returned${candidates.length ? ` of ${candidates.length} candidates` : ''}` : `Requested top ${topK}`}>
        {ranked ? `top ${results.length}${candidates.length > 0 ? ` of ${candidates.length}` : ''}` : `top ${topK} requested`}</span>}</div>
    {rows.length ? <DenseList ref={ref} density="compact" className="zero-viz__result-list" aria-label="Ranked records">
      {rows.map((item, index) => {
        const returned = !ranked || resultIds.has(item.id), rank = ranked ? item.rank : item.foundRank;
        const title = onSelectRecord ? <Button type="button" variant="ghost" size="xs" className="zero-viz__result-title"
          aria-label={`Inspect ${item.title}`} aria-pressed={selectedRecordId === item.id} onClick={() => onSelectRecord(item.id)}>{item.title}</Button>
          : <Tooltip overflowOnly><TooltipTrigger asChild><span className="zero-viz__result-title" tabIndex={0}>{item.title}</span></TooltipTrigger>
            <TooltipContent>{item.title}</TooltipContent></Tooltip>;
        return <DenseListItem key={item.id} data-record-id={item.id} data-rank-order={Math.max(0, rank - 1)} data-returned={returned} data-selected={selectedRecordId === item.id || undefined}
          className="zero-viz__result" title={title} description={item.source?.label}
          leading={<><span className="zero-viz__rank"><span aria-label={`Rank ${rank}`}>{rank}</span>
            {ranked && <VisualizationRankDelta foundRank={item.foundRank} rank={item.rank} />}</span>
            <VisualizationSourceTile label={item.source?.label} abbreviation={item.source?.abbreviation} identity={item.clusterId ?? item.source?.id ?? item.id}
              series={vectorClusterSeries(clusters, item.clusterId ?? item.source?.id ?? item.id)} /></>}
          trailing={<Tooltip><TooltipTrigger asChild><span className="zero-viz__score" tabIndex={0}
            aria-label={`${item.score.kind} score ${formatVectorScore(item.score)}, ${item.score.direction} is better`}>
            <span key={`${item.score.kind}-${item.score.value}`} className="zero-viz__score-value">{formatVectorScore(item.score)}</span>
            <i aria-hidden="true"><span style={{ transform: `scaleX(${Number.isFinite(item.score.value) ? Math.abs(item.score.value) / max : 0})` }} /></i>
          </span></TooltipTrigger><TooltipContent>{item.score.kind} · {item.score.direction === 'lower' ? 'Lower' : 'Higher'} is better. Bar is relative to this candidate set.</TooltipContent></Tooltip>}
          style={{ '--zero-viz-order': index } as React.CSSProperties} />;
      })}
    </DenseList> : <p className="zero-viz__empty">No candidates have been returned.</p>}
  </section>;
}
