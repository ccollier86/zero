'use client';

/** Controlled ingestion organism. Document/chunk previews are authorized DTOs; callbacks select presentation only. */
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { DenseList, DenseListItem } from '../dense-list';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import type { VectorVisualizationChunk, VectorVisualizationMap, VectorVisualizationPresentation, VectorVisualizationSnapshot } from '../../vector/visualization-types';
import { IngestionScene } from './ingestion-scene';
import type { VectorMapInspectionProps } from './vector-map-inspection';
import { vectorClusterSeries } from './visualization-geometry';
import { ChunkReceipt, VectorEmbeddingPreview, VisualizationCounts, VisualizationLegend, VisualizationMetadata,
  VisualizationOperationStatus, VisualizationStageRail, visualizationStatusLabel } from './visualization-parts';

/** Explicit snapshot and presentation controls; no fetch, provider configuration or storage policy is accepted. */
export interface IngestionPipelineVisualizationProps extends Omit<React.ComponentProps<'section'>, 'children'>, VectorMapInspectionProps {
  snapshot?: VectorVisualizationSnapshot | null;
  map?: VectorVisualizationMap;
  presentation?: VectorVisualizationPresentation;
  motionEnabled?: boolean;
  paused?: boolean;
  onPausedChange?: (paused: boolean) => void;
  selectedChunkId?: string;
  onSelectChunk?: (id: string) => void;
  caption?: React.ReactNode;
}

/** Source overlap highlighting follows supplied source ranges; it never recomputes chunk boundaries. */
export function IngestionChunkText({ chunk }: { chunk: VectorVisualizationChunk }) {
  const overlap = Math.max(0, Math.min(chunk.text.length, Number.isFinite(chunk.overlapChars) ? chunk.overlapChars : 0));
  return <p className="zero-viz__chunk-text">{overlap > 0 && <mark title="Shared with the preceding chunk">{chunk.text.slice(0, overlap)}</mark>}{chunk.text.slice(overlap)}</p>;
}

/** Render real stage/queue/model/arrival state without making visual completion a storage receipt. */
export function IngestionPipelineVisualization({ snapshot, map: suppliedMap, presentation = 'full', motionEnabled = true,
  paused = false, onPausedChange, selectedChunkId, onSelectChunk, selectedRecordId, onSelectRecord,
  selectedClusterId, onSelectCluster, renderRecordTooltip, renderClusterTooltip, renderQueryTooltip, caption, className, ...props }: IngestionPipelineVisualizationProps) {
  const [selection, setSelection] = React.useState<{ operation: string | undefined; id: string } | null>(null);
  const ingestion = snapshot?.ingestion, map = snapshot?.map ?? suppliedMap, chunks = ingestion?.chunks ?? [];
  const selected = selectedChunkId ?? (selection?.operation === snapshot?.id ? selection?.id : undefined) ?? ingestion?.currentChunkId;
  const current = chunks.find(chunk => chunk.id === selected);
  const active = chunks.find(chunk => chunk.id === ingestion?.currentChunkId);
  const dimensions = current?.dimensions ?? map?.dimensions;
  const model = map?.model ?? snapshot?.query?.model;
  const select = (id: string) => { setSelection({ operation: snapshot?.id, id }); onSelectChunk?.(id); };
  const metadata = current ? [
    { label: 'Document', value: ingestion?.document.title ?? '—' }, { label: 'Section', value: current.section ?? '—' },
    { label: 'Position', value: `${current.index + 1} · chars ${current.start}–${current.end}` },
    { label: 'Overlap', value: current.overlapChars ? `${current.overlapChars} characters with preceding chunk` : 'None' },
    { label: 'Status', value: current.storedAt ? 'Storage acknowledged' : visualizationStatusLabel(current.status) },
    ...Object.entries(current.metadata ?? {}).map(([label, value]) => ({ label, value: value === null ? '—' : String(value) })),
  ] : [];
  return <section {...props} className={cn('zero-viz zero-viz--ingestion', className)} aria-label={props['aria-label'] ?? 'Ingestion pipeline visualization'}
    data-slot="ingestion-pipeline-visualization" data-operation-id={snapshot?.id} data-status={snapshot?.status ?? 'pending'}
    data-presentation={presentation} data-motion={motionEnabled ? 'on' : 'off'} data-paused={paused || undefined}>
    {snapshot?.stages.length ? <VisualizationStageRail stages={snapshot.stages} paused={paused} onPausedChange={onPausedChange} /> : null}
    <div className="zero-viz__body">
      {presentation !== 'inspector' && <div className="zero-viz__stage"><IngestionScene ingestion={ingestion} map={map} currentChunk={active}
        model={model} selectedRecordId={selectedRecordId} onSelectRecord={onSelectRecord} selectedClusterId={selectedClusterId}
        onSelectCluster={onSelectCluster} renderRecordTooltip={renderRecordTooltip} renderClusterTooltip={renderClusterTooltip} renderQueryTooltip={renderQueryTooltip} /></div>}
      <aside className="zero-viz__inspector" aria-label="Ingestion inspection">
        <VisualizationOperationStatus snapshot={snapshot} />
        <VisualizationCounts values={[{ label: 'Documents', value: ingestion ? 1 : undefined }, { label: 'Chunks', value: ingestion?.chunks.length },
          { label: 'Tokens', value: ingestion?.tokenCount, approximate: ingestion?.tokenCountApproximate }, { label: 'Stored', value: ingestion?.completedChunks }]} />
        <section className="zero-viz__current-chunk" aria-label="Current chunk inspection">
          <div className="zero-viz__section-heading"><h3>Current chunk</h3><span>{current ? `C${current.index + 1} of ${chunks.length}` : 'No chunk selected'}</span></div>
          {current ? <><p className="zero-viz__query-text">{current.section || ingestion?.document.title}</p><IngestionChunkText chunk={current} />
            <VisualizationMetadata values={metadata} /><div className="zero-viz__section-heading zero-viz__embedding-heading"><span>Embedding</span>
              <span>{dimensions === undefined ? 'Not available yet' : `${dimensions.toLocaleString('en-US')} dims`}</span></div>
            <VectorEmbeddingPreview values={current.embeddingPreview} dimensions={dimensions} label={`Chunk ${current.index + 1} vector preview`}
              series={vectorClusterSeries(map?.clusters ?? [], ingestion?.document.clusterId ?? ingestion?.document.id ?? 'document')} /></>
            : <p className="zero-viz__empty">Accepted chunks and their diagnostics appear here.</p>}
        </section>
        {chunks.length > 0 && <section className="zero-viz__chunks" aria-label="Chunk queue">
          <div className="zero-viz__section-heading"><h3>Chunks</h3><span>{ingestion?.completedChunks ?? 0} stored</span></div>
          <DenseList density="compact" className="zero-viz__chunk-list" aria-label="Accepted document chunks">
            {chunks.map(chunk => <DenseListItem key={chunk.id} data-chunk-id={chunk.id} data-selected={current?.id === chunk.id || undefined}
              title={<Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="xs" className="zero-viz__chunk-select"
                aria-label={`Inspect chunk ${chunk.index + 1}`} aria-pressed={current?.id === chunk.id} onClick={() => select(chunk.id)}>
                C{chunk.index + 1} · {chunk.section ?? `chars ${chunk.start}–${chunk.end}`}</Button></TooltipTrigger>
                <TooltipContent>{chunk.text}</TooltipContent></Tooltip>}
              description={`${chunk.tokenCountApproximate ? '~' : ''}${chunk.tokenCount} tokens`}
              trailing={<ChunkReceipt stored={Boolean(chunk.storedAt)} status={chunk.status} />} />)}
          </DenseList>
        </section>}
        {map && <VisualizationLegend clusters={map.clusters} newRecords />}
      </aside>
    </div>
    {caption && <p className="zero-viz__caption-note">{caption}</p>}
  </section>;
}
