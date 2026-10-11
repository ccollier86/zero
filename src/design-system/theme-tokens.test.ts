/** Pure composition/admission/coverage tests; no application configuration, providers, files writes or transport. */
import { expect, test } from 'bun:test';
import { createThemeAttributes, createThemeDeclarations, createThemeTokens, getThemeTokenCatalog } from './theme-tokens';
import { THEME_BASE_TOKENS, THEME_DENSITY_TOKENS } from './theme-foundation';
import { THEME_COMPONENT_ALIASES, THEME_COMPATIBILITY_ALIASES, THEME_PUBLIC_INHERITED_PAINT } from './theme-compatibility';
import { auditThemeTokenUsage } from './theme-audit';
import { renderThemeFoundationCss, serializeThemeDeclarations } from './theme-css';
import { assertThemeTokenGraph } from './theme-validation';
import { THEME_UTILITY_ALIASES } from './theme-utility-aliases';

test('all concrete mode/density/reduced-motion compositions have immutable complete reference graphs', () => {
  for (const mode of ['light', 'dark'] as const) for (const density of ['compact', 'comfortable', 'touch'] as const)
    for (const reducedMotion of [false, true]) {
      const tokens = createThemeTokens({ mode, density, reducedMotion });
      const declarations = createThemeDeclarations({ mode, density, reducedMotion });
      expect(Object.isFrozen(tokens)).toBe(true); expect(Object.isFrozen(declarations)).toBe(true);
      expect(() => assertThemeTokenGraph(declarations)).not.toThrow();
      expect(tokens['--zero-theme-control-height']).toBe(THEME_DENSITY_TOKENS[density]['--zero-theme-control-height']);
      expect(declarations['--zero-modal-radius']).toBe('var(--zero-theme-modal-radius)');
      expect(tokens['--zero-theme-modal-radius']).toBe('14px'); expect(tokens['--zero-theme-tooltip-radius']).toBe('8px');
      expect(declarations['--zero-modal-entrance']).toBeUndefined(); expect(declarations['--zero-tooltip-motion']).toBeUndefined();
    }
  expect(Object.keys(createThemeTokens())).toEqual(Object.keys(createThemeTokens({ mode: 'dark' })));
});

test('every legacy root semantic token retains a compatibility declaration and legacy series values', async () => {
  const source = await Bun.file(new URL('../frontend/styles/globals.css', import.meta.url)).text();
  const root = source.match(/:root\s*\{([\s\S]*?)\n\}/u)![1]!;
  const names = [...root.matchAll(/(--[a-z][\w-]*)\s*:/gu)].map(match => match[1]!);
  expect(names.length).toBe(60);
  for (const mode of ['light', 'dark'] as const) {
    const tokens = createThemeDeclarations({ mode });
    for (const name of names) expect(tokens[name]).toBeDefined();
  }
  expect(createThemeDeclarations()['--chart-2']).toBe('oklch(59.5% 0.17 305)');
  expect(createThemeDeclarations({ mode: 'dark' })['--chart-2']).toBe('oklch(70.5% 0.15 305)');
  expect(THEME_COMPATIBILITY_ALIASES['--accent']).toBe('var(--zero-theme-interaction-fill)');
  expect(THEME_COMPONENT_ALIASES['--zero-modal-background']).toBe('var(--zero-theme-raised)');
  expect(createThemeDeclarations()['--zero-sankey-particle-radius']).toBe('1.2');
  expect(createThemeDeclarations({ mode: 'dark' })['--zero-sankey-particle-radius']).toBe('1.3');
});

test('overrides are immutable, bounded, known and free of injection, unresolved refs or cycles', () => {
  const overrides = { '--zero-theme-primary-fill': '#224466' };
  expect(createThemeTokens({ overrides })['--zero-theme-primary-fill']).toBe('#224466');
  expect(overrides).toEqual({ '--zero-theme-primary-fill': '#224466' });
  expect(createThemeTokens()['--zero-theme-primary-fill']).not.toBe('#224466');
  for (const value of ['x; color: red', '</style><script>bad()</script>', 'url(https://example.invalid)', 'red !important', 'red ! important', 'red !   IMPORTANT', '{}', '\nred', '/*x*/red', '', 'var(--missing', 'red)', 'red)', '"unclosed', 'u\\72l(https://example.invalid)', 'red !\\69mportant', 'var(--zero\\2dtheme-primary-fill)', 'var(--bad!, red)'])
    expect(() => createThemeTokens({ overrides: { '--zero-theme-primary-fill': value } })).toThrow();
  expect(() => createThemeTokens({ overrides: { '--unexpected': 'red' } })).toThrow('Unknown theme token');
  for (const overrides of [[], 42, true, null, new Date()]) expect(() => createThemeTokens({ overrides } as never)).toThrow('plain token record');
  expect(() => createThemeTokens({ overrides: { '--zero-theme-primary-fill': 'var(--absent)' } })).toThrow('Unresolved');
  expect(() => createThemeTokens({ overrides: { '--zero-theme-primary-fill': 'var(--zero-theme-primary-fill, red)' } })).toThrow('Cyclic');
  expect(() => createThemeTokens({ overrides: { '--zero-theme-primary-fill': 'var(--zero-theme-primary-hover)', '--zero-theme-primary-hover': 'var(--zero-theme-primary-fill)' } })).toThrow('Cyclic');
  expect(createThemeTokens({ overrides: { '--zero-theme-primary-fill': 'var(--app-brand, #224466)' } })['--zero-theme-primary-fill']).toBe('var(--app-brand, #224466)');
  expect(createThemeTokens({ overrides: { '--zero-theme-font-body': '"var(--not-a-role)", sans-serif' } })['--zero-theme-font-body']).toBe('"var(--not-a-role)", sans-serif');
  expect(() => createThemeTokens({ overrides: { '--zero-theme-primary-fill': 'VAR(--zero-theme-primary-fill)' } })).toThrow('Cyclic');
});

test('passive public paint inheritance covers imported legacy wrapper resets without resetting geometry', async () => {
  const names = new Set<string>();
  for (const file of ['modal-tokens.css', 'tooltip-tokens.css']) {
    const css = await Bun.file(new URL(`../frontend/styles/${file}`, import.meta.url)).text();
    const publicRule = css.match(/:where\([^)]*\.zero-public[^)]*\)\s*\{([^}]+)\}/u)![1]!;
    for (const match of publicRule.matchAll(/(--[a-z][\w-]*)\s*:/gu)) names.add(match[1]!);
  }
  expect(new Set(Object.keys(THEME_PUBLIC_INHERITED_PAINT))).toEqual(names);
  expect(Object.values(THEME_PUBLIC_INHERITED_PAINT).every(value => value === 'inherit')).toBe(true);
  expect(THEME_PUBLIC_INHERITED_PAINT['--zero-modal-radius']).toBeUndefined();
});

test('all legacy inline Tailwind theme bindings are re-evaluated at explicit theme boundaries', async () => {
  const css = await Bun.file(new URL('../frontend/styles/globals.css', import.meta.url)).text();
  const block = css.match(/@theme inline\s*\{([^}]+)\}/u)![1]!;
  const aliases = Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)].map(match => [match[1]!, match[2]!.trim()]));
  expect(THEME_UTILITY_ALIASES).toEqual(aliases);
  for (const mode of ['light', 'dark'] as const) for (const name of Object.keys(aliases)) expect(createThemeDeclarations({ mode })[name]).toBeDefined();
});

test('mode/density attributes are deterministic and untyped malformed configuration fails', () => {
  expect(createThemeAttributes()).toEqual({ 'data-zero-theme': 'next', 'data-zero-density': 'compact' });
  expect(Object.isFrozen(createThemeAttributes({ mode: 'system', density: 'touch' }))).toBe(true);
  expect(() => createThemeTokens({ mode: 'system' } as never)).toThrow();
  expect(() => createThemeTokens({ mode: null } as never)).toThrow('Resolved theme mode');
  expect(() => createThemeDeclarations({ mode: null } as never)).toThrow('Resolved theme mode');
  expect(() => createThemeTokens({ density: 'constructor' } as never)).toThrow();
  expect(() => createThemeTokens({ reducedMotion: 'yes' } as never)).toThrow();
  expect(() => createThemeAttributes({ mode: '</div>' } as never)).toThrow();
  expect(() => createThemeAttributes({ density: 'constructor' } as never)).toThrow();
  expect(() => createThemeTokens({ denisty: 'compact' } as never)).toThrow();
  expect(() => createThemeAttributes({ color: 'light' } as never)).toThrow();
  for (const density of [['compact'], new String('compact'), { toString: () => 'compact' }, 1, true, null]) {
    expect(() => createThemeTokens({ density } as never)).toThrow('Unknown theme density');
    expect(() => createThemeAttributes({ density } as never)).toThrow('Unknown theme density');
  }
});

test('getter-backed options are read once and cannot mix foundation with a different compatibility mode', () => {
  let modeReads = 0, densityReads = 0, reducedReads = 0;
  const declarations = createThemeDeclarations({
    get mode() { return ++modeReads === 1 ? 'light' : 'dark'; },
    get density() { return ++densityReads === 1 ? 'compact' : 'touch'; },
    get reducedMotion() { return ++reducedReads === 1 ? false : true; },
  });
  expect([modeReads, densityReads, reducedReads]).toEqual([1, 1, 1]);
  expect(declarations['--zero-theme-canvas']).toBe('#ffffff');
  expect(declarations['--zero-sankey-particle-radius']).toBe('1.2');
  expect(declarations['--zero-theme-control-height']).toBe('2rem');
  expect(declarations['--zero-theme-duration-fast']).toBe('160ms');
  let attributeReads = 0;
  expect(createThemeAttributes({ get density() { attributeReads++; return 'comfortable'; } }))
    .toEqual({ 'data-zero-theme': 'next', 'data-zero-density': 'comfortable' });
  expect(attributeReads).toBe(1);
  expect(createThemeTokens({ mode: undefined })['--zero-theme-canvas']).toBe('#ffffff');
  expect(createThemeDeclarations({ mode: undefined })['--zero-sankey-particle-radius']).toBe('1.2');
  const nonEnumerable = Object.defineProperty({}, 'mode', { value: 'dark' });
  expect(createThemeTokens(nonEnumerable)['--zero-theme-canvas']).toBe('#141414');
  expect(createThemeDeclarations(nonEnumerable)['--zero-sankey-particle-radius']).toBe('1.3');
  for (const malformed of [Object.defineProperty({}, 'denisty', { value: 'touch' }), { [Symbol('mode')]: 'dark' }]) {
    expect(() => createThemeTokens(malformed)).toThrow('Invalid theme options');
    expect(() => createThemeDeclarations(malformed)).toThrow('Invalid theme options');
    expect(() => createThemeAttributes(malformed)).toThrow('Invalid theme options');
  }
});

test('catalog covers every role with matching palettes and explicit responsibility groups', () => {
  const catalog = getThemeTokenCatalog();
  expect(Object.isFrozen(catalog)).toBe(true); expect(catalog.every(Object.isFrozen)).toBe(true);
  expect(catalog.length).toBe(Object.keys(createThemeTokens()).length);
  expect(new Set(catalog.map(item => item.group))).toEqual(new Set(['paint', 'elevation', 'density', 'foundation', 'typography', 'motion']));
  expect(catalog.find(item => item.name === '--zero-theme-modal-radius')?.light).toBe('14px');
  expect(Object.isFrozen(THEME_BASE_TOKENS)).toBe(true);
});

test('source audit distinguishes real unresolved refs, compatible aliases and deliberate paint candidates', () => {
  const findings = auditThemeTokenUsage([{ name: 'fixture.css', content: '/* var(--comment) */\n.a {color:var(--foreground);background:var(--radix-state);width:var(--c);height:var(--unknown,10px);border:var(--missing);outline:#abc;}' }]);
  expect(findings.filter(item => item.kind === 'unresolved-reference').map(item => item.token)).toEqual(['--missing']);
  expect(findings.filter(item => item.kind === 'legacy-reference').map(item => item.token)).toEqual(['--foreground']);
  expect(findings.filter(item => item.kind === 'literal-color')).toHaveLength(1);
  expect(findings.every(item => item.line === 2 && Object.isFrozen(item))).toBe(true);
  expect(auditThemeTokenUsage([{ name: 'supplied.css', content: ':root {--provided:10px} .a{width:var(--provided)}' }])).toHaveLength(0);
  expect(auditThemeTokenUsage([{ name: 'runtime.ts', content: 'var(--app-runtime)' }], { externalTokens: ['--app-runtime'] })).toHaveLength(0);
});

test('CSS serialization is deterministic and the supplement has no unscoped roots or legacy imports', () => {
  expect(serializeThemeDeclarations({ '--b': '2px', '--a': '1px' })).toBe('  --a: 1px;\n  --b: 2px;');
  expect(() => serializeThemeDeclarations({ '--bad': '</style>' })).toThrow();
  const css = renderThemeFoundationCss();
  expect(css).toBe(renderThemeFoundationCss()); expect(css).not.toContain(':root'); expect(css).not.toContain('@import');
  expect(css).toContain('[data-zero-theme="next"]'); expect(css).toContain('[data-zero-mode="system"]');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)'); expect(css).toContain('@media (pointer: coarse)');
});
