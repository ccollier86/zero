/** Static upgrade assets qualify missing files, resolver uncertainty and read boundaries without executing applications. */
import { expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { collectSourceOnlyCssImports, inspectSourceOnlyUpgradeAssets } from './source-only-upgrade-assets';
import type { SourceOnlyFile } from './source-only-types';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/upgrade-assets-');
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function write(root: string, path: string, source: string) {
  const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, source); return target;
}
async function entry(root: string, source: string, path = 'app/entry.tsx'): Promise<SourceOnlyFile[]> {
  await write(root, path, source); return [{ path, source }];
}
const missing = (result: Awaited<ReturnType<typeof inspectSourceOnlyUpgradeAssets>>) => result.findings.filter(finding => finding.code === 'upgrade.assets.missing');
function watchReads(reads: string[]) {
  const read = Bun.file;
  return spyOn(Bun, 'file').mockImplementation((path, options) => {
    reads.push(String(path));
    if (typeof path === 'string' || path instanceof URL) return read(path, options);
    if (typeof path === 'number') return read(path, options);
    return read(path, options);
  });
}

test('literal missing CSS and helper files are required findings with source locations, not source dumps', async () => fixture(async root => {
  const files = await entry(root, '/* PRIVATE_SOURCE_TEXT_MUST_NOT_ESCAPE */\nimport "./missing.css";\nimport { motion } from "./missing-helper.ts";');
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(result.checkedAssets).toBe(2); expect(result.reviewAssets).toBe(0);
  expect(result.findings).toMatchObject([
    { code: 'upgrade.assets.missing', category: 'required', severity: 'error', path: 'app/entry.tsx:2', line: 2 },
    { code: 'upgrade.assets.missing', category: 'required', severity: 'error', path: 'app/entry.tsx:3', line: 3 },
  ]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE_TEXT_MUST_NOT_ESCAPE');
  expect(await Bun.file(join(root, 'app/entry.tsx')).text()).toBe(files[0]!.source);
}));

test('supported JS/JSX/MJS/CJS source equivalents and present literal imports establish availability without an app resolver', async () => fixture(async root => {
  const files = await entry(root, 'import "./motion.css"; import { x } from "./helper.js"; export { y } from "./util.jsx";\n' +
    'import type { z } from "./source.mjs"; import("./loader.cjs"); type A=import("./module.ts").A;');
  await write(root, 'app/motion.css', '@import "./colors.css";'); await write(root, 'app/colors.css', ':root { --owned: plum; }');
  await write(root, 'app/helper.tsx', 'import "./tokens.css"; export const x=1;'); await write(root, 'app/tokens.css', '.safe {}');
  await write(root, 'app/util.tsx', 'export const y=1;'); await write(root, 'app/source.mts', 'export type z=number;');
  await write(root, 'app/loader.cts', 'export const loaded=true;'); await write(root, 'app/module.ts', 'export type A=number;');
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(result.findings).toEqual([]); expect(result.checkedAssets).toBe(8); expect(result.reviewAssets).toBe(0);
}));

test('ordinary packages and remote CSS are not local assets, while aliases/query/extensionless/custom require resolution stay manual', async () => fixture(async root => {
  const files = await entry(root, 'import "@zero/framework/react"; import "react"; import "https://example.invalid/app.css";\n' +
    'import "@/scroller.ts"; import "./missing.css?inline"; import "./helper"; import "virtual:surface"; require("./custom.ts");');
  await write(root, 'app/helper.ts', 'export const present=true;'); await write(root, 'app/custom.ts', 'export const custom=true;');
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(result.checkedAssets).toBe(0); expect(result.reviewAssets).toBe(5); expect(missing(result)).toEqual([]);
  expect(result.findings.every(finding => finding.code === 'upgrade.assets.resolution_review' && finding.category === 'manual-review')).toBe(true);
}));

test('relative targets outside a replaced scan fence are not probed or guessed missing; explicitly admitted roots enable definite checks', async () => fixture(async directory => {
  const root = join(directory, 'project'); await mkdir(root);
  const foreign = join(directory, 'foreign'); await mkdir(foreign);
  const files = await entry(root, 'import "../../foreign/helper.ts"; import "../../foreign/missing.css";');
  await write(foreign, 'helper.ts', 'throw new Error("FOREIGN_SOURCE_MUST_NOT_EXECUTE");');
  const reads: string[] = [], spy = watchReads(reads);
  try {
    const closed = await inspectSourceOnlyUpgradeAssets(root, files, { include: ['app'] });
    expect(closed.checkedAssets).toBe(0); expect(closed.reviewAssets).toBe(2); expect(missing(closed)).toEqual([]); expect(reads).toEqual([]);
    const admitted = await inspectSourceOnlyUpgradeAssets(root, files, { include: ['app', foreign] });
    expect(admitted.checkedAssets).toBe(2); expect(admitted.reviewAssets).toBe(0); expect(missing(admitted)).toHaveLength(1);
    expect(reads).toEqual([join(foreign, 'helper.ts')]); expect(JSON.stringify(admitted)).not.toContain('FOREIGN_SOURCE_MUST_NOT_EXECUTE');
  } finally { spy.mockRestore(); }
}));

test('an exact admitted source file does not authorize reading its siblings or parent', async () => fixture(async root => {
  const files = await entry(root, 'import "./helper.ts"; import "../styles.css";');
  await write(root, 'app/helper.ts', 'export const present=true;'); await write(root, 'styles.css', '.outside{}');
  const reads: string[] = [], spy = watchReads(reads);
  try {
    const result = await inspectSourceOnlyUpgradeAssets(root, files, { include: ['app/entry.tsx'] });
    expect(result.checkedAssets).toBe(0); expect(result.reviewAssets).toBe(2); expect(missing(result)).toEqual([]); expect(reads).toEqual([]);
  } finally { spy.mockRestore(); }
}));

test('lexical exclusions, ambient env, private roots and excluded canonical aliases are skipped without leaking names or contents', async () => fixture(async root => {
  const files = await entry(root, 'import "./excluded.css"; import "./vendor/missing.ts"; import "./.env.css?raw";\n' +
    'import "./private.css"; import "./excluded-alias.css"; import "./env-alias.css";');
  await write(root, '.zero/private.css', 'PRIVATE_STYLES_MUST_NOT_BE_READ'); await write(root, '.env.local', 'SECRET_MUST_NOT_BE_READ');
  await write(root, 'app/custom.css', 'EXCLUDED_STYLES_MUST_NOT_BE_READ');
  await symlink(join(root, '.zero/private.css'), join(root, 'app/private.css'));
  await symlink(join(root, 'app/custom.css'), join(root, 'app/excluded-alias.css'));
  await symlink(join(root, '.env.local'), join(root, 'app/env-alias.css'));
  const reads: string[] = [], spy = watchReads(reads);
  try {
    const result = await inspectSourceOnlyUpgradeAssets(root, files, { exclude: ['app/excluded.css', 'app/custom.css'] });
    expect(result).toEqual({ findings: [], checkedAssets: 0, reviewAssets: 0 }); expect(reads).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|SECRET_|EXCLUDED_|env-alias/u);
  } finally { spy.mockRestore(); }
}));

test('out-of-root symlink leaves and ancestors remain manual without reading target contents or proving external absence', async () => fixture(async root => {
  const files = await entry(root, 'import "./outside.css"; import "./escaped/missing.css";');
  await write(root, 'foreign/real.css', 'OUTSIDE_STYLES_MUST_NOT_BE_READ');
  await symlink(join(root, 'foreign/real.css'), join(root, 'app/outside.css'));
  await symlink(join(root, 'foreign'), join(root, 'app/escaped'));
  const reads: string[] = [], spy = watchReads(reads);
  try {
    const result = await inspectSourceOnlyUpgradeAssets(root, files, { include: ['app'] });
    expect(result.checkedAssets).toBe(0); expect(result.reviewAssets).toBe(2); expect(missing(result)).toEqual([]);
    expect(reads).toEqual([]); expect(JSON.stringify(result)).not.toContain('OUTSIDE_STYLES_MUST_NOT_BE_READ');
  } finally { spy.mockRestore(); }
}));

test('same-fence aliases and a cyclic CSS graph are inspected once, never executed or rewritten', async () => fixture(async root => {
  const files = await entry(root, 'import "./alias.css"; import "./helper.js";');
  const css = '@import "./colors.css"; /* caller customization stays */'; await write(root, 'app/owned.css', css);
  await write(root, 'app/colors.css', '@import "./owned.css";'); await symlink(join(root, 'app/owned.css'), join(root, 'app/alias.css'));
  await write(root, 'app/helper.ts', 'throw new Error("HELPER_CODE_MUST_NOT_EXECUTE");');
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(result.findings).toEqual([]); expect(result.checkedAssets).toBe(4); expect(result.reviewAssets).toBe(0);
  expect(await Bun.file(join(root, 'app/owned.css')).text()).toBe(css);
}));

test('CSS imports decode literal escapes and continuations while ignoring fake comments, strings and nested custom-property tokens', async () => fixture(async root => {
  const css = '/* @import "./comment-missing.css"; */\n' + '.example { content:\'@import "./string-missing.css";\'; --data: @import "./property-missing.css"; }\n' +
    '@import/**/url(/**/ "./with\\20 space.css") layer(paint);\n' + '@import "./line\\\r\ncontinuation.css";\n' + '@import url(./unquoted.css);';
  const files = await entry(root, css, 'app/main.css');
  await write(root, 'app/with space.css', '.owned{}'); await write(root, 'app/linecontinuation.css', '.continued{}');
  await write(root, 'app/unquoted.css', '@import "./actual-missing.css";');
  const imports = collectSourceOnlyCssImports(css);
  expect(imports.map(reference => reference.target)).toEqual(['./with space.css', './linecontinuation.css', './unquoted.css']);
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(result.checkedAssets).toBe(4); expect(result.reviewAssets).toBe(0);
  expect(result.findings).toMatchObject([{ code: 'upgrade.assets.missing', path: 'app/unquoted.css:1' }]);
}));

test('malformed, unsupported and require-based resolver evidence stays manual rather than becoming a missing-file error', async () => fixture(async root => {
  const files = await entry(root, 'import "./unsupported.scss"; require("./missing.ts"); import "./bad\\u0000.css";\nimport "./unterminated.css');
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(result.checkedAssets).toBe(0); expect(result.reviewAssets).toBe(4); expect(missing(result)).toEqual([]);
}));

test('literal backslash separators require resolver review instead of being reinterpreted as native paths', async () => fixture(async root => {
  const files = await entry(root, 'import ".\\\\missing.css"; import "./nested\\\\missing.ts";');
  const reads: string[] = [], spy = watchReads(reads);
  try {
    const result = await inspectSourceOnlyUpgradeAssets(root, files);
    expect(result.checkedAssets).toBe(0); expect(result.reviewAssets).toBe(2);
    expect(missing(result)).toEqual([]); expect(reads).toEqual([]);
  } finally { spy.mockRestore(); }
}));

test('deep static parser exhaustion reports incomplete coverage instead of crashing or proving absent assets', async () => fixture(async root => {
  const files = await entry(root, '('.repeat(4_000) + '1' + ')'.repeat(4_000) + '; import "./missing.css";');
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(result.checkedAssets).toBe(0); expect(missing(result)).toEqual([]);
  expect(result.findings).toMatchObject([{ code: 'upgrade.assets.scan_limit', category: 'manual-review', path: 'app/entry.tsx:1' }]);
}));

test('source/reference limits and large dependency metadata produce incomplete-coverage findings without large reads', async () => fixture(async root => {
  const files = await entry(root, Array.from({ length: 513 }, (_, index) => `import "./missing-${index}.css";`).join('\n'));
  const limited = await inspectSourceOnlyUpgradeAssets(root, files);
  expect(limited.checkedAssets).toBe(512); expect(missing(limited)).toHaveLength(512);
  expect(limited.findings.filter(finding => finding.code === 'upgrade.assets.scan_limit')).toHaveLength(1);
  const large = await entry(root, 'import "./large.css";'); await write(root, 'app/large.css', ' '.repeat(2_000_001));
  const reads: string[] = [], spy = watchReads(reads);
  try {
    const result = await inspectSourceOnlyUpgradeAssets(root, large);
    expect(result.checkedAssets).toBe(1); expect(missing(result)).toEqual([]);
    expect(result.findings).toMatchObject([{ code: 'upgrade.assets.scan_limit', category: 'manual-review' }]); expect(reads).toEqual([]);
  } finally { spy.mockRestore(); }
}));

test('application config and env are not loaded and no global marker can be executed through inspected helpers', async () => fixture(async root => {
  const files = await entry(root, 'import "../zero.config.ts"; import "./helper.ts"; import "../.env";');
  await write(root, 'zero.config.ts', 'globalThis.__upgradeAssetsBooted=true; throw new Error("CONFIG_MUST_NOT_LOAD");');
  await write(root, '.env', 'UPGRADE_ASSET_SECRET=do-not-read');
  await write(root, 'app/helper.ts', 'globalThis.__upgradeAssetsBooted=true; throw new Error("HELPER_MUST_NOT_LOAD");');
  const result = await inspectSourceOnlyUpgradeAssets(root, files);
  expect((globalThis as Record<string, unknown>).__upgradeAssetsBooted).toBeUndefined();
  expect(result.checkedAssets).toBe(1); expect(result.reviewAssets).toBe(1); expect(missing(result)).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/CONFIG_MUST|HELPER_MUST|UPGRADE_ASSET_SECRET|do-not-read/u);
}));
