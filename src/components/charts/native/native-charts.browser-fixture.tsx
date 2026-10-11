'use client';
/** Synthetic public-facade gallery and observed-stream controls. No application config, database, provider or feed. */
import { StrictMode, Suspense, startTransition, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ZeroChart } from '../zero-chart';
import type { RealtimeSample } from './realtime/realtime-model';
import { chartColor } from './shared/admission';
import { NativeChartLegend } from './shared/native-chart';
const epoch = 1_791_540_000_000;
const samples: readonly RealtimeSample[] = [60, 68, 64, 75, null, 82, 72, 90].map((value, index) => ({ id: `s${index}`, time: epoch + index * 10_000, value, ...(index === 7 ? { anomaly: { label: 'Observed threshold', severity: 'warning' as const } } : {}) }));
const measures = [18, 25, 22, 35, 32, 28, 42, 36].map((value, index) => ({ id: `m${index}`, label: `Day ${index + 1}`, x: index, values: { acquisition: value, retention: [12, 16, -4, 18, 20, 22, 18, 26][index]! } }));
const series = [{ id: 'acquisition', label: 'Acquisition' }, { id: 'retention', label: 'Retention' }];
type State = { data: readonly RealtimeSample[]; paused?: boolean; active?: string | null; defaultPaused: boolean; motion: boolean; custom: 'default' | 'custom' | 'hidden'; paint?: string; suspended?: boolean };
declare global { interface Window { __nativeCharts: { patch: (patch: Partial<State>) => void; state: () => State; append: () => void; retire: () => void; suspend: (data: readonly RealtimeSample[]) => void; colorAllowed: (value: string) => boolean; events: boolean[]; unmount: () => void }; __nativeChartsPending: () => number; __nativeChartsSuspensions: number } }
const root = createRoot(document.getElementById('root')!); const events: boolean[] = [];
const frames = new Set<number>(), request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
window.requestAnimationFrame = callback => { let id = 0; id = request(time => { frames.delete(id); callback(time); }); frames.add(id); return id; };
window.cancelAnimationFrame = id => { frames.delete(id); cancel(id); }; window.__nativeChartsPending = () => frames.size;
const pendingRender = new Promise<never>(() => {}); window.__nativeChartsSuspensions = 0;
function RenderGate({ suspended }: { suspended?: boolean }) { if (suspended) { window.__nativeChartsSuspensions++; throw pendingRender; } return null; }
function Fixture() {
  const [state, setState] = useState<State>({ data: samples, defaultPaused: false, motion: true, custom: 'default' });
  const patch = (next: Partial<State>) => setState(previous => ({ ...previous, ...next }));
  window.__nativeCharts = { patch, state: () => state, events, append: () => patch({ data: [...state.data, { id: 'incoming', time: epoch + 120_000, value: 100 }] }), retire: () => patch({ data: [{ id: 'new-scope', time: epoch + 130_000, value: 10 }] }), suspend: data => startTransition(() => patch({ data, suspended: true })), colorAllowed: value => { try { chartColor(value, 'review color'); return true; } catch { return false; } }, unmount: () => root.unmount() };
  return <main data-suspended={state.suspended ? 'true' : 'false'}><h1>Handmade Zero charts</h1><p>Original SVG geometry · shared analytical tokens · actual synthetic measurements</p>{state.paint!==undefined&&<div data-testid="raw-legend"><NativeChartLegend items={[{id:'paint',label:'Raw paint defense',color:state.paint}]}/></div>}<div className="gallery">
    <section className="card"><ZeroChart kind="line" label="Trend" title="Acquisition and retention" subtitle="Smooth and step · signed measurements" data={measures} series={series.map(item => ({ ...item, curve: item.id === 'acquisition' ? 'smooth' : 'step' }))} motion={state.motion} /></section>
    <section className="card"><ZeroChart kind="stacked-bar" label="Signed stacks" title="Signed contributions" subtitle="Positive and negative balances" data={measures} series={series} motion={state.motion} /></section>
    <section className="card"><ZeroChart kind="histogram" label="Distribution" title="Response time" subtitle="Measured requests · milliseconds" observations={[2, 3, 6, 8, 12, 14, 15, 17, 18, 20, 23, 26, 27, 32, 38, 40, 42, 48, 55, 62, 75].map((value, index) => ({ id: `request-${index}`, value }))} binning={{ edges: [0, 10, 20, 30, 40, 50, 60, 80] }} motion={state.motion} /></section>
    <section className="card"><ZeroChart kind="box-plot" label="Latency distribution" title="Latency by service" subtitle="Observed quartiles · Tukey whiskers" series={[{ id: 'api', label: 'API', values: [8, 9, 11, 12, 14, 16, 18, 22, 75] }, { id: 'jobs', label: 'Jobs', values: [12, 13, 18, 20, 26, 28, 31, 33] }, { id: 'mail', label: 'Mail', values: [4, 6, 8, 9, 12, 14, 16, 19] }]} motion={state.motion} /></section>
    <section className="card"><ZeroChart kind="waterfall" label="Balance" title="Operating balance" subtitle="Signed deltas and explicit snapshots" startingValue={20} steps={[{ id: 'sales', label: 'Sales', kind: 'contribution', value: 80 }, { id: 'costs', label: 'Costs', kind: 'contribution', value: -30 }, { id: 'subtotal', label: 'Subtotal', kind: 'subtotal' }, { id: 'reset', label: 'Reset', kind: 'total', value: 60 }, { id: 'refunds', label: 'Refunds', kind: 'contribution', value: -18 }, { id: 'closing', label: 'Closing', kind: 'subtotal' }]} motion={state.motion} /></section>
    <section className="card"><ZeroChart kind="pie" label="Source share" title="Source share" subtitle="Exact parts of a positive total" data={[{ id: 'direct', label: 'Direct', value: 65 }, { id: 'referral', label: 'Referral', value: 35 }]} motion={state.motion} /></section>
    <section className="card"><ZeroChart kind="sunburst" label="Hierarchy" title="Business hierarchy" subtitle="Additive branches · drill to explore" data={{ id: 'whole', label: 'Business', children: [{ id: 'product', label: 'Product', children: [{ id: 'alpha', label: 'Alpha', value: 40 }, { id: 'beta', label: 'Beta', value: 20 }] }, { id: 'services', label: 'Services', children: [{ id: 'support', label: 'Support', value: 25 }, { id: 'consulting', label: 'Consulting', value: 15 }] }] }} motion={state.motion} /></section>
    <section className="card" data-testid="stream"><ZeroChart kind="realtime" label="Observed stream" title="Observed stream" subtitle="Real timestamps · hold to inspect" data={state.data} windowMs={30_000} paused={state.paused} defaultPaused={state.defaultPaused} activeId={state.active} onPausedChange={value => events.push(value)} motion={state.motion} renderTooltip={state.custom === 'default' ? undefined : state.custom === 'hidden' ? () => null : context => <div data-testid="custom-stream">Exact {context.sample.id}: {context.sample.value}</div>} /></section>
  </div><RenderGate suspended={state.suspended}/></main>;
}
root.render(<StrictMode><Suspense fallback={<p>Waiting for synthetic render</p>}><Fixture /></Suspense></StrictMode>);
