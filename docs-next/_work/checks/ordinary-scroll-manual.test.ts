/** Bounded public/manual/catalog routing; source syntax only, no compiler program or app import. */
import { expect, test } from 'bun:test';
import ts from 'typescript';
import { parseDocumentationPage } from './markdown';

const repo = new URL('../../../', import.meta.url);
const docs = new URL('docs-next/', repo);
const read = (path: string) => Bun.file(new URL(path, repo)).text();

test('the additive menu part and types have exact public routes and one supported manual home', async () => {
  const manifest = await Bun.file(new URL('package.json', repo)).json();
  expect(manifest.exports['./components/context-menu']).toEqual({
    types: './src/components/context-menu/index.ts', import: './src/components/context-menu/index.ts',
  });
  const text = await read('src/frontend/exports/controls/menu-scroll.ts');
  const syntax = ts.createSourceFile('menu-scroll.ts', text, ts.ScriptTarget.Latest, false);
  const names = syntax.statements.flatMap(statement => ts.isExportDeclaration(statement)
    && statement.exportClause && ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements.map(item => ({ name: item.name.text, type: statement.isTypeOnly || item.isTypeOnly })) : []);
  expect(names).toEqual([
    { name: 'ContextMenuViewport', type: false },
    { name: 'ContextMenuViewportProps', type: true },
    { name: 'ContextMenuScrollOptions', type: true },
  ]);
  const root = await read('src/frontend/index.ts');
  expect(root).toContain("export * from './exports/controls/menu-scroll'");
  const catalog = await read('docs-next/_work/audits/catalogs/frontend-components.md');
  const manual = parseDocumentationPage(await Bun.file(new URL('frontend/components/overlays/context-menu.md', docs)).text());
  expect(manual.metadata.reviewed_against).toMatchObject({ version: '2.6.0', snapshot: 'dirty' });
  expect(manual.anchors.has('scroll-treatment-and-custom-content')).toBe(true);
  for (const { name } of names) {
    const rows = catalog.split('\n').filter(row => row.startsWith(`| \`${name}\` |`));
    expect(rows).toHaveLength(1);
    for (const route of ['@zero/framework', '@zero/framework/react', '@zero/framework/components/context-menu']) {
      expect(rows[0]).toContain(`\`${route}\``);
    }
    expect(rows[0]).toContain('frontend/components/overlays/context-menu.md#scroll-treatment-and-custom-content');
  }
});

test('manual examples qualify the new facade while retaining native engine and distinct year ownership', async () => {
  const menu = await read('docs-next/frontend/components/overlays/context-menu.md');
  const date = await read('docs-next/frontend/components/primitives/dates-and-time.md');
  const compiler = await read('docs-next/_work/checks/frontend-ui-examples.test.ts');
  expect(compiler).toContain("'frontend/components/overlays/context-menu.md': [0, 1, 2, 3]");
  expect(compiler).toContain("'frontend/components/primitives/dates-and-time.md': [0, 1]");
  expect([...menu.matchAll(/^```tsx\n[\s\S]*?^```/gm)]).toHaveLength(4);
  expect(menu).toContain('<ContextMenuViewport className="p-1" orientation="both" fadeEdges scrollbars="hover">');
  expect(menu).toContain('scrollTreatment="native"');
  expect(menu).toContain('The `native` rollback branch keeps the original manual container/layer contract');
  expect(date).toContain('scrollTreatment="arc"');
  expect(date).toContain('scrollTreatment="native"');
  expect(date).toContain('Switching to years disables that outer treatment');
  expect(await read('src/components/ui/date-picker.tsx')).toContain('date-picker-scroll');
  expect(await read('src/components/controls/date-time/index.ts')).toContain("from './date-picker-scroll'");
  const publicProps = await read('src/components/context-menu/context-menu.props.ts');
  for (const name of ['scrollTreatment', 'viewportRef', 'viewportClassName', 'viewportStyle', 'orientation', 'fadeEdges', 'scrollbars']) {
    expect(publicProps).toContain(`${name}?:`);
    expect(menu).toContain(`\`${name}\``);
  }
});
