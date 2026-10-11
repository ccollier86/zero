/** Contrast and palette identity contracts for the new pure theme color defaults; no browser or theme installation. */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { THEME_DARK_COLORS, THEME_LIGHT_COLORS } from './theme-colors';

const themes = { light: THEME_LIGHT_COLORS, dark: THEME_DARK_COLORS };
type Colors = Readonly<Record<string, string>>;
const plainSurfaces = ['canvas', 'surface', 'raised', 'muted', 'inset', 'sidebar-canvas'] as const;
const quietControlSurfaces = ['interaction-fill', 'interaction-hover', 'secondary-fill', 'sidebar-accent'] as const;
const series = ['blue', 'orange', 'green', 'amber', 'purple', 'teal', 'rose', 'olive'] as const;

/** WCAG relative luminance of a six-digit opaque sRGB literal. */
function luminance(color: string): number {
  const channels = [1, 3, 5].map(offset => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function ratio(colors: Colors, first: string, second: string): number {
  const a = luminance(colors[`--zero-theme-${first}`]!);
  const b = luminance(colors[`--zero-theme-${second}`]!);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('new theme color contract', () => {
  test('both modes expose identical immutable literal semantic keys', () => {
    expect(Object.keys(THEME_LIGHT_COLORS).sort()).toEqual(Object.keys(THEME_DARK_COLORS).sort());
    for (const colors of Object.values(themes)) {
      expect(Object.isFrozen(colors)).toBe(true);
      expect(Object.keys(colors).length).toBe(52);
      for (const [name, color] of Object.entries(colors)) {
        expect(name).toMatch(/^--zero-theme-[a-z]+(?:-[a-z]+)*$/);
        expect(color).toMatch(/^#[\da-f]{6}$/);
      }
    }
  });

  for (const [mode, colors] of Object.entries(themes)) {
    test(`${mode} small text remains at least 4.5:1 on plain materials and quiet active-row fills`, () => {
      for (const text of ['text-primary', 'text-secondary', 'text-muted']) {
        for (const surface of [...plainSurfaces, ...quietControlSurfaces]) {
          expect(ratio(colors, text, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const text of ['sidebar-foreground', 'sidebar-muted']) {
        for (const surface of ['sidebar-canvas', 'sidebar-accent']) {
          expect(ratio(colors, text, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    test(`${mode} control foregrounds meet small-text contrast on actual fills and hover states`, () => {
      for (const [foreground, fill] of [
        ['primary-foreground', 'primary-fill'], ['primary-foreground', 'primary-hover'],
        ['interaction-foreground', 'interaction-fill'], ['interaction-foreground', 'interaction-hover'],
        ['secondary-foreground', 'secondary-fill'], ['selection-foreground', 'selection-fill'],
        ['sidebar-primary-foreground', 'sidebar-primary'], ['sidebar-accent-foreground', 'sidebar-accent'],
      ]) {
        expect(ratio(colors, foreground!, fill!)).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${mode} state ink, washes and solid actions have independent readable pairs`, () => {
      for (const state of ['success', 'warning', 'danger'] as const) {
        expect(ratio(colors, `${state}-foreground`, `${state}-fill`)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(colors, `${state}-ink`, `${state}-wash`)).toBeGreaterThanOrEqual(4.5);
        for (const surface of plainSurfaces) {
          expect(ratio(colors, `${state}-ink`, surface)).toBeGreaterThanOrEqual(4.5);
        }
        expect(colors[`--zero-theme-${state}-wash`]).not.toBe(colors[`--zero-theme-${state}-fill`]);
      }
    });

    test(`${mode} control boundaries and focus indicators meet 3:1 against adjacent plain surfaces`, () => {
      for (const identifier of ['input', 'border-strong', 'ring', 'sidebar-ring']) {
        for (const surface of plainSurfaces) {
          expect(ratio(colors, identifier, surface)).toBeGreaterThanOrEqual(3);
        }
      }
      // Fine separators are intentional decoration, not the sole input/focus identifier.
      expect(colors['--zero-theme-border-default']).not.toBe(colors['--zero-theme-input']);
      expect(colors['--zero-theme-border-subtle']).not.toBe(colors['--zero-theme-ring']);
    });

    test(`${mode} Arc-led plain materials remain achromatic while category identities stay distinct`, () => {
      for (const surface of plainSurfaces) {
        const color = colors[`--zero-theme-${surface}`]!;
        expect(color.slice(1, 3)).toBe(color.slice(3, 5));
        expect(color.slice(3, 5)).toBe(color.slice(5, 7));
      }
      expect(new Set(series.map(name => colors[`--zero-theme-series-${name}`])).size).toBe(series.length);
      expect(colors['--zero-theme-primary-fill']).not.toBe(colors['--zero-theme-interaction-fill']);
    });
  }

  test('new named analytical series preserve existing light/dark chart paint rather than rotating categories', () => {
    const css = readFileSync(new URL('../components/charts/chart-tokens.css', import.meta.url), 'utf8');
    const existingLight = css.match(/:root, \.light, \[data-theme="light"\] \{([^}]+)\}/)?.[1];
    const existingDark = css.match(/\.dark, \[data-theme="dark"\] \{([^}]+)\}/)?.[1];
    expect(existingLight).toBeDefined();
    expect(existingDark).toBeDefined();
    for (const [colors, section] of [[THEME_LIGHT_COLORS, existingLight], [THEME_DARK_COLORS, existingDark]] as const) {
      for (const name of series) {
        const color = section!.match(new RegExp(`--zero-chart-${name}:\\s*(#[\\da-f]{6});`))?.[1];
        if (color === undefined) throw new Error(`Missing existing chart palette color: ${name}`);
        expect(colors[`--zero-theme-series-${name}`]).toBe(color);
      }
    }
  });
});
