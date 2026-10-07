/** Isolated replacement/legacy typing fixture; it owns test controls only, not table state or data sources. */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { TypingText, TypingTextCursor } from '../animate-ui/primitives/texts/typing';
import { DataTableAnimatedText } from './data-table-animated-text';

interface LegacyOptions {
  text: string | string[];
  loop?: boolean;
  inView?: boolean;
  delay?: number;
}

interface TimerReceipt { pending: number; peak: number; scheduled: number }
interface TypingFixture {
  value(value: string): void;
  enabled(enabled: boolean): void;
  visible(visible: boolean): void;
  legacy(options: LegacyOptions | null): void;
  mode(mode: 'type' | 'replace' | null): void;
  bounds(width: number): void;
  probe(): void;
  timers(): TimerReceipt;
}

declare global { interface Window { __typingTextMotion: TypingFixture } }

let receipt: TimerReceipt = { pending: 0, peak: 0, scheduled: 0 };
const pending = new Set<number>();
let probing = false;
function probeTimers() {
  if (probing) return;
  probing = true;
  const schedule = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
  window.setTimeout = ((callback: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = schedule(() => {
      pending.delete(id); receipt.pending = pending.size;
      if (typeof callback === 'function') callback(...args);
    }, timeout);
    pending.add(id); receipt.pending = pending.size;
    receipt.peak = Math.max(receipt.peak, receipt.pending); receipt.scheduled++;
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    pending.delete(id as number); receipt.pending = pending.size; cancel(id);
  }) as typeof window.clearTimeout;
}

function Fixture() {
  const [value, setValue] = React.useState(document.documentElement.dataset.initialText ?? 'Initial value');
  const [enabled, setEnabled] = React.useState(true);
  const [visible, setVisible] = React.useState(true);
  const [legacy, setLegacy] = React.useState<LegacyOptions | null>(null);
  const [mode, setMode] = React.useState<'type' | 'replace' | null>(null);
  const [bounds, setBounds] = React.useState<number | null>(null);
  window.__typingTextMotion = {
    value: value => flushSync(() => setValue(value)),
    enabled: enabled => flushSync(() => setEnabled(enabled)),
    visible: visible => flushSync(() => setVisible(visible)),
    legacy: options => flushSync(() => setLegacy(options)),
    mode: mode => flushSync(() => setMode(mode)),
    bounds: width => flushSync(() => setBounds(width)),
    probe: probeTimers,
    timers: () => ({ ...receipt }),
  };
  return <>
    <output data-testid="accepted">{value}</output>
    <div style={{ width: bounds ?? 700, font: '16px sans-serif', marginTop: 20 }}>
      {visible && <button data-testid="cell" type="button" style={{ font: 'inherit', maxWidth: bounds === null ? undefined : '100%' }}>
        <DataTableAnimatedText value={value} enabled={enabled}><mark data-testid="canonical-mark">{value}</mark></DataTableAnimatedText>
      </button>}
    </div>
    {legacy && <div data-testid="legacy" style={{ marginTop: legacy.inView ? 2000 : 20 }}>
      <TypingText text={legacy.text} duration={20} holdDelay={40} delay={legacy.delay ?? 0}
        inView={legacy.inView ?? false} loop={legacy.loop ?? false}>
        <TypingTextCursor data-testid="legacy-cursor" />
      </TypingText>
    </div>}
    {mode && <div data-testid="mode"><TypingText {...(mode === 'replace'
      ? { mode, text: 'Mode value' } : { mode, text: 'Mode value', duration: 100 })} /></div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
