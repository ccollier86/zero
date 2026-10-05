/**
 * app-shell-header.test.tsx
 *
 * Verifies outer shell header visibility for every layout using synthetic SSR
 * content. It does not initialize clients, browser sessions or data services.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from './app-shell';
import type { AppShellPreset } from './app-shell.types';

describe('AppShell outer header visibility', () => {
  const presets: AppShellPreset[] = [
    'dashboard', 'auth-dashboard', 'custom', 'topbar', 'simple-sidebar',
  ];

  for (const preset of presets) {
    test(`${preset} honors false and hidden configuration`, () => {
      for (const header of [false, { hide: true, title: 'Hidden title' }] as const) {
        const html = renderToStaticMarkup(
          <AppShell preset={preset} header={header} sidebar={false}>
            <p>Application content</p>
          </AppShell>,
        );
        expect(html).not.toContain('<header');
        expect(html).not.toContain('Hidden title');
        expect(html).toContain('Application content');
      }
    });
  }

  test('simple layouts still render configured visible header and content', () => {
    for (const preset of ['topbar', 'simple-sidebar'] as const) {
      const html = renderToStaticMarkup(
        <AppShell preset={preset} header={{ title: 'Visible title' }}>
          <p>Application content</p>
        </AppShell>,
      );
      expect(html).toContain('<header');
      expect(html).toContain('Visible title');
      expect(html).toContain('Application content');
    }
  });

  test('minimal remains content-only even with header configuration', () => {
    const html = renderToStaticMarkup(
      <AppShell preset="minimal" header={{ title: 'Unused title' }}>
        <p>Application content</p>
      </AppShell>,
    );
    expect(html).not.toContain('<header');
    expect(html).not.toContain('Unused title');
    expect(html).toContain('Application content');
  });
});
