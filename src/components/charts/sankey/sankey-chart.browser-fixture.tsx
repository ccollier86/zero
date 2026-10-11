/** Isolated reference chart fixture using synthetic public aggregates; never starts a Zero app or connects to a database. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SankeyChart } from './sankey-chart';
import type { SankeyData, SankeyTrace, SankeyTraceTarget } from './sankey-types';

const nodes = ['organic', 'paid', 'referral', 'activated', 'inactive', 'free', 'pro', 'team', 'retained', 'churned'].map(id => ({ id,
  label: ({ organic: 'Organic', paid: 'Paid', referral: 'Referral', activated: 'Activated', inactive: 'Not activated',
    free: 'Free', pro: 'Pro', team: 'Team', retained: 'Retained', churned: 'Churned' } as Record<string, string>)[id] }));
const links = [
  ['organic', 'activated', 3300], ['organic', 'inactive', 1700], ['paid', 'activated', 1800], ['paid', 'inactive', 2000],
  ['referral', 'activated', 1850], ['referral', 'inactive', 550], ['activated', 'free', 3800], ['activated', 'pro', 2300], ['activated', 'team', 850],
  ['free', 'retained', 2000], ['free', 'churned', 1800], ['pro', 'retained', 1950], ['pro', 'churned', 350], ['team', 'retained', 800], ['team', 'churned', 50],
].map(([source, target, value]) => ({ source: source as string, target: target as string, value: value as number }));
export const sankeyReferenceData: SankeyData = { nodes, links };
const columns = ['Source', 'Activation', 'Plan', '90 days'];
declare global {
  interface Window { __sankeyFixture: {
    data: (value: SankeyData) => void; reference: () => SankeyData; trace: (value: SankeyTraceTarget | null) => void;
    state: () => { trace: SankeyTraceTarget | null; event: SankeyTrace | null };
    tooltip: (value: 'default' | 'custom' | 'hidden') => void;
    controlled: (value: boolean) => void; motion: (value: boolean) => void; particles: (value: boolean) => void;
    orientation: (value: 'auto' | 'horizontal' | 'vertical') => void; height: (value: number) => void;
    unmount: () => void;
  }; }
}
function Fixture() {
  const [data, setData] = React.useState<SankeyData>(sankeyReferenceData), [trace, setTrace] = React.useState<SankeyTraceTarget | null>(null),
    [tooltip, setTooltip] = React.useState<'default' | 'custom' | 'hidden'>('default'), [controlled, setControlled] = React.useState(true),
    [motion, setMotion] = React.useState(true), [particles, setParticles] = React.useState(true),
    [orientation, setOrientation] = React.useState<'auto' | 'horizontal' | 'vertical'>('auto'), [height, setHeight] = React.useState(340), [mounted, setMounted] = React.useState(true);
  const event = React.useRef<SankeyTrace | null>(null);
  React.useEffect(() => { window.__sankeyFixture = { data: setData, reference: () => sankeyReferenceData, trace: setTrace, state: () => ({ trace, event: event.current }),
    tooltip: setTooltip, controlled: setControlled, motion: setMotion, particles: setParticles, orientation: setOrientation, height: setHeight,
    unmount: () => setMounted(false) }; }, [trace]);
  return <main style={{ padding: 24, maxWidth: 1040, margin: '0 auto' }}><h1>Sankey chart fixture</h1>
    <section data-testid="frame" style={{ marginTop: 20, padding: '26px 28px 22px', border: '1px solid var(--border)', borderRadius: 20, background: 'var(--card)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}><b>Signup journey</b><span>11,200 signups, Jul to Sep 2026</span></header>
      {mounted && <SankeyChart data={data} label="Signup journey" columns={columns} trace={controlled ? trace : undefined}
        onTraceChange={next => { event.current = next; setTrace(next?.target ?? null); }} unit="people" totalLabel="signups"
        motion={motion} particles={particles} onParticlesChange={setParticles} orientation={orientation} height={height}
        renderNodeTooltip={tooltip === 'default' ? undefined : tooltip === 'hidden' ? () => null : ({ node, trace }) => <div data-testid="custom-tooltip">Custom {node.label}: {trace.value}</div>}
        renderLinkTooltip={tooltip === 'default' ? undefined : tooltip === 'hidden' ? () => null : ({ link }) => <div data-testid="custom-tooltip">Custom link {link.id}</div>} />}
    </section>
    <button type="button" style={{ marginTop: 20 }}>After chart</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
