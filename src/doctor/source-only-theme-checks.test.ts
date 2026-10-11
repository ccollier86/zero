/** Pure backing-theme findings; no filesystem mutations, providers or application execution. */
import { describe, expect, test } from 'bun:test';
import { renderThemeFoundationCss } from '../design-system/theme-css';
import { checkSourceOnlyThemeFoundation } from './source-only-theme-checks';

const healthy = { bundledStyles: renderThemeFoundationCss(), bundledLegacyStyles: ':root {\n  --foreground: #111;\n  --background: #fff;\n}', sources: [] };

describe('pure source-only foundation checks', () => {
  test('verified backing reports old references and deliberate literal paint only as aggregate review counts', () => {
    const result = checkSourceOnlyThemeFoundation({ ...healthy, sources: [{ name: 'app/style.css', content:
      '.legacy { color: var(--foreground); background: #abcdef; outline: 1px solid rgb(10, 20, 30); }' }] });
    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ bundledStyles: 'verified', legacyAliases: 2, sourceFiles: 1, readOnly: true,
      reviewCounts: { unresolvedCanonicalReferences: 0, legacyReferences: 1, literalColors: 2 } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.summary.reviewCounts)).toBe(true);
  });

  test('bundled missing/stale assets and missing mode aliases are integrity errors without source dumps', () => {
    const stale = checkSourceOnlyThemeFoundation({ ...healthy, bundledStyles: 'DO_NOT_PRINT_CSS_SECRET' });
    expect(stale.findings).toMatchObject([{ code: 'theme.foundation.generated_stale', severity: 'error', path: '@zero/framework/styles-next.css:1' }]);
    expect(JSON.stringify(stale)).not.toContain('DO_NOT_PRINT_CSS_SECRET');
    expect(checkSourceOnlyThemeFoundation({ ...healthy, bundledStyles: null }).findings[0]?.code).toBe('theme.foundation.styles_unavailable');
    expect(checkSourceOnlyThemeFoundation({ ...healthy, bundledLegacyStyles: null }).findings[0]?.code).toBe('theme.foundation.legacy_root_unavailable');
    const aliases = checkSourceOnlyThemeFoundation({ ...healthy, bundledLegacyStyles: '/* :root { --not-real: 1 } */\n:root {\n --legacy-missing-alias: 1;\n}' });
    expect(aliases.findings).toHaveLength(2);
    expect(aliases.findings).toMatchObject([{ code: 'theme.foundation.alias_missing', line: 3 }, { code: 'theme.foundation.alias_missing', line: 3 }]);
    expect(aliases.findings[0]?.message).toContain('light');
    expect(aliases.findings[1]?.message).toContain('dark');
  });

  test('only mandatory unresolved owned references receive findings; comments, strings, fallback and local declarations do not', () => {
    const result = checkSourceOnlyThemeFoundation({ ...healthy, sources: [{ name: 'app/styles.css', content:
      '/* var(--zero-theme-comment-only) */\n.local { --zero-theme-local: red; color: var(--zero-theme-local); }\n' +
      '.label { content: "var(--zero-type-quoted)"; color: var(--zero-theme-optional, red); }\n' +
      '.missing { color: var(--zero-theme-not-registered); font-size: var(--zero-type-unknown-size); width: var(--app-owned-dynamic); }' }] });
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every(finding => finding.code === 'theme.foundation.unresolved_reference'
      && finding.path === 'app/styles.css:4' && finding.line === 4 && finding.severity === 'warning')).toBe(true);
    expect(result.summary.reviewCounts.unresolvedCanonicalReferences).toBe(2);
    expect(JSON.stringify(result.findings)).not.toContain('--app-owned-dynamic');
    expect(JSON.stringify(result.findings)).not.toContain('--zero-type-quoted');
  });

  test('customized copied styles are explicit manual review, not bundled integrity failures or rewrites', () => {
    const baseline = renderThemeFoundationCss();
    const result = checkSourceOnlyThemeFoundation({ ...healthy, copiedStyles: [
      { name: 'frontend/styles/theme-next.css', content: baseline + '\n/* APP_PRIVATE_CUSTOMIZATION */' },
    ] });
    expect(result.findings).toMatchObject([{ code: 'theme.foundation.copied_styles_modified', severity: 'warning', category: 'manual-review',
      path: 'frontend/styles/theme-next.css:1' }]);
    expect(result.summary.bundledStyles).toBe('verified');
    expect(JSON.stringify(result)).not.toContain('APP_PRIVATE_CUSTOMIZATION');
    expect(checkSourceOnlyThemeFoundation({ ...healthy, copiedStyles: [{ name: 'frontend/styles/theme-next.css', content: baseline }] }).findings).toEqual([]);
  });
});
