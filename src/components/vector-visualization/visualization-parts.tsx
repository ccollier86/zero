'use client';

/** Shared compact process/inspection presentation. Only supplied snapshots establish progress or outcomes. */
import * as React from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Check, FileText, Pause, Play } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import type { VectorVisualizationSnapshot, VectorVisualizationStage, VectorVisualizationStatus } from '../../vector/visualization-types';
import { VECTOR_VISUALIZATION_GEOMETRY, vectorSeries, vectorClusterSeries } from './visualization-geometry';

/** Native process state labels are shared by the stage rail and chunk inspector. */
export function visualizationStatusLabel(status: VectorVisualizationStatus): string {
  return ({ pending: 'Pending', running: 'In progress', waiting: 'Waiting for data', completed: 'Completed',
    failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped', interrupted: 'Interrupted' })[status];
}

/** Thin reference stage rail; it is an ordered process, never an accidental tablist or fake timer. */
export function VisualizationStageRail({ stages, paused, onPausedChange }: {
  stages: readonly VectorVisualizationStage[]; paused: boolean; onPausedChange?: (paused: boolean) => void;
}) {
  return <div className="zero-viz__rail" data-slot="vector-stage-rail">
    {onPausedChange && <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm"
      className="zero-viz__play" aria-label={paused ? 'Resume visualization motion' : 'Pause visualization motion'}
      aria-pressed={paused} onClick={() => onPausedChange(!paused)}>{paused ? <Play /> : <Pause />}</Button></TooltipTrigger>
      <TooltipContent>{paused ? 'Resume visual motion. The operation continues independently.' : 'Pause visual motion. The operation keeps running.'}</TooltipContent></Tooltip>}
    <ol className="zero-viz__steps" aria-label="Operation stages">
      {stages.map(stage => {
        const current = stage.status === 'running' || stage.status === 'waiting';
        const known = stage.total !== undefined && Number.isFinite(stage.total) && stage.total > 0
          && stage.completed !== undefined && Number.isFinite(stage.completed);
        const progress = stage.status === 'completed' ? 1 : known ? Math.max(0, Math.min(1, stage.completed! / stage.total!)) : 0;
        return <li key={stage.id} className="zero-viz__step" data-status={stage.status} data-stage={stage.id}
          aria-current={current ? 'step' : undefined}>
          <span className="zero-viz__step-label">{stage.label}{stage.status === 'failed' && <AlertCircle aria-hidden="true" />}</span>
          <span className="zero-viz__sr">{visualizationStatusLabel(stage.status)}{known ? `, ${stage.completed} of ${stage.total}` : ''}</span>
          <span className="zero-viz__track" aria-hidden="true" data-indeterminate={current && !known || undefined}>
            <span style={{ transform: `scaleX(${progress})` }} /></span>
        </li>;
      })}
    </ol>
  </div>;
}

/** Small counters stay in the inspector's shared flat strip, without introducing separate cards. */
export function VisualizationCounts({ values }: { values: readonly { label: string; value: number | undefined; approximate?: boolean }[] }) {
  const displayed = values.filter(item => item.value !== undefined);
  return <dl className="zero-viz__counts" data-slot="vector-counts" style={{ '--zero-viz-count-columns': displayed.length || 1 } as React.CSSProperties}>{displayed.map(item =>
    <div key={item.label}><dt>{item.label}</dt><dd aria-label={item.approximate ? `Approximately ${item.value}` : undefined}>
      {item.approximate && '~'}{Number.isFinite(item.value) ? item.value!.toLocaleString('en-US') : '—'}</dd></div>)}</dl>;
}

/** Display only real finite preview values; bar height is normalized locally, not a new score. */
export function VectorEmbeddingPreview({ values, dimensions, label = 'Embedding preview', series }: {
  values?: readonly number[]; dimensions?: number; label?: string; series?: number;
}) {
  const preview = values?.slice(0, VECTOR_VISUALIZATION_GEOMETRY.previewBars).filter(Number.isFinite) ?? [];
  const max = Math.max(1e-9, ...preview.map(Math.abs));
  return <div className="zero-viz__vector" data-slot="vector-embedding-preview" data-series={series}>
    <svg viewBox="0 0 160 26" preserveAspectRatio="none" aria-hidden="true">
      <line className="zero-viz__vector-base" x1="0" y1="13" x2="160" y2="13" />
      {preview.map((value, i) => <rect key={i} x={i * 10 + 1.5} width="7" rx="1"
        y={value >= 0 ? 13 - Math.abs(value) / max * 12 : 13} height={Math.max(1, Math.abs(value) / max * 12)}
        className="zero-viz__vector-bar" data-sign={value < 0 ? 'negative' : 'positive'}
        style={{ '--zero-viz-bar-order': i } as React.CSSProperties} />)}
    </svg>
    <div className="zero-viz__vector-numbers" aria-label={label}>{preview.length
      ? `[${preview.slice(0, 3).map(value => value.toFixed(3)).join(', ')}${(dimensions ?? preview.length) > Math.min(preview.length, 3) ? `, … +${(dimensions ?? preview.length) - Math.min(preview.length, 3)}` : ''}]`
      : 'Embedding not available yet'}</div>
  </div>;
}

/** Metadata uses definition-list semantics; unknown or redacted diagnostics never become guessed values. */
export function VisualizationMetadata({ values }: { values: readonly { label: string; value: React.ReactNode }[] }) {
  return <dl className="zero-viz__metadata">{values.map((item, index) => <React.Fragment key={`${index}-${item.label}`}>
    <dt>{item.label}</dt><dd>{item.value}</dd></React.Fragment>)}</dl>;
}

/** A safe error/status surface; outcome ambiguity is made visible instead of implying a failed write. */
export function VisualizationOperationStatus({ snapshot }: { snapshot?: VectorVisualizationSnapshot | null }) {
  if (!snapshot) return <p className="zero-viz__caption">Ready when you are.</p>;
  const active = snapshot.stages.find(stage => stage.status === 'running' || stage.status === 'waiting');
  const message = snapshot.error?.message ?? (active ? `${active.label}${active.status === 'waiting' ? ' · waiting for data' : ' in progress'}`
    : visualizationStatusLabel(snapshot.status));
  return <><div className="zero-viz__caption" data-slot="vector-operation-status" data-status={snapshot.status}
    role={snapshot.error ? 'alert' : 'status'} aria-live={snapshot.error ? 'assertive' : 'polite'}>
    {snapshot.error && <AlertCircle aria-hidden="true" />}<span key={message} className="zero-viz__caption-message">{message}
      {snapshot.error?.outcomeUnknown && <small>The write outcome is unknown. Check the operation before retrying.</small>}</span>
  </div>{snapshot.warnings?.length ? <ul className="zero-viz__warnings" aria-label="Visualization diagnostics" role="status" aria-live="polite">
    {snapshot.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}
      {warning.outcomeUnknown && <span>Write outcome unknown; verify before retrying.</span>}</li>)}</ul> : null}</>;
}

/** Decorative source tile has a theme-series ink, never unpaired arbitrary provider colors. */
export function VisualizationSourceTile({ label, abbreviation, identity, series }: { label?: string; abbreviation?: string; identity: string; series?: number }) {
  return <span className="zero-viz__source" data-series={series ?? vectorSeries(identity)} aria-hidden="true">
    {abbreviation?.slice(0, 2) || label?.slice(0, 1) || <FileText />}</span>;
}

/** A directional rank label is not an error or success claim. */
export function VisualizationRankDelta({ foundRank, rank }: { foundRank: number; rank: number }) {
  const delta = foundRank - rank;
  if (!delta) return null;
  return <span className="zero-viz__rank-delta" data-direction={delta > 0 ? 'up' : 'down'}
    aria-label={`Moved ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'place' : 'places'} ${delta > 0 ? 'up' : 'down'}`}>
    {delta > 0 ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}{Math.abs(delta)}</span>;
}

/** Optional legend retains cluster names and supplemental markers alongside colors. */
export function VisualizationLegend({ clusters, newRecords }: { clusters: readonly { id: string; label: string }[]; newRecords?: boolean }) {
  return <ul className="zero-viz__legend" aria-label="Map legend">{clusters.map(cluster => <li key={cluster.id}
    data-series={vectorClusterSeries(clusters, cluster.id)}><i aria-hidden="true" />{cluster.label}</li>)}
    {newRecords && <li><i className="zero-viz__legend-new" aria-hidden="true" />New chunk</li>}</ul>;
}

/** Consistent pending/storage receipt labels used in compact chunk queues. */
export function ChunkReceipt({ stored, status }: { stored: boolean; status: VectorVisualizationStatus }) {
  return <Badge variant={status === 'failed' ? 'destructive' : 'secondary'} className="zero-viz__receipt">
    {stored ? <><Check aria-hidden="true" />Stored</> : visualizationStatusLabel(status)}</Badge>;
}
