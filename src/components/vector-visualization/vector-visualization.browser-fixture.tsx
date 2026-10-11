/** Synthetic controlled-browser fixture. No runtime provider, auth, route, DB, indexing or external request is instantiated. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { VectorSearchVisualization, IngestionPipelineVisualization } from './index';
import { syntheticIngestion, syntheticSearch } from './vector-visualization.test-data';
import type { VectorVisualizationPresentation, VectorVisualizationSnapshot } from '../../vector/visualization-types';

declare global {
  interface Window { __vectorVisualization: {
    search: (value: VectorVisualizationSnapshot) => void;
    ingestion: (value: VectorVisualizationSnapshot) => void;
    motion: (enabled: boolean) => void;
    presentation: (value: VectorVisualizationPresentation) => void;
    searchState: () => VectorVisualizationSnapshot;
    ingestionState: () => VectorVisualizationSnapshot;
    selected: () => string | undefined;
    selectedCluster: () => string | undefined;
    customTooltips: (enabled: boolean | 'hidden') => void;
  } }
}
function Fixture() {
  const [search, setSearch] = React.useState(syntheticSearch), [ingestion, setIngestion] = React.useState(syntheticIngestion);
  const [motion, setMotion] = React.useState(true), [presentation, setPresentation] = React.useState<VectorVisualizationPresentation>('full');
  const [selected, setSelected] = React.useState<string>(), [paused, setPaused] = React.useState(false);
  const [selectedCluster, setSelectedCluster] = React.useState<string>(), [customTooltips, setCustomTooltips] = React.useState<boolean | 'hidden'>(false);
  window.__vectorVisualization = { search: setSearch, ingestion: setIngestion, motion: setMotion, presentation: setPresentation,
    searchState: () => search, ingestionState: () => ingestion, selected: () => selected,
    selectedCluster: () => selectedCluster, customTooltips: setCustomTooltips };
  const inspection = { selectedRecordId: selected, onSelectRecord: setSelected, selectedClusterId: selectedCluster,
    onSelectCluster: setSelectedCluster,
    renderRecordTooltip: customTooltips ? (context: import('./index').VectorRecordTooltipContext) => context.point.id === 'record-1'
      ? customTooltips === 'hidden' ? null : <span>{`Custom record: ${context.point.title} · ${context.map.dimensions} dims${context.result ? ` · rank ${context.result.rank}` : ''}`}</span> : undefined : undefined,
    renderClusterTooltip: customTooltips ? (context: import('./index').VectorClusterTooltipContext) => context.cluster.id === 'billing'
      ? customTooltips === 'hidden' ? null : <span>{`Custom cluster: ${context.cluster.label} · ${context.points.length} sampled records`}</span> : undefined : undefined,
    renderQueryTooltip: customTooltips ? (context: import('./index').VectorQueryTooltipContext) => customTooltips === 'hidden' ? null
      : <span>{`Custom query: ${context.query?.text ?? context.label} · ${context.query?.retrieval ?? 'mode unavailable'} · ${context.map?.dimensions ?? 'unknown'} dims`}</span> : undefined };
  return <main className="mx-auto max-w-6xl space-y-12 p-6"><h1 className="text-xl font-semibold">Vector visualization fixture</h1>
    <div className="rounded-xl border border-border bg-card p-5"><VectorSearchVisualization snapshot={search} presentation={presentation}
      motionEnabled={motion} {...inspection} paused={paused} onPausedChange={setPaused} /></div>
    <div className="rounded-xl border border-border bg-card p-5"><IngestionPipelineVisualization snapshot={ingestion} presentation={presentation}
      motionEnabled={motion} {...inspection} paused={paused} /></div>
    <button type="button">Outside control</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
