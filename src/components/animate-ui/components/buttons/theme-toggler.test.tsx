import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThemeMorphIcon } from './theme-morph-icon';
import { ThemeTogglerButton } from './theme-toggler';

describe('ThemeTogglerButton', () => {
  test('server-renders one decorative morphing SVG with an action label', () => {
    const markup = renderToStaticMarkup(
      <ThemeTogglerButton modes={['light', 'dark']} />,
    );

    expect(markup.match(/<svg/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Switch to dark theme"');
    expect(markup).toContain('data-resolved-theme="light"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain('@media (prefers-reduced-motion: reduce)');
    expect(markup.indexOf('</button>')).toBeLessThan(markup.indexOf('<style>'));
  });

  test('falls back to the supported default cycle for an empty modes list', () => {
    const markup = renderToStaticMarkup(<ThemeTogglerButton modes={[]} />);

    expect(markup).toContain('aria-label="Switch to dark theme"');
  });

  test('uses a unique mask for every mounted toggle icon', () => {
    const markup = renderToStaticMarkup(
      <>
        <ThemeMorphIcon resolved="light" animate={false} />
        <ThemeMorphIcon resolved="dark" animate />
      </>,
    );
    const maskIds = Array.from(markup.matchAll(/<mask id="([^"]+)"/g)).map(
      ([, id]) => id,
    );

    expect(maskIds).toHaveLength(2);
    expect(new Set(maskIds).size).toBe(2);
    for (const id of maskIds) {
      expect(markup).toContain(`mask="url(#${id})"`);
    }
  });
});
