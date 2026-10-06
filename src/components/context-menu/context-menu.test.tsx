/** SSR and composition contracts for the public context-menu family; real gestures live in browser tests. */
import * as React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Copy, Trash2 } from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup,
  ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut,
  ContextMenuCheckboxItem, ContextMenuRadioGroup, ContextMenuRadioItem,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuArrow,
  type ContextMenuContentProps, type ContextMenuSubProps,
} from './index';

function renderMenu(children: React.ReactNode, contentProps: Partial<ContextMenuContentProps> = {}) {
  return renderToStaticMarkup(<ContextMenu>
    <ContextMenuTrigger>Files</ContextMenuTrigger>
    <ContextMenuContent portal={false} forceMount {...contentProps}>{children}</ContextMenuContent>
  </ContextMenu>);
}

describe('Zero ContextMenu public composition', () => {
  test('is SSR safe and gives an ordinary target a keyboard focus stop', () => {
    const markup = renderToStaticMarkup(<ContextMenu>
      <ContextMenuTrigger aria-label="File actions">File</ContextMenuTrigger>
      <ContextMenuContent><ContextMenuItem>Open</ContextMenuItem></ContextMenuContent>
    </ContextMenu>);
    expect(markup).toContain('data-slot="context-menu-trigger"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="File actions"');
    expect(markup).not.toContain('role="menu"');
  });

  test('respects an explicit focus strategy and does not focus disabled targets by default', () => {
    const markup = renderToStaticMarkup(<>
      <ContextMenu><ContextMenuTrigger tabIndex={-1}>Roving target</ContextMenuTrigger></ContextMenu>
      <ContextMenu><ContextMenuTrigger disabled>Disabled target</ContextMenuTrigger></ContextMenu>
    </>);
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('data-disabled=""');
    expect(markup).not.toContain('tabindex="0"');
  });

  test('composes asChild targets without extra trigger wrappers', () => {
    const markup = renderToStaticMarkup(<ContextMenu><ContextMenuTrigger asChild>
      <button type="button" aria-label="Actions for report">Report</button>
    </ContextMenuTrigger></ContextMenu>);
    expect(markup).toStartWith('<button');
    expect(markup).toContain('data-slot="context-menu-trigger"');
    expect(markup).toContain('aria-label="Actions for report"');
    expect(markup).not.toContain('<span');
  });

  test('renders tokenized grouped items with colored leading icons, counts, separators, and shortcuts', () => {
    const markup = renderMenu(<>
      <ContextMenuLabel inset>File actions</ContextMenuLabel>
      <ContextMenuGroup aria-label="Editing">
        <ContextMenuItem icon={<Copy className="text-primary" />} endAdornment={<span>4</span>}>Copy</ContextMenuItem>
        <ContextMenuItem disabled endAdornment={<ContextMenuShortcut>⌘V</ContextMenuShortcut>}>Paste</ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator className="bg-primary/20" />
      <ContextMenuItem variant="destructive" icon={<Trash2 />}>Delete</ContextMenuItem>
      <ContextMenuArrow />
    </>);
    expect(markup).toContain('role="menu"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('bg-popover');
    expect(markup).toContain('text-popover-foreground');
    expect(markup).toContain('border-border/85');
    expect(markup).toContain('data-slot="context-menu-icon"');
    expect(markup).toContain('text-primary');
    expect(markup).toContain('data-slot="context-menu-end-adornment"');
    expect(markup).toContain('>4</span>');
    expect(markup).toContain('data-slot="context-menu-shortcut"');
    expect(markup).toContain('bg-primary/20');
    expect(markup).toContain('data-variant="destructive"');
    expect(markup).toContain('text-destructive');
    expect(markup).toContain('data-slot="context-menu-arrow"');
    expect(markup).not.toContain('endAdornment=');
    expect(markup).not.toContain(' inset=');
  });

  test('retains semantic links when asChild is combined with icon and trailing slots', () => {
    const markup = renderMenu(<ContextMenuItem asChild icon={<Copy />} endAdornment="7">
      <a href="/records">Records</a>
    </ContextMenuItem>);
    expect(markup).toContain('<a href="/records"');
    expect(markup).toContain('role="menuitem"');
    expect(markup).toContain('data-slot="context-menu-icon"');
    expect(markup).toContain('Records');
    expect(markup).toContain('>7</span>');
    expect(markup.match(/<a /g)?.length).toBe(1);
  });

  test('supports existing direct-child icon, label, and shortcut composition', () => {
    const markup = renderMenu(<ContextMenuItem><Copy />Copy<ContextMenuShortcut>⌘C</ContextMenuShortcut></ContextMenuItem>);
    expect(markup).toContain('lucide-copy');
    expect(markup).toContain('data-slot="context-menu-shortcut"');
    expect(markup).not.toContain('data-slot="context-menu-item-label"');
  });

  test('preserves checked, unchecked, and indeterminate checkbox semantics on both indicator sides', () => {
    const markup = renderMenu(<>
      <ContextMenuCheckboxItem checked icon={<Copy />} indicatorPosition="right" endAdornment="4">Enabled</ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem checked={false}>Disabled setting</ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem checked="indeterminate" indicatorPosition="right">Mixed</ContextMenuCheckboxItem>
    </>);
    expect(markup.match(/role="menuitemcheckbox"/g)?.length).toBe(3);
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain('data-indicator-position="right"');
    expect(markup).toContain('data-indicator-position="left"');
    expect(markup).toContain('end-2');
    expect(markup).toContain('start-2');
    expect(markup).toContain('lucide-minus');
    expect(markup.match(/data-slot="context-menu-item-indicator"/g)?.length).toBe(2);
  });

  test('renders radio choices with the chosen value, custom leading slot, and trailing indication', () => {
    const markup = renderMenu(<ContextMenuRadioGroup value="grid" aria-label="View">
      <ContextMenuRadioItem value="grid" icon={<Copy />} indicatorPosition="right">Grid</ContextMenuRadioItem>
      <ContextMenuRadioItem value="list">List</ContextMenuRadioItem>
    </ContextMenuRadioGroup>);
    expect(markup.match(/role="menuitemradio"/g)?.length).toBe(2);
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup.match(/data-slot="context-menu-item-indicator"/g)?.length).toBe(1);
    expect(markup).toContain('data-slot="context-menu-icon"');
    expect(markup).toContain('fill-current');
  });

  test('checkable asChild choices preserve their single semantic element with adornments', () => {
    const markup = renderMenu(<ContextMenuCheckboxItem asChild checked indicatorPosition="right" icon={<Copy />}>
      <div data-testid="custom-choice">Pinned</div>
    </ContextMenuCheckboxItem>);
    expect(markup).toContain('data-testid="custom-choice"');
    expect(markup).toContain('role="menuitemcheckbox"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('data-slot="context-menu-item-indicator"');
  });

  test('supports bounded collision-aware content and caller styling without leaking portal props', () => {
    const markup = renderMenu(<ContextMenuItem>Open</ContextMenuItem>, { className: 'w-64', collisionPadding: 16, loop: true });
    expect(markup).toContain('overflow-y-auto');
    expect(markup).toContain('overscroll-contain');
    expect(markup).toContain('--radix-context-menu-content-available-height');
    expect(markup).toContain('--radix-context-menu-content-available-width');
    expect(markup).toContain('w-64');
    expect(markup).not.toContain('opacity:0');
    expect(markup).not.toContain('portal=');
    expect(markup).not.toContain('forceMount=');
    expect(markup).not.toContain('collisionPadding=');
  });

  test('keeps native event/ref types and a single asChild content surface', () => {
    const contentRef = React.createRef<HTMLDivElement>();
    const contentProps: ContextMenuContentProps = {
      ref: contentRef,
      asChild: true,
      style: { opacity: 0.8 },
      onAnimationStart: (event) => { void event.animationName; },
      onDragStart: (event) => { void event.dataTransfer; },
    };
    const markup = renderMenu(<div data-testid="custom-surface"><ContextMenuItem>Open</ContextMenuItem></div>, contentProps);
    expect(markup.match(/data-testid="custom-surface"/g)?.length).toBe(1);
    expect(markup).toContain('role="menu"');
    expect(markup).toContain('opacity:0.8');
    expect(markup).toContain('data-slot="context-menu-content"');
    expect(markup).not.toContain('opacity:0;');
  });

  test('nested disclosure keeps accessible menu semantics and genuine controlled submenu types', () => {
    const controlled: ContextMenuSubProps = { open: true, onOpenChange: (_open) => undefined };
    const markup = renderMenu(<ContextMenuSub {...controlled}>
      <ContextMenuSubTrigger icon={<Copy />} endAdornment="3">More</ContextMenuSubTrigger>
      <ContextMenuSubContent portal={false} forceMount sideOffset={6} alignOffset={-4}>
        <ContextMenuItem>Export</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>);
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-slot="context-menu-sub-chevron"');
    expect(markup).toContain('rtl:rotate-180');
    expect(markup).toContain('data-slot="context-menu-sub-content"');
    expect(markup).toContain('Export');
  });

  test('submenu asChild keeps one accessible semantic disclosure with all adornments', () => {
    const markup = renderMenu(<ContextMenuSub>
      <ContextMenuSubTrigger asChild icon={<Copy />} endAdornment="3"><div data-testid="custom-sub">More</div></ContextMenuSubTrigger>
      <ContextMenuSubContent portal={false} forceMount><ContextMenuItem>Export</ContextMenuItem></ContextMenuSubContent>
    </ContextMenuSub>);
    expect(markup).toContain('data-testid="custom-sub"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('data-slot="context-menu-sub-chevron"');
    expect(markup).toContain('>3</span>');
  });
});
