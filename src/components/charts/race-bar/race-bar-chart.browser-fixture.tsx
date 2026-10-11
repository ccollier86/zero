/** Isolated Race Bar reference fixtures contain synthetic public history only; no Zero app, DB, auth or transport is started. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { RaceBarChart, type RaceBarChartHandle, type RaceBarChartProps } from './race-bar-chart';
import type { RaceBarData } from './race-bar-types';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const groups = [{ id: 'furniture', label: 'Furniture' }, { id: 'textiles', label: 'Textiles' }, { id: 'tableware', label: 'Tableware' }, { id: 'lighting', label: 'Lighting' }];
const raw: readonly [string, string, string, readonly number[]][] = [
  ['oak', 'Oak dining table', 'furniture', [30, 31, 33, 35, 37, 40, 42, 45, 47, 50, 54, 58]],
  ['credenza', 'Walnut credenza', 'furniture', [44, 42, 40, 36, 33, 30, 30, 31, 33, 35, 38, 42]],
  ['armchair', 'Velvet armchair', 'furniture', [12, 12, 13, 14, 18, 34, 46, 52, 50, 46, 44, 46]],
  ['throw', 'Linen throw', 'textiles', [52, 46, 32, 20, 14, 10, 9, 10, 16, 28, 46, 64]],
  ['rug', 'Wool rug', 'textiles', [24, 22, 20, 18, 16, 15, 16, 20, 28, 36, 40, 42]],
  ['stoneware', 'Stoneware dinner set', 'tableware', [26, 24, 25, 26, 27, 28, 28, 29, 31, 34, 52, 78]],
  ['carafe', 'Glass carafe', 'tableware', [8, 9, 12, 18, 28, 40, 48, 44, 30, 18, 12, 10]],
  ['mugs', 'Ceramic mugs', 'tableware', [14, 15, 16, 18, 19, 21, 23, 25, 27, 30, 33, 38]],
  ['floor', 'Arc floor lamp', 'lighting', [28, 28, 29, 29, 30, 30, 30, 31, 31, 32, 34, 36]],
  ['pendant', 'Paper pendant', 'lighting', [10, 12, 22, 48, 62, 44, 30, 24, 20, 18, 18, 20]],
];
const money = (value: number) => value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : `$${Math.round(value / 1000)}K`;
export function raceBarReferenceData(monthly = false): RaceBarData {
  return { groups, items: raw.map(([id, label, group]) => ({ id, label, group })), frames: months.map((period, index) => ({ id: '2026-' + index, period,
    values: Object.fromEntries(raw.map(([id, , , values]) => [id, (monthly ? values[index]! : values.slice(0, index + 1).reduce((a, b) => a + b, 0)) * 1000])) })) };
}
declare global {
  interface Window { __raceBarFixture: {
    data(value: RaceBarData): void; reference(monthly?: boolean): RaceBarData;
    settings(value: Partial<RaceBarChartProps>): void; controlled(value: boolean): void; reject(value: boolean): void;
    select(value: string | null): void; tooltip(value: 'default' | 'custom' | 'hidden'): void;
    action(value: 'play' | 'pause' | 'toggle' | 'replay' | 'next' | 'prev' | 'seek', position?: number): void;
    observedAction(value: 'pause' | 'unmount'): void;
    state(): { frame: number; playing: boolean; selection: string | null; requestedFrame: number; rejected: boolean; observed: number[]; requests: { position: number; reason: string }[] };
    unmount(): void;
  }; __raceBarPendingFrames(): number; }
}
// This fixture-only tracker qualifies scheduler teardown without exposing diagnostic API in production charts.
const nativeRequest = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window), pendingFrames = new Set<number>();
window.requestAnimationFrame = callback => { const id = nativeRequest(time => { pendingFrames.delete(id); callback(time); }); pendingFrames.add(id); return id; };
window.cancelAnimationFrame = id => { pendingFrames.delete(id); nativeCancel(id); };
window.__raceBarPendingFrames = () => pendingFrames.size;
function Fixture() {
  const [data, setData] = React.useState<RaceBarData>(() => raceBarReferenceData()), [settings, setSettings] = React.useState<Partial<RaceBarChartProps>>({ autoPlay: false }),
    [selection, setSelection] = React.useState<string | null>(null), [controlled, setControlled] = React.useState(false), [reject, setReject] = React.useState(false),
    [frame, setFrame] = React.useState(0), [playing, setPlaying] = React.useState(false), [tooltip, setTooltip] = React.useState<'default' | 'custom' | 'hidden'>('default'), [mounted, setMounted] = React.useState(true);
  const chart = React.useRef<RaceBarChartHandle | null>(null), observed = React.useRef<number[]>([]), requests = React.useRef<{ position: number; reason: string }[]>([]);
  const observedAction = React.useRef<'pause' | 'unmount' | null>(null);
  React.useEffect(() => { window.__raceBarFixture = { data: setData, reference: raceBarReferenceData, settings: value => setSettings(old => ({ ...old, ...value })), controlled: setControlled, reject: setReject,
    select: setSelection, tooltip: setTooltip, action: (action, position) => action === 'seek' ? chart.current?.seek(position ?? 0) : chart.current?.[action](),
    observedAction: value => { observedAction.current = value; },
    state: () => ({ frame: chart.current?.frame ?? 0, playing: chart.current?.playing ?? false, selection, requestedFrame: frame, rejected: reject, observed: [...observed.current], requests: [...requests.current] }),
    unmount: () => setMounted(false) }; }, [selection, frame, reject]);
  return <main style={{ padding: 24, maxWidth: 1040, margin: '0 auto' }}><h1>Race Bar chart fixture</h1>
    <section data-testid="card" style={{ margin: '24px auto', maxWidth: 620, padding: '24px 26px 18px', border: '1px solid var(--border)', borderRadius: 18, background: 'var(--card)' }}>
      {mounted && <RaceBarChart ref={chart} data={data} label="Revenue by product, 2026" title="Revenue by product" subtitle="Year to date, 2026"
        formatValue={money} formatTick={money} highlight="armchair" {...settings}
        frame={controlled ? frame : undefined} playing={controlled ? playing : undefined} selectedId={selection}
        onSelectionChange={setSelection} onFrame={(index) => { observed.current.push(index); const action = observedAction.current; observedAction.current = null;
          if (action === 'pause') chart.current?.pause(); else if (action === 'unmount') flushSync(() => setMounted(false)); }}
        onFrameChange={(position, { reason }) => { requests.current.push({ position, reason }); if (controlled && !reject) setFrame(position); }}
        onPlayingChange={value => { if (!reject) setPlaying(value); }}
        renderItemTooltip={tooltip === 'default' ? undefined : tooltip === 'hidden' ? () => null : context => <div data-testid="custom-inspector">Custom {context.item.label}: {context.value.toFixed(1)} ({context.interpolated ? 'blended' : 'exact'})</div>} />}
    </section><button type="button">After chart</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
