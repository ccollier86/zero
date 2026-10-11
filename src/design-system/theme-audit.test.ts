/** Source-only diagnostic qualification; global CSS compilation stays in memory and boots no application services. */
import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { auditThemeTokenUsage, collectThemeTokenDeclarations } from './theme-audit';

describe('source theme diagnostics', () => {
  test('private underscore declarations and quoted object keys are real source owners', () => {
    const sources = [
      { name: 'component.css', content: '.root { --_unit: 4px; --Local: 12px } .row { width: var(--_unit); height: VAR(--Local) }' },
      { name: 'component.tsx', content: `const style = { '--_width': '12px', "--Height": '16px' }; const paint = 'VAR(--Height) var(--_width)';` },
    ];
    expect(collectThemeTokenDeclarations(sources)).toEqual(['--Height', '--Local', '--_unit', '--_width']);
    expect(auditThemeTokenUsage(sources)).toHaveLength(0);
  });

  test('function names are case-insensitive but custom property names are not', () => {
    const findings = auditThemeTokenUsage([{ name: 'case.css', content: ':root { --Present: 1px } .a { width: VAR(--Present); height: VaR(--present) }' }]);
    expect(findings.map(item => item.token)).toEqual(['--present']);
  });

  test('CSS quoted content is not a computed variable, paint candidate, or token declaration', () => {
    const sources = [{ name: 'text.css', content: '.label { content: "VAR(--quoted) #abcdef --ghost: blue"; } .a { width:var(--ghost); }' }];
    expect(collectThemeTokenDeclarations(sources)).toHaveLength(0);
    expect(auditThemeTokenUsage(sources).map(item => [item.kind, item.token])).toEqual([['unresolved-reference', '--ghost']]);
  });

  test('comments preserve diagnostic line offsets without erasing quoted JS style strings', () => {
    const sources = [{ name: 'styles.tsx', content: `// VAR(--line-comment) #abc\n/* var(--block-comment)\n #abcdef */\nconst style = { '--_value': '4px', color: 'VAR(--missing)' };\nconst url = 'https://example.test/#aabbcc';` }];
    const findings = auditThemeTokenUsage(sources, { reportLiteralColors: false });
    expect(findings.map(item => [item.line, item.token])).toEqual([[4, '--missing']]);
    expect(findings.every(Object.isFrozen)).toBe(true); expect(Object.isFrozen(findings)).toBe(true);
    expect(collectThemeTokenDeclarations(sources)).toEqual(['--_value']);
  });

  test('only valid CSS hex lengths are paint review candidates', () => {
    const findings = auditThemeTokenUsage([{ name: 'paint.css', content: '.a { a:#abc; b:#abcd; c:#abcdef; d:#abcdef12; e:#abcde; f:#abcdef1; }' }]);
    expect(findings.filter(item => item.kind === 'literal-color')).toHaveLength(4);
  });

  test('external declarations resolve exact names and do not allow entire Tailwind color namespaces', () => {
    const findings = auditThemeTokenUsage([{ name: 'external.css', content: '.a { a:var(--color-neutral-500); b:var(--color-not-real); c:VAR(--missing, var(--also-missing)); }' }],
      { externalTokens: ['--color-neutral-500'] });
    expect(findings.map(item => item.token)).toEqual(['--color-not-real', '--also-missing']);
  });

  test('actual global imports provide Tailwind theme names without adding compiled paint findings', async () => {
    const require = createRequire(import.meta.url);
    const { compile } = require('@tailwindcss/node') as typeof import('@tailwindcss/node');
    const globalUrl = new URL('../frontend/styles/globals.css', import.meta.url);
    const compiler = await compile(readFileSync(globalUrl, 'utf8'), {
      base: new URL('../frontend/styles/', import.meta.url).pathname, from: globalUrl.pathname, onDependency() {},
    });
    const compiled = compiler.build(['[color:var(--color-neutral-500)]', '[color:var(--color-neutral-300)]', '[color:var(--color-not-real)]']);
    const externalTokens = collectThemeTokenDeclarations([{ name: 'compiled.css', content: compiled }]);
    expect(externalTokens).toContain('--color-neutral-500'); expect(externalTokens).toContain('--color-neutral-300');
    expect(externalTokens).toContain('--spacing'); expect(externalTokens).toContain('--shadow-lg');
    expect(externalTokens).not.toContain('--color-not-real');
    const findings = auditThemeTokenUsage([{ name: 'component.tsx', content: 'const style = "VAR(--color-neutral-500) var(--color-neutral-300) var(--spacing) var(--shadow-lg) var(--color-not-real)";' }], { externalTokens });
    expect(findings.map(item => [item.kind, item.token])).toEqual([['unresolved-reference', '--color-not-real']]);
  });

  test('migration CLI keeps generated CSS parity separate and passes import declarations, not compiled source', () => {
    const source = readFileSync(new URL('../../scripts/check-theme-foundation.ts', import.meta.url), 'utf8');
    expect(source).toContain('generated !== renderThemeFoundationCss()');
    expect(source).toContain("relative(root, path) === 'src/frontend/styles/theme-next.css'");
    expect(source).toContain('auditThemeTokenUsage(inspected, { externalTokens })');
    expect(source).not.toMatch(/\b(?:writeFile|appendFile|mkdir|spawn|execSync|startServer)\s*\(/u);
  });
});
