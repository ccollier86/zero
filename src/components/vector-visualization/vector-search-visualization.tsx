'use client';

/** Controlled search organism. Composes real operation snapshots, shared Zero primitives and the reference's compact inspection anatomy. */
import * as React from 'react';
import { cn } from '../../lib/utils';
import type { VectorVisualizationMap, VectorVisualizationPresentation, VectorVisualizationSnapshot } from '../../vector/visualization-types';
import { VectorMap } from './vector-map';
import type { VectorMapInspectionProps } from './vector-map-inspection';
import { VectorResults } from './vector-results';
import { VectorEmbeddingPreview, VisualizationCounts, VisualizationLegend, VisualizationOperationStatus, VisualizationStageRail } from './visualization-parts';

/** Shared organism options contain presentation only; snapshots/controllers own backend operations. */
export interface VectorSearchVisualizationProps extends Omit<React.ComponentProps<'section'>, 'children'>, VectorMapInspectionProps {
  snapshot?: VectorVisualizationSnapshot | null;
  map?: VectorVisualizationMap;
  presentation?: VectorVisualizationPresentation;
  motionEnabled?: boolean;
  paused?: boolean;
  onPausedChange?: (paused: boolean) => void;
  /** A visible caption, not a substitute for actual results/diagnostics. */
  caption?: React.ReactNode;
}

/** Render an authorized search/map state without starting requests, replaying a fake timeline or exposing raw provider failures. */
export function VectorSearchVisualization({ snapshot, map: suppliedMap, presentation = 'full', motionEnabled = true,
  paused = false, onPausedChange, selectedRecordId, onSelectRecord, selectedClusterId, onSelectCluster,
  renderRecordTooltip, renderClusterTooltip, renderQueryTooltip, caption, className, ...props }: VectorSearchVisualizationProps) {
  const map = snapshot?.map ?? suppliedMap, query = snapshot?.query, stages = snapshot?.stages ?? [];
  const dimensions = query?.dimensions ?? map?.dimensions;
  const trace = snapshot?.trace;
  const nativeTrace = trace?.provenance === 'native' && map?.capabilities.nativeTraversal;
  return <section {...props} aria-label={props['aria-label'] ?? 'Vector search visualization'} className={cn('zero-viz zero-viz--search', className)}
    data-slot="vector-search-visualization" data-presentation={presentation} data-operation-id={snapshot?.id}
    data-status={snapshot?.status ?? 'pending'} data-motion={motionEnabled ? 'on' : 'off'} data-paused={paused || undefined}>
    {stages.length > 0 && <VisualizationStageRail stages={stages} paused={paused} onPausedChange={onPausedChange} />}
    <div className="zero-viz__body">
      {presentation !== 'inspector' && <div className="zero-viz__stage"><VectorMap map={map} queryPosition={query?.position} query={query}
        candidates={snapshot?.candidates} results={snapshot?.results} trace={trace} selectedRecordId={selectedRecordId} onSelectRecord={onSelectRecord}
        selectedClusterId={selectedClusterId} onSelectCluster={onSelectCluster} renderRecordTooltip={renderRecordTooltip} renderClusterTooltip={renderClusterTooltip}
        renderQueryTooltip={renderQueryTooltip} /></div>}
      <aside className="zero-viz__inspector" aria-label="Search inspection">
        <VisualizationOperationStatus snapshot={snapshot} />
        <VisualizationCounts values={[{ label: 'Records', value: map?.totalRecords ?? map?.points.length },
          { label: 'Candidates', value: snapshot?.candidates?.length },
          ...(nativeTrace ? [{ label: 'Visited', value: trace.visitedIds.length }, { label: 'Comparisons', value: trace.comparisons }] : [])]} />
        <section className="zero-viz__query" aria-label="Query embedding">
          <div className="zero-viz__section-heading"><h3>Query</h3><span>{dimensions === undefined ? 'Dimensions unavailable' : `${dimensions.toLocaleString('en-US')} dims`}</span></div>
          <p className="zero-viz__query-text">{query?.text || <span className="zero-viz__placeholder">Ask a question to search this index.</span>}</p>
          <VectorEmbeddingPreview values={query?.embeddingPreview} dimensions={dimensions} label="Query vector preview" />
        </section>
        <VectorResults candidates={snapshot?.candidates} results={snapshot?.results} topK={query?.topK} operationId={snapshot?.id}
          onSelectRecord={onSelectRecord} selectedRecordId={selectedRecordId} motionEnabled={motionEnabled} paused={paused} clusters={map?.clusters} />
        {map && <VisualizationLegend clusters={map.clusters} />}
      </aside>
    </div>
    {caption && <p className="zero-viz__caption-note">{caption}</p>}
  </section>;
}
