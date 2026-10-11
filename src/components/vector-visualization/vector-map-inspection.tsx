'use client';

/** Controlled map inspection content. Only supplied, already authorized DTOs reach these renderers; no fetching or raw HTML. */
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import type { VectorVisualizationCandidate, VectorVisualizationCluster, VectorVisualizationMap, VectorVisualizationPoint,
  VectorVisualizationPosition, VectorVisualizationSnapshot } from '../../vector/visualization-types';
import { formatVectorScore, vectorMapDescription } from './visualization-geometry';

/** Actual map record and its optional retrieval diagnostics, available to a caller's tooltip renderer. */
export interface VectorRecordTooltipContext {
  point: VectorVisualizationPoint;
  map: VectorVisualizationMap;
  candidate?: VectorVisualizationCandidate;
  result?: VectorVisualizationCandidate;
  selected: boolean;
  visited: boolean;
}

/** A cluster's authorized sampled records, not a guessed total for the underlying corpus. */
export interface VectorClusterTooltipContext {
  cluster: VectorVisualizationCluster;
  map: VectorVisualizationMap;
  points: readonly VectorVisualizationPoint[];
  selected: boolean;
}

/** Supplied query diagnostics and position; a query marker is not a selectable indexed record. */
export interface VectorQueryTooltipContext {
  map?: VectorVisualizationMap;
  position: VectorVisualizationPosition;
  label: string;
  query?: VectorVisualizationSnapshot['query'];
}

/** Override individual tooltip bodies with React content. Undefined uses defaults; null deliberately hides that tooltip. */
export interface VectorMapInspectionProps {
  selectedRecordId?: string;
  onSelectRecord?: (id: string) => void;
  selectedClusterId?: string;
  onSelectCluster?: (id: string) => void;
  renderRecordTooltip?: (context: VectorRecordTooltipContext) => React.ReactNode;
  renderClusterTooltip?: (context: VectorClusterTooltipContext) => React.ReactNode;
  renderQueryTooltip?: (context: VectorQueryTooltipContext) => React.ReactNode;
}

/** Defaults retain truthful score/projection provenance and never invent per-record metadata. */
export function VectorRecordTooltip({ point, map, candidate, result, visited }: VectorRecordTooltipContext) {
  const ranked = result ?? candidate;
  const cluster = map.clusters.find(item => item.id === point.clusterId);
  return <div className="zero-viz__inspection-tooltip">
    <strong>{point.title}</strong>
    {point.source && <span>{point.source.label}</span>}
    {cluster && <span>Cluster: {cluster.label}</span>}
    <span>{map.dimensions.toLocaleString('en-US')} dimensions · {point.kind === 'new' ? 'New indexed record' : 'Indexed record'}</span>
    {ranked && <span>{result ? 'Result' : 'Candidate'} rank {result?.rank ?? ranked.foundRank} · {ranked.score.kind} {formatVectorScore(ranked.score)} · {ranked.score.direction === 'lower' ? 'Lower' : 'Higher'} is better</span>}
    {visited && <span>Visited in native search telemetry</span>}
  </div>;
}

/** Count only the supplied sampled records; the projection caption states graph provenance. */
export function VectorClusterTooltip({ cluster, map, points }: VectorClusterTooltipContext) {
  return <div className="zero-viz__inspection-tooltip"><strong>{cluster.label}</strong>
    <span>{points.length.toLocaleString('en-US')} sampled {points.length === 1 ? 'record' : 'records'}</span>
    <span>{vectorMapDescription(map)}</span>
  </div>;
}

/** Query text/mode/model information is displayed only when the caller supplied it. */
export function VectorQueryTooltip({ map, query, label }: VectorQueryTooltipContext) {
  const dimensions = query?.dimensions ?? map?.dimensions;
  return <div className="zero-viz__inspection-tooltip"><strong>{label}</strong>
    {query && <><span>{query.text}</span><span>{query.retrieval === 'hybrid' ? 'Hybrid retrieval' : 'Vector retrieval'} · requested top {query.topK}</span>
      <span>Reranking {query.rerank ? 'enabled' : 'disabled'}</span></>}
    {dimensions !== undefined && <span>{dimensions.toLocaleString('en-US')} dimensions</span>}
    {query?.model && <span>{query.model}</span>}
  </div>;
}

/** Both geometric targets and labels reuse Zero's portal, collision, focus and motion behavior. */
export function VectorInspectionTooltip({ children, content }: { children: React.ReactElement; content: React.ReactNode }) {
  return content === null ? children : <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent>{content}</TooltipContent></Tooltip>;
}
