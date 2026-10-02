import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  getCircularClipKeyframes,
  getFallbackOrigin,
} from '@/components/animate-ui/primitives/effects/theme-transition';
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

  test('falls back to the supported default cycle for an empty modes list', () => {
    const markup = renderToStaticMarkup(<ThemeTogglerButton modes={[]} />);

    expect(markup).toContain('aria-label="Switch to dark theme"');
  });
});

describe('theme circular reveal geometry', () => {
  test('covers every viewport corner from the exact activation point', () => {
    expect(
      getCircularClipKeyframes(
        { x: 50, y: 40 },
        { width: 100, height: 80 },
      ),
    ).toEqual([
      'circle(0px at 50px 40px)',
      'circle(65px at 50px 40px)',
    ]);
  });

  test('clamps pointer coordinates and retains directional fallback origins', () => {
    expect(
      getCircularClipKeyframes(
        { x: -20, y: 200 },
        { width: 100, height: 80 },
      ),
    ).toEqual([
      'circle(0px at 0px 80px)',
      'circle(129px at 0px 80px)',
    ]);
    expect(getFallbackOrigin('rtl', { width: 100, height: 80 })).toEqual({
      x: 100,
      y: 40,
    });
  });
});
