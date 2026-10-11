/** Synthetic native Select qualification; no application config, services, secrets or external fonts. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectLabel, SelectSeparator, SelectGroup } from './select';
import { OverlayScopeProvider, hasOwnedFloatingOverlay } from '../../overlays/overlay-scope';

const refs = { trigger: null as HTMLButtonElement | null, content: null as HTMLDivElement | null, viewport: null as HTMLDivElement | null,
  triggerMounts: 0, triggerCleanups: 0, contentMounts: 0, contentCleanups: 0 };
const triggerRef: React.RefCallback<HTMLButtonElement> = element => {
  refs.trigger = element;
  if (element) { refs.triggerMounts++; return () => { refs.triggerCleanups++; refs.trigger = null; }; }
};
const contentRef: React.RefCallback<HTMLDivElement> = element => {
  refs.content = element;
  if (element) { refs.contentMounts++; return () => { refs.contentCleanups++; refs.content = null; }; }
};
const viewportRef: React.RefCallback<HTMLDivElement> = element => { refs.viewport = element?.isConnected ? element : null; };
let updateActive!: (value: boolean) => void, updateMounted!: (value: boolean) => void;
let updateOpen!: (value: boolean) => void, updateDisabled!: (value: boolean) => void;
let updatePosition!: (value: 'popper' | 'item-aligned') => void, updateBottom!: (value: boolean) => void;
let updateScale!: (value: number) => void;
let updateRtl!: (value: boolean) => void;
const changes: string[] = [];

function Fixture() {
  const [active, setActive] = React.useState(true), [mounted, setMounted] = React.useState(true), [open, setOpen] = React.useState(false);
  const [disabled, setDisabled] = React.useState(false), [position, setPosition] = React.useState<'popper' | 'item-aligned'>('popper');
  const [bottom, setBottom] = React.useState(false), [value, setValue] = React.useState('item-0');
  const [scale, setScale] = React.useState(1), [portal, setPortal] = React.useState<HTMLDivElement | null>(null);
  const [rtl, setRtl] = React.useState(false);
  updateActive = setActive; updateMounted = setMounted; updateOpen = setOpen; updateDisabled = setDisabled;
  updatePosition = setPosition; updateBottom = setBottom;
  updateScale = setScale;
  updateRtl = setRtl;
  const owner = React.useMemo(() => ({ id: 'morph-owner', zIndex: 1800, active, container: portal }), [active, portal]);
  return <main data-zero-theme="next" data-zero-mode="light" style={{ minHeight: '100vh', padding: 24 }}>
    <div ref={setPortal} data-testid="portal" style={{ position: 'fixed', inset: 0, transform: scale === 1 ? 'none' : `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }} />
    <button type="button" data-testid="elsewhere">Elsewhere</button>
    <OverlayScopeProvider value={owner}>
      {mounted && <form data-testid="form" style={{ position: 'fixed', left: 50, top: bottom ? 'auto' : 90, bottom: bottom ? 12 : 'auto', width: 180 }}>
        <Select name="choice" required disabled={disabled} dir={rtl ? 'rtl' : 'ltr'} value={value} open={open} onOpenChange={setOpen}
          onValueChange={next => { changes.push(next); setValue(next); }}>
          <SelectTrigger ref={triggerRef} data-testid="trigger" aria-label="Choose tool"
            style={{ '--radix-select-content-available-height': '1px', '--radix-popper-transform-origin': '99px 99px' } as React.CSSProperties}><SelectValue /></SelectTrigger>
          <SelectContent ref={contentRef} viewportRef={viewportRef} position={position} data-testid="content" collisionPadding={12}>
            <SelectGroup><SelectLabel>Tools</SelectLabel>
              {Array.from({ length: 24 }, (_, i) => <React.Fragment key={i}>
                {i === 10 && <SelectSeparator />}
                <SelectItem id={`item-${i}`} data-testid={`item-${i}`} value={`item-${i}`} disabled={i === 2}
                  leading={<span data-testid={`icon-${i}`}>●</span>} description={`Description ${i}`} trailing={`Meta ${i}`}>
                  Tool {String(i).padStart(2, '0')}
                </SelectItem>
              </React.Fragment>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </form>}
    </OverlayScopeProvider>
    <form data-testid="native-form" style={{ position: 'fixed', left: 320, top: 90, width: 150 }}>
      <Select name="native" defaultValue="a"><SelectTrigger data-testid="native-trigger" aria-label="Native"><SelectValue /></SelectTrigger>
        <SelectContent data-testid="native-content"><SelectItem value="a">Alpha</SelectItem><SelectItem value="b">Beta</SelectItem></SelectContent>
      </Select>
    </form>
    <form data-testid="required-form" style={{ position: 'fixed', left: 320, top: 170, width: 150 }}>
      <Select name="required" required><SelectTrigger data-testid="required-trigger" aria-label="Required"><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent data-testid="required-content"><SelectItem value="a">Alpha</SelectItem><SelectItem value="b">Beta</SelectItem></SelectContent>
      </Select>
    </form>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
Object.assign(window, { __morphSelect: {
  active: (value: boolean) => updateActive(value), mounted: (value: boolean) => updateMounted(value), open: (value: boolean) => updateOpen(value),
  disabled: (value: boolean) => updateDisabled(value), position: (value: 'popper' | 'item-aligned') => updatePosition(value), bottom: (value: boolean) => updateBottom(value),
  scale: (value: number) => updateScale(value),
  rtl: (value: boolean) => updateRtl(value),
  refs: () => ({ ...refs, trigger: !!refs.trigger?.isConnected, content: !!refs.content?.isConnected, viewport: !!refs.viewport?.isConnected }),
  changes: () => [...changes], registered: () => hasOwnedFloatingOverlay('morph-owner'),
} });
