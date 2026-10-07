/** Isolated public primitive compositions; no auth, network, shortcut or app state. */
import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Kbd, KbdGroup } from '#zero/components/kbd';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent } from '#zero/components/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '#zero/components/animate-ui/components/radix/popover';

const keyRef = createRef<HTMLElement>();
createRoot(document.getElementById('root')!).render(<main className="mx-auto grid max-w-sm gap-5 p-5 text-sm" style={{ minWidth: 0 }}>
  <h1 className="text-lg font-medium">Keyboard hints</h1>
  <p>Open commands <Kbd ref={keyRef} data-testid="plain">⌘ K</Kbd></p>
  <KbdGroup data-testid="group" aria-label="Save shortcut"><Kbd>Ctrl</Kbd><Kbd>S</Kbd></KbdGroup>
  <p>Move <Kbd data-testid="default-icon" aria-label="Arrow up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-6-10 6-6 6 6" stroke="currentColor" fill="none" /></svg></Kbd>
    <Kbd data-testid="sized-icon"><svg className="size-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" stroke="currentColor" /></svg></Kbd></p>
  <div className="relative"><Input aria-label="Search example" placeholder="Search examples" wrapperClassName="w-full" className="pe-16" /><Kbd aria-hidden="true" className="absolute end-3 top-1/2 -translate-y-1/2">⌘ K</Kbd></div>
  <Tooltip><TooltipTrigger asChild><Button type="button" variant="outline">Save example</Button></TooltipTrigger>
    <TooltipContent aria-label="Save with shortcut" transition={{ duration: 0 }}><span>Save <Kbd data-testid="tooltip-key">⌘ S</Kbd></span></TooltipContent></Tooltip>
  <Popover><PopoverTrigger asChild><Button type="button" variant="outline">Ordinary popover</Button></PopoverTrigger>
    <PopoverContent><Kbd data-testid="popover-key">Ctrl</Kbd> remains a normal muted hint.</PopoverContent></Popover>
  <div data-testid="custom-metrics" style={{ '--zero-kbd-height': '28px', '--zero-kbd-min-width': '30px', '--zero-kbd-gap': '6px', '--zero-kbd-padding-inline': '8px',
    '--zero-kbd-font-size': '14px', '--zero-kbd-icon-size': '16px', '--zero-kbd-radius': '3px', '--zero-kbd-group-gap': '9px' } as React.CSSProperties}>
    <KbdGroup><Kbd data-testid="custom">A<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16" stroke="currentColor" /></svg></Kbd><Kbd>B</Kbd></KbdGroup>
  </div>
  <Button type="button" variant="ghost" onClick={() => { document.getElementById('ref-result')!.textContent = String(keyRef.current?.tagName === 'KBD'); }}>Check ref</Button><output id="ref-result" />
</main>);
