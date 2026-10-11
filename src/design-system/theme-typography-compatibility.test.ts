/** Specialized typography alias contracts; pure theme composition, no application or browser state. */
import { expect, test } from 'bun:test';
import { createThemeDeclarations } from './theme-tokens';
import { THEME_COMPONENT_ALIASES } from './theme-compatibility';
import type { ThemeTokenMap } from './theme-types';

function resolve(tokens: ThemeTokenMap, name: string): string {
  const value = tokens[name]!;
  const reference = /^var\((--[\w-]+)(?:,\s*[^)]+)?\)$/u.exec(value);
  return reference ? resolve(tokens, reference[1]!) : value;
}

test('modal, tooltip, chart, list and code consumers retain exact task typography through canonical aliases', () => {
  const expected = {
    '--zero-modal-title-size': '1.02rem', '--zero-modal-title-leading': '1.35', '--zero-modal-title-weight': '600',
    '--zero-modal-title-tracking': '-.01em', '--zero-modal-body-size': '.875rem', '--zero-modal-body-leading': '1.5',
    '--zero-modal-description-size': '.86rem', '--zero-modal-meta-size': '.8rem', '--zero-modal-footer-size': '.8rem',
    '--zero-tooltip-font-size': '.78125rem', '--zero-tooltip-line-height': '1.4', '--zero-tooltip-font-weight': '500',
    '--zero-tooltip-title-weight': '600', '--zero-tooltip-mono-font-size': '.75rem', '--zero-tooltip-mono-line-height': '1.45',
    '--zero-tooltip-key-font-size': '.6875rem', '--zero-chart-title-size': '14px', '--zero-chart-label-size': '12.5px',
    '--zero-chart-row-value-size': '12.5px', '--zero-chart-readout-size': '14px', '--zero-chart-metadata-size': '11.5px',
    '--zero-chart-inspector-font-size': '12px', '--zero-chart-inspector-line-height': '1.45',
    '--zero-chart-inspector-value-size': '17px', '--zero-chart-inspector-value-line-height': '1.3',
    '--zero-list-title-size': '.875rem', '--zero-list-description-size': '.8125rem',
    '--zero-code-font-size': '.8125rem', '--zero-code-line-height': '1.75',
    '--zero-code-header-font-size': '.8125rem', '--zero-code-header-font-weight': '500',
  };
  for (const mode of ['light', 'dark'] as const) {
    const tokens = createThemeDeclarations({ mode });
    for (const [name, value] of Object.entries(expected)) {
      expect(THEME_COMPONENT_ALIASES[name], name).toMatch(/^var\(--zero-(?:type|theme)-/u);
      expect(resolve(tokens, name), name).toBe(value);
    }
    expect(resolve(tokens, '--zero-modal-font-family')).toBe(tokens['--zero-theme-font-body']);
    expect(resolve(tokens, '--zero-tooltip-font-family')).toBe(tokens['--zero-theme-font-body']);
    expect(resolve(tokens, '--zero-chart-font-family')).toBe(tokens['--zero-theme-font-body']);
    expect(resolve(tokens, '--zero-tooltip-mono-font-family')).toBe(tokens['--zero-theme-font-mono']);
  }
});

test('specialized canonical roles are admitted overrides while inspector foundation aliases remain compatible', () => {
  const tokens = createThemeDeclarations({ overrides: {
    '--zero-type-tooltip-size': '18px', '--zero-type-modal-title-size': '20px', '--zero-type-analytical-label-size': '15px',
    '--zero-type-list-title-size': '16px', '--zero-type-technical-leading': '1.9', '--zero-theme-inspector-size': '13px',
  } });
  expect(resolve(tokens, '--zero-tooltip-font-size')).toBe('18px');
  expect(resolve(tokens, '--zero-modal-title-size')).toBe('20px');
  expect(resolve(tokens, '--zero-chart-label-size')).toBe('15px');
  expect(resolve(tokens, '--zero-chart-row-value-size')).toBe('15px');
  expect(resolve(tokens, '--zero-list-title-size')).toBe('16px');
  expect(resolve(tokens, '--zero-code-line-height')).toBe('1.9');
  expect(resolve(tokens, '--zero-chart-inspector-font-size')).toBe('13px');
  const explicit = createThemeDeclarations({ overrides: { '--zero-theme-inspector-size': '13px', '--zero-type-inspector-size': '15px' } });
  expect(resolve(explicit, '--zero-chart-inspector-font-size')).toBe('15px');
  // Pure role adoption never rewrites presentation clocks or analytical geometry.
  expect(tokens['--zero-chart-feedback']).toBe('120ms');
  expect(tokens['--zero-modal-close-glyph']).toBe('var(--zero-theme-modal-close-glyph)');
  expect(tokens['--zero-theme-hold-confirm-duration']).toBe('1500ms');
});
