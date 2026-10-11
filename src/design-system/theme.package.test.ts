/** In-memory public package/export qualification; no live app, files written or environment loading. */
import { expect, test } from 'bun:test';
import { renderThemeFoundationCss } from './theme-css';

for (const target of ['browser', 'bun'] as const) test(`public design-system export builds for ${target} without runtime services`, async () => {
  const build = await Bun.build({ entrypoints: [new URL('./theme.package-fixture.ts', import.meta.url).pathname], target });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  expect(build.success).toBe(true); expect(build.outputs).toHaveLength(1);
  const source = await build.outputs[0]!.text();
  expect(source).not.toMatch(/process\.env|document\.|window\.|require\(["'](?:node:|react|@tailwindcss)/u);
});

test('default application entry keeps supplemental, legacy and backend authentication exports separate', async () => {
  const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
  expect(pkg.exports['./design-system']).toEqual({ types: './src/design-system/index.ts', import: './src/design-system/index.ts' });
  expect(pkg.exports['./styles-next.css']).toBe('./src/frontend/styles/theme-next.css');
  expect(pkg.exports['./styles.css']).toBe('./src/frontend/styles/application.css');
  expect(pkg.exports['./styles-legacy.css']).toBe('./src/frontend/styles/globals.css');
  expect(await Bun.file(new URL('../frontend/styles/application.css', import.meta.url)).text()).toContain('@import "./globals.css";\n@import "./theme-next.css";');
  expect(pkg.exports['./tokens'].import).toBe('./src/tokens/index.ts');
  expect(await Bun.file(new URL('../frontend/styles/theme-next.css', import.meta.url)).text()).toBe(renderThemeFoundationCss());
});
