/** Disposable source/CLI fixtures prove theme Doctor never boots or rewrites an app. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { renderThemeFoundationCss } from '../design-system/theme-css';
import { runSourceOnlyDoctor } from './source-only-doctor';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
async function fixture(run: (root: string) => Promise<void>) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'theme-doctor-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function write(root: string, path: string, content: string) { await Bun.write(join(root, path), content); }
async function install(root: string) {
  await write(root, 'node_modules/@zero/framework/package.json', JSON.stringify({ name: '@zero/framework', version: '2.6.0',
    exports: { './modals': './src/modals/index.ts', './design-system': './src/design-system/index.ts', './styles-next.css': './src/frontend/styles/theme-next.css' } }));
  await write(root, 'node_modules/@zero/framework/src/modals/index.ts', 'export const modals={show}; throw new Error("PACKAGE_MUST_NOT_EXECUTE");');
}

test('theme inspection is opt-in, includes CSS, and does not demand migration of ordinary aliases/colours', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'export const style = {color:"var(--foreground)"};');
  await write(root, 'app/styles.css', '.legacy { background: #abc; color: var(--foreground); }');
  const ordinary = await runSourceOnlyDoctor({ projectRoot: root });
  expect(ordinary.scannedFiles).toBe(1); expect(ordinary.themeFoundation).toBeUndefined();
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true });
  expect(report.ok).toBe(true); expect(report.scannedFiles).toBe(2);
  expect(report.themeFoundation).toMatchObject({ bundledStyles: 'verified', sourceFiles: 2, reviewCounts: { unresolvedCanonicalReferences: 0, legacyReferences: 2, literalColors: 1 } });
  expect(report.findings).toEqual([]);
}));

test('relative CSS import closure declares owned references without evaluating any modules', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'import "../styles/local.css"; export const paint="var(--zero-theme-local)"; throw new Error("PAGE_MUST_NOT_EXECUTE");');
  await write(root, 'styles/local.css', '@import "./more.css"; :root { --zero-theme-local: purple; }');
  await write(root, 'styles/more.css', '@import "./local.css"; :root { --zero-type-local-size: 12px; }');
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, include: ['app'], strict: true });
  expect(report.ok).toBe(true); expect(report.findings).toEqual([]);
  expect(report.scannedFiles).toBe(1); expect(report.themeFoundation?.sourceFiles).toBe(3);
}));

test('discovered source aliases resolve relative CSS from their actual admitted source location', async () => fixture(async root => {
  await install(root);
  await write(root, 'shared/page.tsx', 'import "./tokens.css"; export const paint="var(--zero-theme-aliased-token)";');
  await write(root, 'shared/tokens.css', ':root { --zero-theme-aliased-token: plum; }');
  await mkdir(join(root, 'app'), { recursive: true });
  await symlink(join(root, 'shared/page.tsx'), join(root, 'app/page.tsx'));
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, include: ['app/page.tsx'], strict: true });
  expect(report.ok).toBe(true); expect(report.findings).toEqual([]);
  expect(report.themeFoundation).toMatchObject({ sourceFiles: 2, reviewCounts: { unresolvedCanonicalReferences: 0 } });
}));

test('mandatory unknown roles keep stable evidence and honour existing per-code policies', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'export const name="Unchanged";\nexport const paint="var(--zero-type-not-a-role)";');
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true });
  expect(report.ok).toBe(false);
  expect(report.findings).toMatchObject([{ code: 'theme.foundation.unresolved_reference', path: 'app/page.tsx:2', line: 2 }]);
  expect((await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true,
    rules: { 'theme.foundation.unresolved_reference': 'off' } })).ok).toBe(true);
}));

test('untyped theme inspection options reject non-booleans before reading project sources', async () => {
  for (const value of ['true', 'false', 0, 1, null, {}, [], new Boolean(false)]) {
    const options = { themeFoundation: value, get projectRoot(): string { throw new Error('PROJECT_ROOT_MUST_NOT_BE_READ'); } };
    const report = await runSourceOnlyDoctor(options as never);
    expect(report.ok).toBe(false); expect(report.scannedFiles).toBe(0);
    expect(report.findings).toMatchObject([{ code: 'theme.foundation.option_invalid', path: 'themeFoundation', severity: 'error' }]);
  }
});

test('theme inspection snapshots its opt-in flag once before asynchronous discovery', async () => fixture(async root => {
  await install(root); await write(root, 'app/styles.css', '.safe { color:var(--foreground); }');
  let reads = 0;
  const report = await runSourceOnlyDoctor({ projectRoot: root, get themeFoundation() { reads++; return reads === 1 ? true : 'invalid' as never; } });
  expect(reads).toBe(1); expect(report.ok).toBe(true);
  expect(report.scannedFiles).toBe(1); expect(report.themeFoundation?.bundledStyles).toBe('verified');
}));

test('real CSS url/escaped imports are read but fake imports in comments and content strings are ignored', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'import "../styles/main.css"; export const paint="var(--zero-theme-escaped)";');
  await write(root, 'styles/main.css', '/* @import "./comment-missing.css"; */\n' +
    '.sample { content: \'@import "./string-missing.css";\'; }\n' +
    '@import url("./with\\20 space.css");\n@import url(./unquoted.css);');
  await write(root, 'styles/with space.css', ':root { --zero-theme-escaped: teal; }');
  await write(root, 'styles/unquoted.css', ':root { --zero-theme-unquoted: plum; }');
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, include: ['app'], strict: true });
  expect(report.ok).toBe(true); expect(report.findings).toEqual([]);
  expect(report.themeFoundation?.sourceFiles).toBe(4);
}));

test('CSS continuation/comments and escaped URL spaces are literal while invalid URL whitespace is ignored', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'import "../styles/main.css"; export const paint="var(--zero-theme-continuation)";');
  await write(root, 'styles/main.css', '@import/**/"./line\\\r\ncontinuation.css";\n' +
    '@import url(./with\\20 space.css);\n' + '@import"./compact.css";\n' +
    '@import url(./invalid missing.css);');
  await write(root, 'styles/linecontinuation.css', ':root { --zero-theme-continuation: teal; }');
  await write(root, 'styles/with space.css', ':root { --zero-theme-space: plum; }');
  await write(root, 'styles/compact.css', ':root { --zero-theme-compact: orange; }');
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, include: ['app'], strict: true });
  expect(report.ok).toBe(true); expect(report.findings).toEqual([]);
  expect(report.themeFoundation?.sourceFiles).toBe(5);
}));

test('copied styles are read without rewriting and differ from the bundled asset verdict', async () => fixture(async root => {
  await install(root);
  const customized = renderThemeFoundationCss() + '\n/* deliberately app-owned */\n';
  await write(root, 'frontend/styles/theme-next.css', customized);
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true });
  expect(report.ok).toBe(true); expect(report.themeFoundation?.bundledStyles).toBe('verified');
  expect(report.findings).toMatchObject([{ code: 'theme.foundation.copied_styles_modified', category: 'manual-review' }]);
  expect(await Bun.file(join(root, 'frontend/styles/theme-next.css')).text()).toBe(customized);
}));

test('admitted customized copied styles declare tokens without adding generated paint to app review counts', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'export const paint="var(--zero-theme-custom)";');
  await write(root, 'frontend/styles/theme-next.css', renderThemeFoundationCss() + '\n:root { --zero-theme-custom: #abc; }\n');
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true });
  expect(report.ok).toBe(true);
  expect(report.findings).toMatchObject([{ code: 'theme.foundation.copied_styles_modified' }]);
  expect(report.themeFoundation).toMatchObject({ sourceFiles: 1, copiedStyles: 1,
    reviewCounts: { unresolvedCanonicalReferences: 0, literalColors: 0 } });
}));

test('copied style inspection honours lexical exclusions and excluded/private canonical targets', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'export const unchanged=true;');
  await write(root, 'frontend/styles/theme-next.css', 'EXCLUDED_COPIED_CSS_MUST_NOT_BE_READ');
  const lexical = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true,
    exclude: ['frontend/styles/theme-next.css'] });
  expect(lexical.ok).toBe(true); expect(lexical.findings).toEqual([]); expect(lexical.themeFoundation?.copiedStyles).toBe(0);
  await write(root, '.zero/private.css', ':root { --zero-theme-secret: PRIVATE_VALUE; }');
  await mkdir(join(root, 'src/frontend/styles'), { recursive: true });
  await symlink(join(root, '.zero/private.css'), join(root, 'src/frontend/styles/theme-next.css'));
  const canonical = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true,
    exclude: ['frontend/styles/theme-next.css'] });
  expect(canonical.ok).toBe(true); expect(canonical.findings).toEqual([]);
  expect(canonical.themeFoundation).toMatchObject({ copiedStyles: 0, sourceFiles: 1 });
  expect(JSON.stringify(canonical)).not.toContain('PRIVATE_VALUE');
  await write(root, 'owned/excluded.css', 'EXCLUDED_TARGET_MUST_NOT_BE_READ');
  await symlink(join(root, 'owned/excluded.css'), join(root, 'frontend/styles/excluded-link.css'));
  // The application source declares a literal import; both the general closure
  // and special copied paths obey explicit canonical target exclusions.
  await write(root, 'app/styles.css', '@import "../frontend/styles/excluded-link.css";');
  const configured = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true,
    exclude: ['frontend/styles/theme-next.css', 'owned/excluded.css'] });
  expect(configured.ok).toBe(true); expect(configured.findings).toEqual([]);
}));

test('copied style canonical target honours explicit exclusions independently of private directory blocking', async () => fixture(async root => {
  await install(root); await write(root, 'app/page.tsx', 'export const unchanged=true;');
  await write(root, 'owned/excluded.css', 'EXCLUDED_TARGET_MUST_NOT_BE_READ');
  await mkdir(join(root, 'frontend/styles'), { recursive: true });
  await symlink(join(root, 'owned/excluded.css'), join(root, 'frontend/styles/theme-next.css'));
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true, exclude: ['owned/excluded.css'] });
  expect(report.ok).toBe(true); expect(report.findings).toEqual([]); expect(report.themeFoundation?.copiedStyles).toBe(0);
}));

test('ambient env files cannot be read through discovered, imported, or copied stylesheet aliases', async () => fixture(async root => {
  await install(root); await write(root, '.env.local', 'FAKE_SECRET=var(--zero-theme-env-marker)');
  await write(root, 'app/page.tsx', 'import "./local.css";');
  await symlink(join(root, '.env.local'), join(root, 'app/local.css'));
  await symlink(join(root, '.env.local'), join(root, 'app/env-alias.ts'));
  await mkdir(join(root, 'frontend/styles'), { recursive: true });
  await symlink(join(root, '.env.local'), join(root, 'frontend/styles/theme-next.css'));
  for (const include of [undefined, ['app/page.tsx']]) {
    const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true, include });
    expect(report.ok).toBe(true); expect(report.findings).toEqual([]);
    expect(report.themeFoundation).toMatchObject({ copiedStyles: 0, sourceFiles: 1 });
    expect(JSON.stringify(report)).not.toContain('--zero-theme-env-marker');
  }
  const legacy = await runSourceOnlyDoctor({ projectRoot: root, strict: true });
  expect(legacy.ok).toBe(true); expect(legacy.scannedFiles).toBe(1);
}));

test('source and stylesheet aliases cannot broaden canonical admission to database/data files', async () => fixture(async root => {
  await install(root); await write(root, 'owned/fake-data.db', 'FAKE_DATA=var(--zero-theme-db-marker)');
  await write(root, 'app/page.tsx', 'import "./local.css";');
  await symlink(join(root, 'owned/fake-data.db'), join(root, 'app/local.css'));
  await symlink(join(root, 'owned/fake-data.db'), join(root, 'app/data-alias.ts'));
  await mkdir(join(root, 'frontend/styles'), { recursive: true });
  await symlink(join(root, 'owned/fake-data.db'), join(root, 'frontend/styles/theme-next.css'));
  for (const include of [undefined, ['app/page.tsx']]) {
    const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, strict: true, include });
    expect(report.ok).toBe(true); expect(report.findings).toEqual([]);
    expect(report.themeFoundation).toMatchObject({ copiedStyles: 0, sourceFiles: 1 });
    expect(JSON.stringify(report)).not.toContain('--zero-theme-db-marker');
  }
  const legacy = await runSourceOnlyDoctor({ projectRoot: root, strict: true });
  expect(legacy.ok).toBe(true); expect(legacy.scannedFiles).toBe(1);
}));

test('admitted same-root CSS aliases still supply declarations for imports and customized copies', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'import "./local.css"; export const paints=["var(--zero-theme-imported)","var(--zero-theme-copied)"];');
  await write(root, 'owned/imported.css', ':root { --zero-theme-imported: plum; }');
  await write(root, 'owned/copied.css', renderThemeFoundationCss() + '\n:root { --zero-theme-copied: teal; }');
  await symlink(join(root, 'owned/imported.css'), join(root, 'app/local.css'));
  await mkdir(join(root, 'frontend/styles'), { recursive: true });
  await symlink(join(root, 'owned/copied.css'), join(root, 'frontend/styles/theme-next.css'));
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, include: ['app/page.tsx'] });
  expect(report.ok).toBe(true);
  expect(report.findings).toMatchObject([{ code: 'theme.foundation.copied_styles_modified' }]);
  expect(report.themeFoundation).toMatchObject({ copiedStyles: 1, sourceFiles: 2, reviewCounts: { unresolvedCanonicalReferences: 0 } });
}));

test('CSS imports cannot read outside admitted roots or follow excluded sources', async () => fixture(async base => {
  const root = join(base, 'app-root'), external = join(base, 'external');
  await mkdir(root); await mkdir(external); await install(root);
  await write(external, 'private.css', 'PRIVATE_CSS_MUST_NOT_APPEAR');
  await write(root, 'app/page.tsx', 'import "./local.css";');
  await write(root, 'app/local.css', '@import "./linked.css"; @import "./ignored.css";');
  await write(root, 'app/ignored.css', '.ignored {color:var(--zero-theme-not-inspected)}');
  await symlink(join(external, 'private.css'), join(root, 'app/linked.css'));
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, include: ['app/page.tsx'], exclude: ['app/ignored.css'],
    rules: { 'usage.source.outside_root': 'off' } });
  expect(report.ok).toBe(false);
  expect(report.findings).toMatchObject([{ code: 'usage.source.outside_root', path: 'app/local.css:1' }]);
  expect(JSON.stringify(report)).not.toContain('PRIVATE_CSS_MUST_NOT_APPEAR');
  expect(JSON.stringify(report)).not.toContain('--zero-theme-not-inspected');
}));

test('CSS dependencies preserve source-only blocked runtime/build/private directory exclusions', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'import "./styles.css";');
  await write(root, 'app/styles.css', '@import "../.zero/private.css"; @import "../node_modules/private/paint.css"; @import "./ignored-link.css";');
  await write(root, '.zero/private.css', '.private { color:var(--zero-theme-private-unresolved); }');
  await write(root, 'node_modules/private/paint.css', '.private { color:var(--zero-theme-private-unresolved); }');
  await symlink(join(root, '.zero/private.css'), join(root, 'app/ignored-link.css'));
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, include: ['app/page.tsx'], strict: true });
  expect(report.ok).toBe(true); expect(report.findings).toEqual([]);
  expect(report.themeFoundation?.sourceFiles).toBe(2);
  expect(JSON.stringify(report)).not.toContain('--zero-theme-private-unresolved');
}));

test('real Doctor dispatcher uses source-only theme mode without config, resources, package or environment execution', async () => fixture(async root => {
  await install(root);
  await write(root, 'app/page.tsx', 'export const paint="var(--zero-type-section-size)";');
  await write(root, 'app/styles.css', '.safe { color: var(--foreground); }');
  await write(root, 'zero.config.ts', 'await Bun.write("CONFIG_EXECUTED", "bad"); throw new Error("CONFIG_MUST_NOT_RUN");');
  await write(root, 'server/resources/private.ts', 'await Bun.write("RESOURCE_EXECUTED", "bad"); throw new Error("RESOURCE_MUST_NOT_RUN");');
  await write(root, '.env', 'THEME_AUDIT_SECRET=PRIVATE_ENV_MUST_NOT_APPEAR\n');
  const script = new URL('../cli/run.ts', import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '--no-env-file', script, 'doctor', '--source-only', '--theme-foundation', '--project-root', root, '--json', '--strict', '--usage-include', 'app'],
    { cwd: root, env: { PATH: Bun.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({ mode: 'source-only', ok: true, themeFoundation: { bundledStyles: 'verified', readOnly: true } });
  expect(stdout + stderr).not.toMatch(/PRIVATE_ENV_MUST_NOT_APPEAR|CONFIG_MUST_NOT_RUN|RESOURCE_MUST_NOT_RUN|PACKAGE_MUST_NOT_EXECUTE/u);
  expect(await Bun.file(join(root, 'CONFIG_EXECUTED')).exists()).toBe(false);
  expect(await Bun.file(join(root, 'RESOURCE_EXECUTED')).exists()).toBe(false);
}));

test('theme CLI flag cannot accidentally enter configuration-loading mode', async () => fixture(async root => {
  await write(root, 'zero.config.ts', 'await Bun.write("CONFIG_EXECUTED", "bad"); throw new Error("CONFIG_MUST_NOT_RUN");');
  const script = new URL('./run.ts', import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '--no-env-file', script, '--theme-foundation', '--project-root', root, '--json'],
    { cwd: root, env: { PATH: Bun.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(child.stdout).text();
  expect(await child.exited).toBe(1);
  expect(JSON.parse(stdout).findings[0].message).toContain('--theme-foundation requires --source-only');
  expect(await Bun.file(join(root, 'CONFIG_EXECUTED')).exists()).toBe(false);
}));
