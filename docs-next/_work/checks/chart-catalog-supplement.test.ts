/** Bounded chart discovery regression: syntax/file reads only, never a TS program or application import. */
import { expect, test } from 'bun:test';
import * as ts from 'typescript';
import { extractMarkdownLinks, parseDocumentationPage } from './markdown';

const repository = new URL('../../../', import.meta.url);
const catalogDirectory = new URL('docs-next/_work/audits/catalogs/', repository);
const bridge = 'src/frontend/client/chart-query.ts';
const projection = 'src/frontend/client/chart-query-projection.ts';
const visualization = 'src/frontend/exports/data/visualization.ts';
const rendererHeading = 'Chart Renderer and Part Working Source';
const bridgeHeading = 'Chart Query Working Source';
const helperHeading = 'Chart Query Helpers Working Source';
const sharedRoutes = ['@zero/framework', '@zero/framework/react', '@zero/framework/components/charts'];
const bridgeRoutes = ['@zero/framework', '@zero/framework/react', '@zero/framework/charts/react'];
const helperNames = ['projectChartQueryRows', 'ChartQueryError', 'CHART_QUERY_DEFAULT_MAX_ROWS', 'CHART_QUERY_MAX_ROWS'];
const groups = [
  { file: 'src/components/charts/index.ts', count: 18, routes: sharedRoutes,
    omitted: ['SANKEY_MOTION_DEFAULTS', 'RACE_BAR_DEFAULTS', 'RACE_BAR_MOTION_DEFAULTS', 'FUNNEL_MOTION_DEFAULTS'] },
  { file: 'src/components/charts/arc/index.ts', count: 12, routes: ['@zero/framework/components/charts/arc'],
    omitted: ['ARC_CHART_MOTION_DEFAULTS'] },
  { file: 'src/components/charts/native/index.ts', count: 23, routes: [...sharedRoutes, '@zero/framework/components/charts/native'],
    omitted: ['NATIVE_CHART_MOTION', 'nativeColor', 'formatNativeChartNumber'] },
];

async function source(path: string) {
  return ts.createSourceFile(path, await Bun.file(new URL(path, repository)).text(), ts.ScriptTarget.Latest, false);
}

function namedValues(file: ts.SourceFile) {
  return file.statements.flatMap(statement => {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || !statement.exportClause
      || !ts.isNamedExports(statement.exportClause) || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const module = statement.moduleSpecifier.text;
    return statement.exportClause.elements.filter(element => !element.isTypeOnly)
      .map(element => ({ name: element.name.text, original: element.propertyName?.text ?? element.name.text, module }));
  });
}

function starValues(file: ts.SourceFile) {
  return file.statements.flatMap(statement => ts.isExportDeclaration(statement) && !statement.isTypeOnly
    && !statement.exportClause && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
    ? [statement.moduleSpecifier.text] : []);
}

function declarations(file: ts.SourceFile) {
  return new Set(file.statements.flatMap(statement => {
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) return [statement.name.text];
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations
      .flatMap(declaration => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
    return [];
  }));
}

async function moduleOwner(path: string, module: string) {
  const prefix = new URL(module, new URL(path, repository)).href;
  for (const suffix of ['.ts', '.tsx', '/index.ts']) {
    const target = new URL(prefix + suffix);
    if (await Bun.file(target).exists()) return target;
  }
  throw new Error(`Unresolved local re-export from ${path}: ${module}`);
}

async function supplement(file: string, heading: string) {
  const path = new URL(file, catalogDirectory);
  const text = await Bun.file(path).text();
  const marker = `## ${heading}\n`;
  expect(text.split(marker)).toHaveLength(2);
  const section = text.split(marker)[1]!.split(/^## /m)[0]!;
  const rows = section.split('\n').flatMap(row => {
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
    const symbol = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    if (!symbol) return [];
    const routes = [...cells[1]!.matchAll(/`(@zero\/framework[^`]*)`/g)].map(match => match[1]!);
    const links = extractMarkdownLinks(row);
    const owner = links.find(link => /\.tsx?$/u.test(link));
    const guide = links.findLast(link => /\.md(?:#.*)?$/u.test(link));
    if (!owner || !guide) throw new Error(`Missing source or manual for ${symbol}`);
    return [{ symbol, routes, owner: new URL(owner, path), guide: new URL(guide, path) }];
  });
  return { text, section, rows };
}

async function checkGuide(target: URL) {
  const page = parseDocumentationPage(await Bun.file(target).text());
  expect(target.pathname).toContain('/docs-next/frontend/charts/');
  if (target.hash) expect(page.anchors.has(target.hash.slice(1))).toBe(true);
}

for (const group of groups) {
  test(`${group.file}: exact renderer and part supplement, routes and declaration owners`, async () => {
    const entries = namedValues(await source(group.file)).filter(entry => !group.omitted.includes(entry.name));
    expect(entries).toHaveLength(group.count);
    const { rows } = await supplement('frontend-components.md', rendererHeading);
    expect(rows).toHaveLength(53);
    expect(new Set(rows.map(row => row.symbol)).size).toBe(53);
    const scoped = rows.filter(row => entries.some(entry => entry.name === row.symbol));
    expect(scoped.map(row => row.symbol).sort()).toEqual(entries.map(entry => entry.name).sort());
    for (const entry of entries) {
      const row = scoped.find(record => record.symbol === entry.name)!;
      expect([...row.routes].sort()).toEqual([...group.routes].sort());
      const owner = await moduleOwner(group.file, entry.module);
      expect(row.owner.pathname).toBe(owner.pathname);
      expect(declarations(await source(owner.pathname.slice(repository.pathname.length))).has(entry.original)).toBe(true);
      await checkGuide(row.guide);
    }
  });
}

test('one public chart hook and four bridge helpers retain their exact owners and routes', async () => {
  const hook = await supplement('frontend-hooks.md', bridgeHeading);
  const helpers = await supplement('frontend-support.md', helperHeading);
  expect(hook.rows.map(row => row.symbol)).toEqual(['useChartQuery']);
  expect(helpers.rows.map(row => row.symbol).sort()).toEqual([...helperNames].sort());
  for (const row of [...hook.rows, ...helpers.rows]) {
    expect([...row.routes].sort()).toEqual([...bridgeRoutes].sort());
    const owner = row.symbol === 'useChartQuery' ? bridge : projection;
    expect(row.owner.pathname).toBe(new URL(owner, repository).pathname);
    expect(declarations(await source(owner)).has(row.symbol)).toBe(true);
    await checkGuide(row.guide);
  }
  expect(helpers.section).toContain('Exhaustive reconciliation');
  expect(helpers.section).toContain('still planned');
});

test('declared public routes and bounded root barrel edges actually reach the catalogued values', async () => {
  const metadata = await Bun.file(new URL('package.json', repository)).json();
  const targets = {
    '.': 'src/frontend/index.ts', './react': 'src/frontend/index.ts',
    './components/charts': groups[0]!.file, './components/charts/arc': groups[1]!.file,
    './components/charts/native': groups[2]!.file, './charts/react': bridge,
  };
  for (const [route, target] of Object.entries(targets)) {
    expect(metadata.exports[route]).toEqual({ types: `./${target}`, import: `./${target}` });
  }
  expect(starValues(await source('src/frontend/index.ts'))).toContain('./exports/data/visualization');
  expect(starValues(await source(visualization))).toContain('../../../components/charts');
  expect(starValues(await source(groups[0]!.file))).toEqual(['./native']);
  const facadeBridge = namedValues(await source(visualization)).filter(entry => entry.module === '../../client/chart-query');
  expect(facadeBridge.map(entry => entry.name).sort()).toEqual(['useChartQuery', ...helperNames].sort());
  expect(namedValues(await source(bridge)).map(entry => entry.name).sort()).toEqual([...helperNames].sort());
  for (const path of ['src/hooks/index.ts', 'src/frontend/client/hooks.ts']) {
    expect(namedValues(await source(path)).some(entry => entry.name === 'useChartQuery')).toBe(false);
    expect(starValues(await source(path)).some(module => module.includes('chart-query'))).toBe(false);
  }
});

test('supplements leave historical clean metadata, counts and pinned export JSON intact', async () => {
  for (const [file, count] of [['frontend-components.md', '414'], ['frontend-hooks.md', '131'], ['frontend-support.md', '94']]) {
    const text = await Bun.file(new URL(file!, catalogDirectory)).text();
    const metadata = parseDocumentationPage(text).metadata;
    expect(metadata.applies_to).toEqual(['2.1.1']);
    expect(metadata.reviewed_against).toMatchObject({ version: '2.1.1', commit: 'a3a5f726768dac890f241a3899c0a1acb66265d9', snapshot: 'clean' });
    expect(text).toContain(`**${count} `);
    expect(text).toContain('335b27372b0b8ef57a1e92cf93cec378923fe50b');
  }
  const pinned = await Bun.file(new URL('package-exports.json', catalogDirectory)).text();
  expect(new Bun.CryptoHasher('sha256').update(pinned).digest('hex'))
    .toBe('b5b550bf74fe1975fa441661c76c88f83d018ff4869d40d4cef7d233cfd9234b');
  const manifest = JSON.parse(pinned);
  expect(manifest.version).toBe('2.1.1');
  expect(manifest.entries).toHaveLength(108);
});
