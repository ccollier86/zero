'use client';

/** Isometric display of an authorized map sample. Never calculates neighbors, embeddings or native traversal. */
import * as React from 'react';
import { Button } from '../ui/button';
import type { VectorVisualizationCandidate, VectorVisualizationMap, VectorVisualizationPosition, VectorVisualizationTrace,
  VectorVisualizationSnapshot } from '../../vector/visualization-types';
import { formatVectorScore, projectVectorPosition, VECTOR_VISUALIZATION_GEOMETRY as G, vectorMapDescription,
  vectorMapEdges, vectorClusterSeries } from './visualization-geometry';
import { VectorClusterTooltip, VectorInspectionTooltip, VectorRecordTooltip, VectorQueryTooltip,
  type VectorMapInspectionProps, type VectorClusterTooltipContext, type VectorRecordTooltipContext, type VectorQueryTooltipContext } from './vector-map-inspection';

/** Supplied map/query/result identities drive the drawing; selection remains caller-owned. */
export interface VectorMapProps extends VectorMapInspectionProps {
  map?: VectorVisualizationMap;
  queryPosition?: VectorVisualizationPosition;
  queryLabel?: string;
  /** Optional accepted query diagnostics populate marker inspection without fetching. */
  query?: VectorVisualizationSnapshot['query'];
  candidates?: readonly VectorVisualizationCandidate[];
  results?: readonly VectorVisualizationCandidate[];
  trace?: VectorVisualizationTrace;
  className?: string;
  /** Pipeline scenes render this same caption outside their absolute map inset. */
  showCaption?: boolean;
}

const pointText = (point: { x: number; y: number }) => `${point.x},${point.y}`;
const locationStyle = (point: { x: number; y: number }): React.CSSProperties => ({ left: `${point.x / G.width * 100}%`, top: `${point.y / G.height * 100}%` });

/** Layout-only collision avoidance mirrors the reference without changing record coordinates/ranks. */
function rankLabels(results: readonly VectorVisualizationCandidate[], positions: Map<string, { x: number; y: number }>,
  query: { x: number; y: number } | null, width: number) {
  const scale = G.width / Math.max(1, width), boxWidth = 52 * scale, boxHeight = 19 * scale;
  const labels = results.flatMap(result => {
    const p = positions.get(result.id); if (!p) return [];
    let dx = query ? p.x - query.x : 0, dy = query ? p.y - query.y : 1;
    const length = Math.hypot(dx, dy); if (length < 2) { dx = 0; dy = 1; } else { dx /= length; dy /= length; }
    return [{ result, x: p.x + dx * 26, y: p.y + dy * 16 }];
  });
  for (let iteration = 0; iteration < 60; iteration++) {
    let moved = false;
    for (let a = 0; a < labels.length; a++) {
      const first = labels[a]!;
      for (let b = a + 1; b < labels.length; b++) {
        const second = labels[b]!, dx = second.x - first.x, dy = second.y - first.y;
        if (Math.abs(dx) < boxWidth && Math.abs(dy) < boxHeight) {
          const shift = (boxHeight - Math.abs(dy)) / 2 + .5, direction = dy >= 0 ? 1 : -1;
          first.y -= shift * direction; second.y += shift * direction; moved = true;
        }
      }
      if (query && Math.abs(first.x - query.x) < boxWidth / 2 + 9 && Math.abs(first.y - query.y) < boxHeight / 2 + 9) {
        first.x += first.x >= query.x ? 3 : -3; moved = true;
      }
      const queryLabelY = query ? query.y - 36 : 0;
      if (query && Math.abs(first.x - query.x) < boxWidth && Math.abs(first.y - queryLabelY) < boxHeight + 3) {
        first.y = queryLabelY + (first.y >= queryLabelY ? 1 : -1) * (boxHeight + 4); moved = true;
      }
    }
    if (!moved) break;
  }
  return labels.map(item => ({ ...item, x: Math.max(boxWidth / 2 + 4, Math.min(G.width - boxWidth / 2 - 4, item.x)),
    y: Math.max(boxHeight / 2 + 4, Math.min(G.height - boxHeight / 2 - 4, item.y)) }));
}

/** Draw the reference slab, clusters, graph and query marker with theme-derived paint. */
export function VectorMap({ map, queryPosition, queryLabel = 'Query', query: queryDetails, candidates = [], results = [], trace,
  selectedRecordId, onSelectRecord, selectedClusterId, onSelectCluster, renderRecordTooltip, renderClusterTooltip, renderQueryTooltip,
  className, showCaption = true }: VectorMapProps) {
  const stage = React.useRef<HTMLDivElement>(null), [width, setWidth] = React.useState<number>(G.width);
  React.useEffect(() => {
    const element = stage.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => { const measured = element.clientWidth; if (measured > 0) setWidth(measured); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const positions = new Map<string, { x: number; y: number }>();
  for (const point of map?.points ?? []) { const projected = projectVectorPosition(point.position); if (projected) positions.set(point.id, projected); }
  const corners = [projectVectorPosition({ x: -1, y: -1 })!, projectVectorPosition({ x: 1, y: -1 })!,
    projectVectorPosition({ x: 1, y: 1 })!, projectVectorPosition({ x: -1, y: 1 })!];
  const [top, right, bottom, left] = corners as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const suppliedQueryPosition = queryPosition ?? queryDetails?.position;
  const query = suppliedQueryPosition ? projectVectorPosition(suppliedQueryPosition) : null;
  const queryContext: VectorQueryTooltipContext | null = query && suppliedQueryPosition
    ? { map, position: suppliedQueryPosition, label: queryLabel, query: queryDetails } : null;
  const renderedQueryTooltip = queryContext ? renderQueryTooltip?.(queryContext) : undefined;
  const queryTooltip = queryContext && renderedQueryTooltip === undefined ? <VectorQueryTooltip {...queryContext} /> : renderedQueryTooltip;
  const candidateIds = new Set(candidates.map(item => item.id)), resultIds = new Set(results.map(item => item.id));
  const allowedTrace = trace?.provenance === 'illustrative' || map?.capabilities.nativeTraversal ? trace : undefined;
  const visited = new Set(allowedTrace?.visitedIds ?? []);
  const labels = rankLabels(results, positions, query, width);
  const clusters = (map?.clusters ?? []).flatMap(cluster => {
    const points = map!.points.filter(point => point.clusterId === cluster.id && positions.has(point.id));
    if (!points.length) return [];
    const u = points.reduce((sum, point) => sum + Math.max(-1, Math.min(1, point.position.x)), 0) / points.length;
    const v = points.reduce((sum, point) => sum + Math.max(-1, Math.min(1, point.position.y)), 0) / points.length;
    const radius = Math.min(.8685, Math.max(.08, ...points.map(point => Math.hypot(point.position.x - u, point.position.y - v))) + .07);
    const position = { x: Math.max(-.965 + radius, Math.min(.965 - radius, u)), y: Math.max(-.965 + radius, Math.min(.965 - radius, v)) };
    const projected = projectVectorPosition(position)!;
    const context: VectorClusterTooltipContext = { cluster, map: map!, points, selected: cluster.id === selectedClusterId };
    const rendered = renderClusterTooltip?.(context);
    const tooltip = rendered === undefined ? <VectorClusterTooltip {...context} /> : rendered;
    return [{ cluster, position, radius, projected, above: (u + v) / 2 < -.2, context, tooltip }];
  });
  return <figure className={`zero-viz__map${className ? ` ${className}` : ''}`} data-slot="vector-map" data-projection={map?.projectionId}
    data-map-revision={map?.revision} data-trace={allowedTrace?.provenance ?? 'none'}>
    <div className="zero-viz__map-stage" ref={stage}>
      <svg viewBox={`0 0 ${G.width} ${G.height}`} className="zero-viz__map-svg" aria-hidden="true">
        <polygon className="zero-viz__plane-left" points={[left, bottom, { x: bottom.x, y: bottom.y + G.slab }, { x: left.x, y: left.y + G.slab }].map(pointText).join(' ')} />
        <polygon className="zero-viz__plane-right" points={[bottom, right, { x: right.x, y: right.y + G.slab }, { x: bottom.x, y: bottom.y + G.slab }].map(pointText).join(' ')} />
        <polygon className="zero-viz__plane-top" points={corners.map(pointText).join(' ')} />
        <g className="zero-viz__grid">{Array.from({ length: G.gridDivisions - 1 }, (_, index) => {
          const value = -1 + (index + 1) / 4, a = projectVectorPosition({ x: value, y: -1 })!, b = projectVectorPosition({ x: value, y: 1 })!,
            c = projectVectorPosition({ x: -1, y: value })!, d = projectVectorPosition({ x: 1, y: value })!;
          return <React.Fragment key={index}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><line x1={c.x} y1={c.y} x2={d.x} y2={d.y} /></React.Fragment>;
        })}</g>
        <g transform={`matrix(${G.halfWidth / 2},${G.halfHeight / 2},${-G.halfWidth / 2},${G.halfHeight / 2},${G.centerX},${G.centerY})`}>
          {clusters.map(item => <circle key={item.cluster.id} className="zero-viz__cluster-region" data-series={vectorClusterSeries(map?.clusters ?? [], item.cluster.id)}
            data-selected={item.context.selected || undefined} cx={item.position.x} cy={item.position.y} r={item.radius} vectorEffect="non-scaling-stroke" />)}
        </g>
        <g className="zero-viz__links">{map && vectorMapEdges(map).map(edge => {
          const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null;
          return <line key={JSON.stringify([edge.from, edge.to])} x1={a.x} y1={a.y} x2={b.x} y2={b.y} pathLength="1"
            data-slot="vector-neighbor-edge" />;
        })}</g>
        <g className="zero-viz__traversal">{allowedTrace?.edges?.map((edge, index) => {
          const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null;
          const lift = 9 + Math.hypot(b.x - a.x, b.y - a.y) * .12;
          return <path key={`${edge.from}-${edge.to}-${index}`} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 - lift} ${b.x},${b.y}`}
            pathLength="1" data-slot="vector-trace-edge" style={{ '--zero-viz-order': index } as React.CSSProperties} />;
        })}</g>
        {query && <g className="zero-viz__query-links">{candidates.map(candidate => {
          const p = positions.get(candidate.id); if (!p) return null;
          return <line key={candidate.id} x1={query.x} y1={query.y} x2={p.x} y2={p.y} pathLength="1" data-returned={resultIds.has(candidate.id)} />;
        })}</g>}
        {query && <g transform={`translate(${query.x},${query.y})`} data-slot="vector-query-marker">
          <ellipse className="zero-viz__query-shadow" rx="7" ry={7 * G.halfHeight / G.halfWidth} />
          <line className="zero-viz__query-stem" y1="-22" y2="0" />
          <g className="zero-viz__query-target"><circle className="zero-viz__query-outer" r="7.5" /><circle className="zero-viz__query-inner" r="3.8" /></g>
          <ellipse className="zero-viz__query-ripple" rx="16" ry={16 * G.halfHeight / G.halfWidth} />
        </g>}
        <text className="zero-viz__map-index" x={right.x - 4} y={right.y - 10} textAnchor="end">vector index</text>
      </svg>
      <svg viewBox={`0 0 ${G.width} ${G.height}`} className="zero-viz__cluster-targets" aria-label="Vector cluster inspection">
        <g transform={`matrix(${G.halfWidth / 2},${G.halfHeight / 2},${-G.halfWidth / 2},${G.halfHeight / 2},${G.centerX},${G.centerY})`}>
          {clusters.map(item => <VectorInspectionTooltip key={item.cluster.id} content={item.tooltip}>
            <circle className="zero-viz__cluster-target" data-cluster-id={item.cluster.id}
              data-series={vectorClusterSeries(map?.clusters ?? [], item.cluster.id)} data-selected={item.context.selected || undefined}
              cx={item.position.x} cy={item.position.y} r={item.radius} vectorEffect="non-scaling-stroke"
              tabIndex={0} role={onSelectCluster ? 'button' : 'img'} aria-label={`${onSelectCluster ? 'Inspect' : 'Cluster'} ${item.cluster.label}`}
              aria-pressed={onSelectCluster ? item.context.selected : undefined}
              onClick={onSelectCluster ? () => onSelectCluster(item.cluster.id) : undefined}
              onKeyDown={event => { if (onSelectCluster && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectCluster(item.cluster.id); } }} />
          </VectorInspectionTooltip>)}
        </g>
      </svg>
      <div className="zero-viz__map-overlay">
        {clusters.map(item => {
          const props = { className: 'zero-viz__cluster-label', 'data-cluster-id': item.cluster.id,
            'data-series': vectorClusterSeries(map?.clusters ?? [], item.cluster.id), 'data-selected': item.context.selected || undefined,
            style: locationStyle({ x: item.projected.x, y: item.projected.y + (item.above ? -1 : 1) * (item.radius * Math.SQRT1_2 * G.halfHeight + 13) }) };
          const content = <><i aria-hidden="true" />{item.cluster.label}</>;
          return <VectorInspectionTooltip key={item.cluster.id} content={item.tooltip}>{onSelectCluster
            ? <Button {...props} type="button" variant="ghost" size="xs" tabIndex={-1} aria-label={`Inspect ${item.cluster.label}`}
              aria-pressed={item.context.selected} onClick={() => onSelectCluster(item.cluster.id)}>{content}</Button>
            : <span {...props} tabIndex={-1} role="img" aria-label={`Cluster ${item.cluster.label}`}>{content}</span>}</VectorInspectionTooltip>;
        })}
        {(map?.points ?? []).map(point => {
          const p = positions.get(point.id); if (!p) return null;
          const content = <><span className="zero-viz__point-dot" /><span className="zero-viz__point-ring" /></>;
          const props = { className: 'zero-viz__point', style: locationStyle(p), 'data-series': vectorClusterSeries(map?.clusters ?? [], point.clusterId ?? point.source?.id ?? point.id),
            'data-kind': point.kind ?? 'stored', 'data-candidate': candidateIds.has(point.id) || undefined,
            'data-returned': resultIds.has(point.id) || undefined, 'data-visited': visited.has(point.id) || undefined,
            'data-selected': point.id === selectedRecordId || undefined, 'data-record-id': point.id };
          const context: VectorRecordTooltipContext = { point, map: map!, candidate: candidates.find(item => item.id === point.id),
            result: results.find(item => item.id === point.id), selected: point.id === selectedRecordId,
            visited: Boolean(map?.capabilities.nativeTraversal && trace?.provenance === 'native' && visited.has(point.id)) };
          const rendered = renderRecordTooltip?.(context);
          return <VectorInspectionTooltip key={point.id} content={rendered === undefined ? <VectorRecordTooltip {...context} /> : rendered}>{onSelectRecord
            ? <Button {...props} type="button" variant="ghost" size="icon-xs" aria-label={`Inspect ${point.title}`}
              aria-pressed={point.id === selectedRecordId} onClick={() => onSelectRecord(point.id)}>{content}</Button>
            : <span {...props} tabIndex={0} role="img" aria-label={point.title}>{content}</span>}</VectorInspectionTooltip>;
        })}
        {query && <><VectorInspectionTooltip content={queryTooltip}><span className="zero-viz__query-inspect" data-slot="vector-query-inspection"
          tabIndex={0} role="img" aria-label={`${queryLabel} marker`} style={locationStyle(query)} /></VectorInspectionTooltip>
          <VectorInspectionTooltip content={queryTooltip}><span className="zero-viz__query-label" tabIndex={-1} role="img"
            aria-label={`${queryLabel} marker label`} style={locationStyle({ x: query.x, y: query.y - 36 })}>{queryLabel}</span></VectorInspectionTooltip></>}
        {labels.map(item => <span key={item.result.id} className="zero-viz__map-score" data-record-id={item.result.id}
          style={locationStyle(item)} aria-hidden="true"><b>{item.result.rank}</b>{formatVectorScore(item.result.score)}</span>)}
      </div>
    </div>
    {showCaption && <figcaption className="zero-viz__map-note">{map ? vectorMapDescription(map) : 'The vector map will appear when an authorized snapshot is available.'}
      {allowedTrace?.provenance === 'illustrative' && <span>Illustrative sample traversal · not native index telemetry</span>}
    </figcaption>}
  </figure>;
}
