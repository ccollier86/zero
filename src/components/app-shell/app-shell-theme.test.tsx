/** The application shell switches token boundaries without changing its DOM, interactions or public-page roots. */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from './app-shell';
import type { AppShellPreset, AppShellProps } from './app-shell.types';

describe('AppShell foundation activation', () => {
  for (const preset of ['dashboard', 'auth-dashboard', 'custom', 'topbar', 'simple-sidebar', 'minimal'] satisfies AppShellPreset[]) {
    test(`${preset} activates next on its existing frame and keeps an explicit legacy rollback`, () => {
      const render = (themeFoundation?: AppShellProps['themeFoundation']) => renderToStaticMarkup(
        <AppShell preset={preset} themeFoundation={themeFoundation} sidebar={false} header={false}><p>Application</p></AppShell>,
      );
      const next = render(), legacy = render('legacy');
      expect(next).toContain('data-zero-theme="next"');
      expect(next).toContain('data-zero-density="compact"');
      expect(next).not.toContain('data-zero-mode');
      expect(next.match(/data-zero-theme=/g)).toHaveLength(1);
      expect(legacy).not.toContain('data-zero-theme');
      expect(legacy).not.toContain('data-zero-density');
      // The marker is the only structural change: no new wrappers or providers.
      expect(next.replace(/ data-zero-theme="next"| data-zero-density="compact"/g, '')).toBe(legacy);
      expect(render('next')).toBe(next);
    });
  }

  test('a public sibling remains outside the application theme boundary', () => {
    const html = renderToStaticMarkup(<>
      <section className="zero-public-page"><p>Public page</p></section>
      <AppShell preset="minimal"><p>Application</p></AppShell>
    </>);
    expect(html).toStartWith('<section class="zero-public-page">');
    expect(html).not.toContain('<html');
    expect(html).not.toContain('<body');
    expect(html.indexOf('Public page')).toBeLessThan(html.indexOf('data-zero-theme="next"'));
  });

  test('malformed explicit selections do not silently activate a different foundation', () => {
    for (const value of [null, false, ['next'], new String('next'), 'unknown']) {
      expect(() => renderToStaticMarkup(<AppShell themeFoundation={value as never}><p>Application</p></AppShell>)).toThrow('themeFoundation');
    }
  });
});
