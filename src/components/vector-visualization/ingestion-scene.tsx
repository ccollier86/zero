'use client';

/** Reference document → chunk queue → model → vector/index scene. Supplied lifecycle acknowledgements drive every transition. */
import * as React from 'react';
import type { VectorVisualizationChunk, VectorVisualizationIngestion, VectorVisualizationMap } from '../../vector/visualization-types';
import { projectVectorPosition, vectorClusterSeries, vectorMapDescription } from './visualization-geometry';
import { VectorMap } from './vector-map';
import type { VectorMapInspectionProps } from './vector-map-inspection';

interface DocumentLine { text: string; start: number; end: number; heading: boolean }
/** Wrap source preview text without stripping source positions used by overlap/chunk diagnostics. */
export function ingestionDocumentLines(text: string, columns = 34, limit = 32): DocumentLine[] {
  const lines: DocumentLine[] = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    const heading = /^#{1,3}\s/u.test(raw);
    let remainder = raw, start = offset;
    while (remainder.length > columns && lines.length < limit) {
      const boundary = remainder.lastIndexOf(' ', columns), cut = boundary > 0 ? boundary : columns;
      lines.push({ text: remainder.slice(0, cut), start, end: start + cut, heading });
      const skip = remainder[cut] === ' ' ? 1 : 0;
      remainder = remainder.slice(cut + skip); start += cut + skip;
    }
    if (lines.length < limit) lines.push({ text: remainder, start, end: start + remainder.length, heading });
    offset += raw.length + 1;
    if (lines.length >= limit) break;
  }
  return lines;
}

/** Scene geometry is an intrinsic SVG coordinate system; responsive layout does not alter diagnostics. */
export function IngestionScene({ ingestion, map, currentChunk, model, ...inspection }: {
  ingestion?: VectorVisualizationIngestion; map?: VectorVisualizationMap; currentChunk?: VectorVisualizationChunk;
  model?: string;
} & VectorMapInspectionProps) {
  const id = React.useId().replace(/:/gu, ''), doc = ingestion?.document, chunks = ingestion?.chunks ?? [],
    lines = ingestionDocumentLines(doc?.text ?? ''), visibleChunks = chunks.slice(0, 12), series = vectorClusterSeries(map?.clusters ?? [], doc?.clusterId ?? doc?.source?.id ?? doc?.id ?? 'document');
  const modelBusy = currentChunk?.stageId === 'embed' && (currentChunk.status === 'running' || currentChunk.status === 'waiting');
  const vector = currentChunk?.embeddingPreview?.slice(0, 16).filter(Number.isFinite) ?? [], maximum = Math.max(1e-9, ...vector.map(Math.abs));
  const mapPoint = currentChunk?.storedAt ? map?.points.find(point => point.id === currentChunk.id) : undefined;
  const destination = mapPoint ? projectVectorPosition(mapPoint.position) : null;
  const flightX = destination ? 406 + destination.x / 640 * 388 : 0, flightY = destination ? 218 + destination.y / 410 * 248.5625 : 0;
  return <div className="zero-viz__pipeline-scene" data-slot="ingestion-scene" data-series={series}>
    <div className="zero-viz__pipeline-frame">
    <svg viewBox="0 0 800 480" className="zero-viz__pipeline-svg" aria-hidden="true">
      <defs><pattern id={`${id}-overlap`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect className="zero-viz__overlap-stripe" width="2" height="4" /></pattern></defs>
      <g className="zero-viz__document-card" key={doc?.id ?? 'empty'} style={{ '--zero-viz-line-count': Math.max(1, lines.length) } as React.CSSProperties}>
        <rect className="zero-viz__document-surface" x="6" y="28" width="200" height="410" rx="10" />
        <rect className="zero-viz__document-source-bg" x="16" y="40" width="108" height="16" rx="8" />
        <text className="zero-viz__scene-mono zero-viz__scene-muted" x="24" y="51.5">{doc?.source?.label?.slice(0, 18) ?? 'Source document'}</text>
        <text className="zero-viz__document-title" x="16" y="72">{doc?.title ? doc.title.slice(0, 27) + (doc.title.length > 27 ? '…' : '') : 'Ready for ingestion'}</text>
        {chunks.flatMap((chunk, index) => lines.flatMap((line, li) => {
          const start = Math.max(chunk.start, line.start), end = Math.min(chunk.end, line.end);
          if (end <= start) return [];
          const x = 17 + (start - line.start) * 4.56, y = 88 + li * 10.792;
          const overlapEnd = Math.min(chunk.start + chunk.overlapChars, line.end, chunk.end);
          return [<g key={`${chunk.id}-${li}`} className="zero-viz__chunk-band" data-active={currentChunk?.id === chunk.id}
            style={{ '--zero-viz-order': index } as React.CSSProperties}>
            <rect x={x} y={y} width={(end - start) * 4.56 + 2} height="10.192" rx="1.5" />
            {chunk.overlapChars > 0 && overlapEnd > start && <rect x={x} y={y} width={(overlapEnd - start) * 4.56 + 2}
              height="10.192" fill={`url(#${id}-overlap)`} className="zero-viz__overlap-band" />}
          </g>];
        }))}
        {lines.map((line, i) => <text key={`${line.start}-${i}`} className="zero-viz__document-line" data-heading={line.heading}
          x="17" y={96 + i * 10.792} style={{ '--zero-viz-order': i } as React.CSSProperties}>{line.text}</text>)}
        {!lines.length && <text className="zero-viz__scene-muted zero-viz__scene-label" x="17" y="108">The accepted document appears here.</text>}
      </g>
      <text className="zero-viz__scene-mono zero-viz__scene-muted" x="230" y="33">{chunks.length ? `${chunks.length} chunks` : 'Chunk queue'}</text>
      {visibleChunks.map((chunk, index) => {
        const y = 46 + index * Math.min(30, 360 / Math.max(1, visibleChunks.length));
        const embedding = chunk.stageId === 'embed' && (chunk.status === 'running' || chunk.status === 'waiting');
        return <g key={chunk.id} transform={`translate(230,${y})`} data-slot="ingestion-queue-slip" data-chunk-id={chunk.id}
          data-status={chunk.status} data-embedding={embedding || undefined} data-stored={Boolean(chunk.storedAt) || undefined}>
          <g className="zero-viz__queue-slip" style={{ '--zero-viz-from-x': '-214px', '--zero-viz-from-y': `${48 + index * 10.792 - y}px`,
            '--zero-viz-model-x': '141px', '--zero-viz-model-y': `${88.5 - y}px`, '--zero-viz-order': index } as React.CSSProperties}>
            <rect className="zero-viz__queue-surface" width="136" height="25" rx="6" />
            <rect className="zero-viz__queue-ink" width="3" height="25" rx="1.5" />
            <text className="zero-viz__scene-mono zero-viz__scene-ink" x="9" y="16">C{chunk.index + 1}</text>
            <text className="zero-viz__scene-label" x="34" y="16">{chunk.text.slice(0, 10)}{chunk.text.length > 10 ? '…' : ''}</text>
            <text className="zero-viz__scene-mono zero-viz__scene-muted" x="128" y="16" textAnchor="end">
              {chunk.tokenCountApproximate ? '~' : ''}{chunk.tokenCount}t</text>
          </g>
        </g>;
      })}
      {chunks.length > visibleChunks.length && <text className="zero-viz__scene-label zero-viz__scene-muted" x="230" y="428">+{chunks.length - visibleChunks.length} more chunks</text>}
      <g transform="translate(420,104)" className="zero-viz__model" data-working={modelBusy || undefined}>
        <ellipse className="zero-viz__model-glow" cy="16.5" rx="45" ry="16.5" />
        <polygon className="zero-viz__model-left" points="-30,-13.5 0,1.5 0,31.5 -30,16.5" />
        <polygon className="zero-viz__model-right" points="0,1.5 30,-13.5 30,16.5 0,31.5" />
        <polygon className="zero-viz__model-top" points="0,-28.5 30,-13.5 0,1.5 -30,-13.5" />
        <polygon className="zero-viz__model-slot" points="0,-21.6 16.5,-13.5 0,-5.4 -16.5,-13.5" />
        <text className="zero-viz__scene-model-title" x="0" y="47.5" textAnchor="middle">Embedding model</text>
        <text className="zero-viz__scene-mono zero-viz__scene-muted" x="0" y="60.5" textAnchor="middle">{model?.slice(0, 28) ?? 'Configured provider'}</text>
        {modelBusy && <g className="zero-viz__model-wait">{[0, 1, 2].map(index => <circle key={index} cx={index * 8 - 8} cy="-37.5" r="2"
          style={{ '--zero-viz-order': index } as React.CSSProperties} />)}</g>}
      </g>
      <g transform="translate(500,98)" className="zero-viz__scene-vector" key={`${currentChunk?.id}-${vector.length}`}>
        <text className="zero-viz__scene-mono zero-viz__scene-muted" x="0" y="-32">{currentChunk ? `C${currentChunk.index + 1}` : 'Vector'}
          {vector.length ? ` → [${vector.slice(0, 2).map(value => value.toFixed(3)).join(', ')}, …]` : ' · awaiting embedding'}</text>
        <line className="zero-viz__vector-base" x1="0" x2="150" y1="0" y2="0" />
        {vector.map((value, index) => <rect className="zero-viz__scene-vector-bar" key={index} x={index * 150 / 16 + 1}
          width={150 / 16 - 2.5} rx="1" y={value >= 0 ? -Math.abs(value) / maximum * 24 : 0} height={Math.max(1, Math.abs(value) / maximum * 24)}
          style={{ '--zero-viz-order': index } as React.CSSProperties} />)}
        {currentChunk?.section && <g className="zero-viz__scene-chip" transform="translate(0,30)"><rect width="170" height="18" rx="9" />
          <text x="9" y="12.5">§ {currentChunk.section.slice(0, 25)}</text></g>}
        {currentChunk && <g className="zero-viz__scene-chip" transform="translate(0,53)"><rect width="170" height="18" rx="9" />
          <text x="9" y="12.5">{currentChunk.index + 1}/{chunks.length} · chars {currentChunk.start}–{currentChunk.end}</text></g>}
        {currentChunk?.storedAt && <g className="zero-viz__scene-chip" transform="translate(0,76)"><rect width="170" height="18" rx="9" />
          <text x="9" y="12.5">Storage acknowledged</text></g>}
      </g>
      {destination && <circle key={`${currentChunk!.id}-${currentChunk!.storedAt}`} className="zero-viz__flight" r="3.8"
        style={{ offsetPath: `path('M575,98 Q${(575 + flightX) / 2},58 ${flightX},${flightY}')` }} />}
    </svg>
    <div className="zero-viz__pipeline-map"><VectorMap map={map} {...inspection} showCaption={false} /></div>
    </div><p className="zero-viz__pipeline-note">{map ? vectorMapDescription(map) : 'An authorized vector snapshot will appear after storage is available.'}</p>
  </div>;
}
