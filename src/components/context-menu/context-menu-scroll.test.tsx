/** SSR composition qualification for Arc ContextMenu adapters; no DOM, app data or simulated menu controller. */
import * as React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuViewport, ContextMenuItem,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  type ContextMenuContentProps,
} from './index';
import {
  ContextMenuContent as NativeContextMenuContent,
  ContextMenuSubContent as NativeContextMenuSubContent,
} from './context-menu-content';
import { OverlayScopeProvider, hasOwnedFloatingOverlay } from '../_internal/overlay-scope/overlay-scope';
import { protectContextMenuOwnedChild } from './context-menu-floating-surface';

const normalize = (markup: string) => markup.replace(/_R_[^" ]*_/gu, 'SSR-ID');
function rootMarkup(Content: typeof ContextMenuContent, props: Partial<ContextMenuContentProps> = {}) {
  return renderToStaticMarkup(<ContextMenu>
    <ContextMenuTrigger>Record</ContextMenuTrigger>
    <Content portal={false} forceMount aria-label="Record actions" {...props}>
      <ContextMenuItem>Open</ContextMenuItem>
    </Content>
  </ContextMenu>);
}

test('standard Arc content has one native viewport inside the original semantic surface and no SSR decoration', () => {
  const html = rootMarkup(ContextMenuContent, { scrollbars: 'hidden', fadeEdges: false, orientation: 'vertical',
    viewportClassName: 'bounded-menu-list', viewportStyle: { maxHeight: 180 }, className: 'w-64' });
  expect(html.match(/role="menu"/gu)).toHaveLength(1);
  expect(html.match(/data-slot="context-menu-viewport"/gu)).toHaveLength(1);
  expect(html.match(/role="menuitem"/gu)).toHaveLength(1);
  expect(html).toContain('zero-context-menu-scroll-surface');
  expect(html).toContain('zero-context-menu-scroll-viewport');
  expect(html).toContain('bounded-menu-list');
  expect(html).toContain('max-height:180px');
  expect(html).toContain('data-orientation="vertical"');
  expect(html).toContain('inert=""');
  expect(html).toContain('w-64');
  expect(html).not.toContain('zero-scroll-decoration');
  expect(html).not.toContain('data-radix-scroll-area-viewport');
  expect(html).not.toContain('scrollTreatment=');
  expect(html).not.toContain('scrollbars=');
  expect(html).not.toContain('fadeEdges=');
  expect(html).not.toContain('viewportClassName=');
  expect(html).not.toContain('tabindex="0" class="zero-context-menu-scroll-viewport');
});

test('standard padding moves inside the viewport and native utility overrides retain caller-owned frame/body spacing', () => {
  const standard = rootMarkup(ContextMenuContent);
  const frame = standard.match(/data-slot="context-menu-content"[^>]+class="([^"]+)"/u)?.[1];
  const body = standard.match(/data-slot="context-menu-viewport"[^>]+class="([^"]+)"/u)?.[1];
  expect(frame?.split(' ')).toContain('p-0');
  expect(frame?.split(' ')).not.toContain('p-1');
  expect(body?.split(' ')).toContain('p-1');
  const customized = rootMarkup(ContextMenuContent, { className: 'p-3', viewportClassName: 'p-2' });
  const customFrame = customized.match(/data-slot="context-menu-content"[^>]+class="([^"]+)"/u)?.[1];
  const customBody = customized.match(/data-slot="context-menu-viewport"[^>]+class="([^"]+)"/u)?.[1];
  expect(customFrame?.split(' ')).toContain('p-3');
  expect(customFrame?.split(' ')).not.toContain('p-0');
  expect(customBody?.split(' ')).toContain('p-2');
  expect(customBody?.split(' ')).not.toContain('p-1');
});

test('native root content remains exact original SSR markup and strips all new adapter options', () => {
  const props: Partial<ContextMenuContentProps> = { scrollTreatment: 'native', className: 'w-64',
    viewportClassName: 'must-not-leak', viewportStyle: { maxHeight: 90 }, orientation: 'horizontal',
    fadeEdges: false, scrollbars: 'always' };
  const actual = rootMarkup(ContextMenuContent, props);
  const original = rootMarkup(NativeContextMenuContent, { className: 'w-64' });
  expect(normalize(actual)).toBe(normalize(original));
  expect(actual).not.toContain('context-menu-viewport');
  expect(actual).not.toContain('must-not-leak');
  expect(actual).not.toContain('scrollTreatment=');
});

test('opaque asChild composition remains the exact native custom host instead of inventing a viewport', () => {
  const markup = (Content: typeof ContextMenuContent) => renderToStaticMarkup(<ContextMenu>
    <ContextMenuTrigger>Record</ContextMenuTrigger>
    <Content portal={false} forceMount asChild className="w-64" style={{ opacity: .65 }}>
      <section aria-label="Custom surface" data-custom="preserved"><ContextMenuItem>Open</ContextMenuItem></section>
    </Content>
  </ContextMenu>);
  const actual = markup(ContextMenuContent);
  expect(normalize(actual)).toBe(normalize(markup(NativeContextMenuContent)));
  expect(actual.match(/<section /gu)).toHaveLength(1);
  expect(actual).toContain('data-custom="preserved"');
  expect(actual).toContain('opacity:0.65');
  expect(actual).not.toContain('context-menu-viewport');
});

test('explicit custom viewport preserves one custom semantic host and its ordinary native viewport props', () => {
  const html = renderToStaticMarkup(<ContextMenu>
    <ContextMenuTrigger>Record</ContextMenuTrigger>
    <ContextMenuContent portal={false} forceMount asChild>
      <section aria-label="Custom framed menu"><header>Fixed context</header>
        <ContextMenuViewport id="custom-list" className="custom-list" style={{ maxHeight: 180 }}
          orientation="both" fadeEdges scrollbars="scroll" aria-label="Scrollable actions">
          <ContextMenuItem>Open</ContextMenuItem>
        </ContextMenuViewport>
        <footer>Fixed hint</footer>
      </section>
    </ContextMenuContent>
  </ContextMenu>);
  expect(html.match(/role="menu"/gu)).toHaveLength(1);
  expect(html.match(/<section /gu)).toHaveLength(1);
  expect(html.match(/data-slot="context-menu-viewport"/gu)).toHaveLength(1);
  expect(html).toContain('<header>Fixed context</header>');
  expect(html).toContain('<footer>Fixed hint</footer>');
  expect(html).toContain('id="custom-list"');
  expect(html).toContain('aria-label="Scrollable actions"');
  expect(html).toContain('custom-list');
  expect(html).not.toContain('orientation="both" fadeEdges');
  expect(html).not.toContain('zero-scroll-decoration');
});

test('root and submenu independently compose one viewport while native submenu stays exact original', () => {
  const markup = (SubContent: typeof ContextMenuSubContent, native: boolean) => renderToStaticMarkup(<ContextMenu>
    <ContextMenuTrigger>Record</ContextMenuTrigger>
    <ContextMenuContent portal={false} forceMount>
      <ContextMenuSub open>
        <ContextMenuSubTrigger>More</ContextMenuSubTrigger>
        <SubContent portal={false} forceMount {...(native ? { scrollTreatment: 'native' as const } : {})}>
          <ContextMenuItem>Export</ContextMenuItem>
        </SubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  </ContextMenu>);
  const arc = markup(ContextMenuSubContent, false);
  expect(arc.match(/data-slot="context-menu-viewport"/gu)).toHaveLength(2);
  expect(arc.match(/role="menu"/gu)).toHaveLength(2);
  expect(arc).toContain('data-slot="context-menu-sub-content"');
  expect(arc).not.toContain('zero-scroll-decoration');
  const native = markup(ContextMenuSubContent, true);
  // The original engine does not understand the additive adapter options.
  const original = markup(NativeContextMenuSubContent, false);
  expect(normalize(native)).toBe(normalize(original));
  expect(native.match(/data-slot="context-menu-viewport"/gu)).toHaveLength(1);
});

test('automatic portal content remains server-safe and absent until the browser mounts its actual menu', () => {
  const html = renderToStaticMarkup(<ContextMenu>
    <ContextMenuTrigger>Record</ContextMenuTrigger>
    <ContextMenuContent><ContextMenuItem>Open</ContextMenuItem></ContextMenuContent>
  </ContextMenu>);
  expect(html).toContain('Record');
  expect(html).not.toContain('role="menu"');
  expect(html).not.toContain('context-menu-viewport');
  expect(html).not.toContain('zero-scroll-decoration');
});

test('Arc owned surfaces inherit presentation without inheriting parent geometry or caller-spoofed owner layers', () => {
  const theme: React.CSSProperties = { colorScheme: 'dark', '--zero-theme-font-body': 'FixtureSans',
    '--radix-popper-transform-origin': 'wrong-parent-origin', '--zero-anchored-presence': 1 } as React.CSSProperties;
  for (const asChild of [false, true]) {
    const html = renderToStaticMarkup(<OverlayScopeProvider value={{ id: 'owned-menu-ssr', zIndex: 1501, active: true,
      themeStyle: theme }}><ContextMenu><ContextMenuTrigger>Record</ContextMenuTrigger>
      <ContextMenuContent portal={false} forceMount asChild={asChild} data-zero-overlay-owner="not-the-owner"
        style={{ zIndex: 4, color: 'rebeccapurple' }}>
        {asChild ? <section><ContextMenuItem>Open</ContextMenuItem></section> : <ContextMenuItem>Open</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu></OverlayScopeProvider>);
    expect(html).toContain('data-zero-overlay-owner="owned-menu-ssr"');
    expect(html).not.toContain('not-the-owner');
    expect(html).toContain('z-index:1503');
    expect(html).toContain('--zero-theme-font-body:FixtureSans');
    expect(html).toContain('color-scheme:dark');
    expect(html).toContain('color:rebeccapurple');
    expect(html).not.toContain('wrong-parent-origin');
    expect(html).not.toContain('--zero-anchored-presence:1');
    // Server rendering never registers a branch or constructs a DOM owner.
    expect(hasOwnedFloatingOverlay('owned-menu-ssr')).toBe(false);
  }
});

test('inactive owned Arc surfaces suppress input while native rollback stays the exact original engine', () => {
  const markup = (Content: typeof ContextMenuContent, native: boolean) => renderToStaticMarkup(
    <OverlayScopeProvider value={{ id: 'inactive-menu-ssr', zIndex: 2001, active: false }}>
      <ContextMenu><ContextMenuTrigger>Record</ContextMenuTrigger>
        <Content portal={false} forceMount {...(native ? { scrollTreatment: 'native' as const } : {})}
          style={{ zIndex: 4 }}><ContextMenuItem>Open</ContextMenuItem></Content>
      </ContextMenu>
    </OverlayScopeProvider>);
  const arc = markup(ContextMenuContent, false);
  expect(arc).toContain('data-zero-overlay-owner="inactive-menu-ssr"');
  expect(arc).toContain('z-index:2003');
  expect(arc).toContain('pointer-events:none');
  expect(arc).toContain('inert=""');
  expect(hasOwnedFloatingOverlay('inactive-menu-ssr')).toBe(false);
  const native = markup(ContextMenuContent, true);
  expect(normalize(native)).toBe(normalize(markup(NativeContextMenuContent, false)));
  expect(native).not.toContain('data-zero-overlay-owner');
  expect(native).not.toContain('pointer-events:none');
});

test('owned asChild reserves only owner policy and retains exact host, key, ref, handlers and children', () => {
  const ref = React.createRef<HTMLElement>();
  const onClick = () => undefined;
  const children = <ContextMenuItem>Open</ContextMenuItem>;
  const child = <section key="retained-host" ref={ref} onClick={onClick} data-consumer="retained"
    inert={false} data-zero-overlay-owner="child-spoof" style={{ zIndex: 3, pointerEvents: 'auto', color: 'rebeccapurple' }}>
    {children}
  </section>;
  const result = protectContextMenuOwnedChild(child, { id: 'real-owner', zIndex: 3001, active: false });
  expect(React.isValidElement(result)).toBe(true);
  const protectedChild = result as React.ReactElement<React.ComponentProps<'section'> & { 'data-zero-overlay-owner': string } >;
  expect(protectedChild.type).toBe(child.type);
  expect(protectedChild.key).toBe(child.key);
  expect(protectedChild.props.ref).toBe(ref);
  expect(protectedChild.props.onClick).toBe(onClick);
  expect(protectedChild.props.children).toBe(children);
  expect(protectedChild.props['data-zero-overlay-owner']).toBe('real-owner');
  expect(protectedChild.props.inert).toBe(true);
  expect(protectedChild.props.style?.zIndex).toBe(3003);
  expect(protectedChild.props.style?.pointerEvents).toBe('none');
  expect(protectedChild.props.style?.color).toBe('rebeccapurple');
  expect(protectContextMenuOwnedChild(child, null)).toBe(child);
  const html = renderToStaticMarkup(<OverlayScopeProvider value={{ id: 'real-owner', zIndex: 3001, active: false }}>
    <ContextMenu><ContextMenuTrigger>Record</ContextMenuTrigger>
      <ContextMenuContent portal={false} forceMount asChild>{child}</ContextMenuContent>
    </ContextMenu></OverlayScopeProvider>);
  expect(html).toContain('data-zero-overlay-owner="real-owner"');
  expect(html).not.toContain('child-spoof');
  expect(html).toContain('z-index:3003');
  expect(html).toContain('pointer-events:none');
  expect(html).toContain('inert=""');
  expect(html).toContain('color:rebeccapurple');
  expect(html.match(/<section /gu)).toHaveLength(1);
});
