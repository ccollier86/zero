/** Synthetic public-package composition; never imports app config or a live client. */
import * as React from 'react';
import { SankeyChart, RaceBarChart, FunnelChart } from '@zero/framework/components/charts';
import { buildSankeyModel, computeSankeyTrace, sankeyPairId, type SankeyData,
  buildRaceBarModel, computeRaceBarSnapshot, type RaceBarData,
  buildFunnelModel, computeFunnelSnapshot, type FunnelData } from '@zero/framework/charts';
import { useChartQuery } from '@zero/framework/charts/react';

export const data: SankeyData = {
  nodes: [{ id: 'source', label: 'Synthetic source' }, { id: 'target', label: 'Synthetic target' }],
  links: [{ source: 'source', target: 'target', value: 24 }],
};
export const model = buildSankeyModel(data);
export const traced = computeSankeyTrace(model, { kind: 'link', id: sankeyPairId('source', 'target') });
export function ChartConsumer() {
  return <SankeyChart data={data} label="Synthetic packaged flow" unit="records" columns={['From', 'To']} />;
}
export const queryHook = useChartQuery;

export const raceData: RaceBarData = {
  groups: [{ id: 'tools', label: 'Tools' }],
  items: [{ id: 'alpha', label: 'Synthetic Alpha', group: 'tools' }, { id: 'beta', label: 'Synthetic Beta' }],
  frames: [{ id: 'jan', period: 'January', values: { alpha: 7, beta: 3 } },
    { id: 'feb', period: 'February', values: { alpha: 4, beta: 12 } }],
};
export const raceModel = buildRaceBarModel(raceData);
export const raceSnapshot = computeRaceBarSnapshot(raceModel, 1);
export function RaceChartConsumer() {
  return <RaceBarChart data={raceData} label="Synthetic packaged ranking" title="Synthetic ranking"
    autoPlay={false} defaultFrame={1} />;
}

export const funnelData: FunnelData = {
  segments: [{ id: 'direct', label: 'Direct' }, { id: 'referral', label: 'Referral' }],
  stages: [{ id: 'visit', label: 'Visited', values: { direct: 20, referral: 10 } },
    { id: 'activate', label: 'Activated', values: { direct: 10, referral: 5 } }],
};
export const funnelModel = buildFunnelModel(funnelData);
export const funnelSnapshot = computeFunnelSnapshot(funnelModel, { kind: 'split' });
export function FunnelChartConsumer() {
  return <FunnelChart data={funnelData} label="Synthetic packaged cohort" title="Synthetic conversion"
    defaultView={{ kind: 'split' }} defaultFlow={false} />;
}
