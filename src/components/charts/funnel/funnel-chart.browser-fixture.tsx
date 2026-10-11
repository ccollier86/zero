/** Synthetic Funnel reference fixture owns no app config, auth, query subscriptions or network service. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { FunnelChart, type FunnelChartHandle, type FunnelChartProps } from './funnel-chart';
import type { FunnelData, FunnelView } from './funnel-types';

export function funnelReferenceData(): FunnelData {
  return { segments: [{ id: 'mobile', label: 'Mobile' }, { id: 'desktop', label: 'Desktop' }], stages: [
    { id: 'visit', label: 'Visited store', values: { mobile: 70200, desktop: 29800 } },
    { id: 'view', label: 'Viewed product', values: { mobile: 41100, desktop: 20400 } },
    { id: 'cart', label: 'Added to cart', values: { mobile: 9600, desktop: 7100 } },
    { id: 'checkout', label: 'Started checkout', values: { mobile: 4500, desktop: 4000 } },
    { id: 'buy', label: 'Purchased', values: { mobile: 1600, desktop: 2100 } },
  ] };
}
declare global { interface Window {
  __funnelFixture: { data(data: FunnelData): void; reference(): FunnelData; settings(props: Partial<FunnelChartProps>): void;
    controlled(value: boolean): void; reject(value: boolean): void; tooltip(value: 'default' | 'custom' | 'hidden'): void;
    view(view: FunnelView): void; flow(value: boolean): void; inspect(id: string | null): void; clear(): void; unmount(): void;
    activeAction(action: 'clear' | 'retire'): void;
    state(): { view: FunnelView; flow: boolean; active: string | null; requests: string[]; }; };
  __funnelPendingFrames(): number;
} }
const nativeRequest = requestAnimationFrame.bind(window), nativeCancel = cancelAnimationFrame.bind(window), pending = new Set<number>();
window.requestAnimationFrame = callback => { const id = nativeRequest(time => { pending.delete(id); callback(time); }); pending.add(id); return id; };
window.cancelAnimationFrame = id => { pending.delete(id); nativeCancel(id); }; window.__funnelPendingFrames = () => pending.size;
function Fixture() {
  const [data, setData] = React.useState<FunnelData>(funnelReferenceData), [props, setProps] = React.useState<Partial<FunnelChartProps>>({}),
    [view, setView] = React.useState<FunnelView>({ kind: 'total' }), [flow, setFlow] = React.useState(true), [active, setActive] = React.useState<string | null>(null),
    [controlled, setControlled] = React.useState(false), [rejected, setRejected] = React.useState(false), [mounted, setMounted] = React.useState(true),
    [tooltip, setTooltip] = React.useState<'default' | 'custom' | 'hidden'>('default');
  const chart = React.useRef<FunnelChartHandle | null>(null), requests = React.useRef<string[]>([]), activeAction = React.useRef<'clear' | 'retire' | null>(null);
  React.useEffect(() => { window.__funnelFixture = { data: setData, reference: funnelReferenceData, settings: next => setProps(old => ({ ...old, ...next })),
    controlled: setControlled, reject: setRejected, tooltip: setTooltip, view: next => chart.current?.setView(next), flow: next => chart.current?.setFlow(next), inspect: id => chart.current?.inspect(id),
    clear: () => chart.current?.clear(), activeAction: action => { activeAction.current = action; },
    unmount: () => setMounted(false), state: () => ({ view: chart.current?.view ?? view, flow: chart.current?.flow ?? flow, active: chart.current?.activeStageId ?? null, requests: [...requests.current] }) }; }, [view, flow, active]);
  return <main style={{ padding: 24, maxWidth: 1040, margin: '0 auto' }}><h1>Funnel chart fixture</h1>
    <section data-testid="card" style={{ margin: '24px auto', width: '100%', maxWidth: 640, padding: '22px 24px 16px', border: '1px solid var(--border)', borderRadius: 18, background: 'var(--card)' }}>
      {mounted && <FunnelChart ref={chart} data={data} label="Checkout funnel" title="Checkout funnel" period="Last 30 days" unit="sessions" {...props}
        view={controlled ? view : undefined} flow={controlled ? flow : undefined} activeStageId={controlled ? active : undefined}
        onViewChange={next => { requests.current.push('view:' + next.kind); if (!rejected) setView(next); }}
        onFlowChange={next => { requests.current.push('flow:' + next); if (!rejected) setFlow(next); }}
        onActiveStageChange={(next, interaction) => { requests.current.push('active:' + next + ':' + interaction.via); if (!rejected) setActive(next);
          const action = activeAction.current; activeAction.current = null; if (action === 'clear') chart.current?.clear(); else if (action === 'retire') setMounted(false); }}
        renderStageTooltip={tooltip === 'default' ? undefined : tooltip === 'hidden' ? () => null : context => <div data-testid="custom-inspector">Custom {context.stage.label}: {context.value}</div>} />}
    </section><button type="button">After chart</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
