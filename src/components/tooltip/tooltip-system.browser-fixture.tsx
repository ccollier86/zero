/** Synthetic public tooltip presentation fixture; no app configuration, SDK, storage or live data. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Tooltip, TooltipContent, TooltipGroup, TooltipProvider, TooltipTrigger } from './index';
import { Button } from '../ui/button';
import { ModalManager } from '../../modals/modal-manager';
import { modals } from '../../modals/modal-events';
import type { TooltipMotionPreset, TooltipVariant } from './index';

type DynamicSettings = { motion: TooltipMotionPreset; arrow: boolean; variant: TooltipVariant; label: string;
  override?: TooltipMotionPreset; contentOverride?: TooltipMotionPreset; contentArrow?: boolean;
  boundaryLabel?: string; avoidBoundaryCollisions?: boolean };

declare global {
  interface Window {
    __tooltipSystem: {
      theme(lane: 'platform' | 'public', dark: boolean): void;
      mounted(value: boolean): void;
      controlled(value: boolean): void;
      animations(clear?: boolean): { motion: string | undefined; duration: number }[];
      configure(options: Partial<DynamicSettings>): void;
      locked(value: boolean): void;
      retireOwner(): void;
    };
  }
}

// Observe actual native playback calls, including short fades that may have
// completed before a browser assertion reaches the opening element.
const playback: { motion: string | undefined; duration: number }[] = [];
const nativeAnimate = Element.prototype.animate;
Element.prototype.animate = function (frames, options) {
  const bubble = this.closest<HTMLElement>('[data-zero-tooltip]');
  const duration = typeof options === 'number' ? options : options?.duration;
  if (bubble && typeof duration === 'number') playback.push({ motion: bubble.dataset.motion, duration });
  return nativeAnimate.call(this, frames, options);
};

const longLabel = 'Synthetic extremely long tooltip information stays inside the available viewport and wraps without horizontal page overflow';
function CustomHelpButton(props: React.ComponentProps<typeof Button>) { return <Button {...props} variant="outline">Custom component trigger</Button>; }
function CustomDescription() { return <strong>DOM-only custom description</strong>; }
function Hint({ label, text = label, ...props }: { label: string; text?: string } & React.ComponentProps<typeof Tooltip>) {
  return <Tooltip {...props}><TooltipTrigger asChild><Button variant="outline">{label}</Button></TooltipTrigger>
    <TooltipContent>{text}</TooltipContent></Tooltip>;
}

function ModalHints() {
  const localTheme = { '--zero-tooltip-font-size': '19px', '--zero-tooltip-neutral-foreground': '#112233' } as React.CSSProperties;
  const explicitTheme = { '--zero-tooltip-font-size': '21px', '--zero-tooltip-neutral-foreground': '#445566' } as React.CSSProperties;
  return <div style={{ display: 'grid', gap: 16 }}>
    <Hint label="Owned standalone hint" text="Standalone hint inside the managed modal" delayDuration={0} />
    <TooltipGroup delayDuration={0}>
      <div style={{ display: 'flex', gap: 12 }}>
        <Hint label="Owned grouped hint" text="Grouped hint inside the managed modal" />
        <Hint label="Owned grouped neighbor" text="Second grouped hint inside the managed modal" />
      </div>
    </TooltipGroup>
    <div data-testid="local-tooltip-theme" style={localTheme}>
      <Hint label="Local standalone hint" text="Local standalone theme inside the managed modal" delayDuration={0} />
      <Tooltip delayDuration={0}><TooltipTrigger asChild><Button variant="outline">Explicit standalone hint</Button></TooltipTrigger>
        <TooltipContent style={explicitTheme}>Explicit standalone theme inside the managed modal</TooltipContent></Tooltip>
      <TooltipGroup delayDuration={0}>
        <Hint label="Local grouped hint" text="Local grouped theme inside the managed modal" />
      </TooltipGroup>
    </div>
  </div>;
}

function Fixture() {
  const [theme, setTheme] = React.useState({ lane: 'platform', dark: false });
  const [mounted, setMounted] = React.useState(true);
  const [controlled, setControlled] = React.useState(false);
  const [dynamic, setDynamic] = React.useState<DynamicSettings>({ motion: 'grow', arrow: true, variant: 'neutral', label: 'Initial grouped content' });
  const [locked, setLocked] = React.useState(false), [closeRequests, setCloseRequests] = React.useState(0);
  const [boundary, setBoundary] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    window.__tooltipSystem = {
      theme: (lane, dark) => setTheme({ lane, dark }), mounted: setMounted, controlled: setControlled,
      animations: clear => { const result = [...playback]; if (clear) playback.length = 0; return result; },
      configure: options => setDynamic(previous => ({ ...previous, ...options })), locked: setLocked,
      retireOwner: () => modals.discardAll(),
    };
  });
  return <ModalManager portalContainer={document.getElementById('tooltip-portals')}>
    <main data-testid="theme-source" className={theme.dark ? 'dark' : ''}
      data-zero-surface={theme.lane === 'public' ? 'public' : undefined}
      style={{ padding: 32, minHeight: 760 }}>
      <h1>Tooltip system fixture</h1>
      <TooltipProvider>
        <section aria-label="Standalone tooltips" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, paddingBlock: 32 }}>
          <Hint label="Default tooltip" text="Default Grow hint" />
          <Hint label="Warm neighbor" text="Warm provider hint" />
          <Hint label="Immediate help" text="Keyboard and hover description" delayDuration={0} />
          <Tooltip delayDuration={0}><TooltipTrigger asChild><CustomHelpButton /></TooltipTrigger>
            <TooltipContent><CustomDescription /></TooltipContent></Tooltip>
          <Tooltip delayDuration={0} arrow={false}><TooltipTrigger asChild><Button variant="outline">Rich hint</Button></TooltipTrigger>
            <TooltipContent title="Rich tooltip title" description="Helpful noninteractive detail." shortcut={['⌘', 'K']} /></Tooltip>
          {(['grow', 'spring', 'blur', 'swing'] as const).map(motion => <Hint key={motion} label={'Motion ' + motion} motion={motion} delayDuration={0} />)}
          <Hint label="Follow pointer" text="Cursor-tracked hint" followCursor delayDuration={0} />
          <span id="persistent-child-description" hidden>Persistent child explanation</span>
          <span id="persistent-trigger-description" hidden>Persistent trigger explanation</span>
          <Tooltip delayDuration={0}><TooltipTrigger asChild aria-describedby="persistent-trigger-description">
            <Button variant="outline" aria-describedby="persistent-child-description">External descriptions</Button></TooltipTrigger>
            <TooltipContent>Owned extra description</TooltipContent></Tooltip>
          <Tooltip delayDuration={0}><TooltipTrigger asChild><Button variant="outline">Custom tooltip portal</Button></TooltipTrigger>
            <TooltipContent container={document.getElementById('tooltip-extra-portals')}>Custom same-document hint</TooltipContent></Tooltip>
          <Tooltip delayDuration={0} overflowOnly><TooltipTrigger asChild>
            <Button data-testid="overflow-trigger" variant="outline" style={{ width: 150, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', justifyContent: 'start' }}>
              Synthetic overflowing record label that should be revealed
            </Button></TooltipTrigger><TooltipContent /></Tooltip>
          <Tooltip delayDuration={0} overflowOnly><TooltipTrigger asChild><Button variant="outline">Fits</Button></TooltipTrigger><TooltipContent>Should not appear</TooltipContent></Tooltip>
          <Tooltip open={controlled} onOpenChange={setControlled} delayDuration={0}><TooltipTrigger asChild><Button variant="outline">Controlled hint</Button></TooltipTrigger>
            <TooltipContent>Controlled tooltip content</TooltipContent></Tooltip>
          {mounted && <Hint label="Unmounting hint" text="Disposable tooltip content" delayDuration={0} />}
          <Button onClick={event => modals.show({ title: 'Tooltip ownership', trigger: event.currentTarget,
            motion: { entrance: 'rise' }, body: <ModalHints /> })}>Open tooltip modal</Button>
        </section>
      </TooltipProvider>
      <section aria-label="Grouped tooltips" style={{ paddingBlock: 32 }}>
        <TooltipGroup delayDuration={0}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <Hint label="Group alpha" text="Short shared hint" />
            <Hint label="Group beta" text="A longer shared hint that changes the bubble width and height as it moves to another trigger" />
            <Tooltip><TooltipTrigger asChild><Button variant="outline">Group gamma</Button></TooltipTrigger>
              <TooltipContent title="Grouped rich title" description="Changing content keeps one physical bubble." shortcut="G" /></Tooltip>
          </div>
        </TooltipGroup>
      </section>
      <section aria-label="Dynamic grouped tooltips" style={{ paddingBlock: 16 }}>
        <TooltipProvider motion={dynamic.motion} arrow={dynamic.arrow} variant={dynamic.variant}>
          <TooltipGroup delayDuration={0}>
            <Tooltip motion={dynamic.override}>
              <TooltipTrigger asChild><Button variant="outline">Dynamic group hint</Button></TooltipTrigger>
              <TooltipContent motion={dynamic.contentOverride} arrow={dynamic.contentArrow}>{dynamic.label}</TooltipContent>
            </Tooltip>
          </TooltipGroup>
        </TooltipProvider>
      </section>
      <TooltipGroup delayDuration={0}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, paddingBlock: 16 }}>
          <Tooltip open={locked} onOpenChange={next => { if (!next) setCloseRequests(previous => previous + 1); }}>
            <TooltipTrigger asChild><Button variant="outline">Controlled group owner</Button></TooltipTrigger>
            <TooltipContent>Controlled group remains until its owner accepts close</TooltipContent>
          </Tooltip>
          <Hint label="Controlled group neighbor" text="Neighbor cannot displace a refusing controlled owner" />
          <span data-testid="controlled-group-close-requests">{closeRequests}</span>
        </div>
      </TooltipGroup>
      <TooltipProvider delayDuration={0}>
        <section aria-label="Placements" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, paddingBlock: 32 }}>
          {(['top', 'right', 'bottom', 'left'] as const).map(side => <Tooltip key={side}>
            <TooltipTrigger asChild><Button variant="outline">Placement {side}</Button></TooltipTrigger>
            <TooltipContent side={side}>{'Preferred placement ' + side}</TooltipContent></Tooltip>)}
        </section>
        <Tooltip><TooltipTrigger asChild><Button style={{ position: 'fixed', right: 8, bottom: 8 }} variant="outline">Viewport edge</Button></TooltipTrigger>
          <TooltipContent side="right">{longLabel}</TooltipContent></Tooltip>
      </TooltipProvider>
      <div ref={setBoundary} data-testid="placement-boundary" style={{ position: 'relative', marginTop: 16, width: 230, height: 160, border: '1px solid var(--border)' }}>
        <Tooltip delayDuration={0}><TooltipTrigger asChild><Button variant="outline">Boundary standalone</Button></TooltipTrigger>
          <TooltipContent side="right" collisionBoundary={boundary} collisionPadding={8} avoidCollisions={dynamic.avoidBoundaryCollisions}>{dynamic.boundaryLabel ?? 'A synthetic description constrained to its declared panel boundary.'}</TooltipContent></Tooltip>
        <TooltipGroup delayDuration={0}><Tooltip><TooltipTrigger asChild><Button variant="outline">Boundary grouped</Button></TooltipTrigger>
          <TooltipContent side="right" collisionBoundary={boundary} collisionPadding={8} avoidCollisions={dynamic.avoidBoundaryCollisions}>{dynamic.boundaryLabel ?? 'A grouped description constrained to its declared panel boundary.'}</TooltipContent></Tooltip></TooltipGroup>
      </div>
      <Button variant="ghost">Outside control</Button>
    </main>
  </ModalManager>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
