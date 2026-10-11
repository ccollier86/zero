/** Native action-tray SSR contracts run without browser layout globals or application services. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FloatingButtonGroup } from './floating-button-group';

test('SSR renders stable toolbar identity, native action buttons and decorative separators without layout reads', () => {
  const html = renderToStaticMarkup(<form><FloatingButtonGroup label="Record actions" items={[
    { id: 'share', label: 'Share', icon: <svg aria-hidden="true" />, shortcut: '⌘ S', reserveLabels: ['Share', 'Copied'] },
    { type: 'separator', id: 'cluster' },
    { id: 'disabled', label: 'Unavailable', disabled: true },
    { id: 'mode', label: 'Present', pressed: false },
  ]} /></form>);
  expect(html).toContain('role="toolbar"'); expect(html).toContain('aria-label="Record actions"');
  expect(html).toContain('data-variant="muted"'); expect(html).toContain('data-size="md"');
  expect(html.match(/type="button"/gu)).toHaveLength(3);
  expect(html.match(/tabindex="0"/gu)).toHaveLength(1);
  expect(html).toContain('aria-disabled="true"'); expect(html).not.toContain(' disabled=""');
  expect(html).toContain('aria-pressed="false"'); expect(html).toContain('data-zero-floating-action="share"');
  expect(html).not.toMatch(/NaN|Infinity/gu);
});

test('SSR empty and all-disabled trays retain the explicit recovery tabstop and icon-only actions remain named', () => {
  for (const items of [[], [{ id: 'one', label: 'Unavailable', disabled: true }]]) {
    const html = renderToStaticMarkup(<FloatingButtonGroup label="Recovery actions" items={items} />);
    expect(html.match(/tabindex="0"/gu)).toHaveLength(1); expect(html).toContain('role="toolbar"');
  }
  const html = renderToStaticMarkup(<FloatingButtonGroup label="Compact actions" orientation="vertical" dir="rtl" iconOnly
    items={[{ id: 'icon', label: 'Export', icon: <svg /> }, { id: 'plain', label: 'No icon', icon: false }]} />);
  expect(html).toContain('aria-label="Export"'); expect(html).toContain('>No icon<');
  expect(html).toContain('aria-orientation="vertical"'); expect(html).toContain('dir="rtl"');
});
