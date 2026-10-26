/** Private-import synchronization inventories executable/type syntax, never quoted fixture payloads. */
import { expect, test } from 'bun:test';
import * as ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { collectPrivateImportSpecifiers, collectSourceImportSpecifiers, privateImportMapsMatch } from './private-import-specifiers';

test('static imports and every literal re-export spelling remain in the inventory', () => {
  const source = `
    import '#zero/side-effect';
    import Default from '#zero/default';
    import { Named as Alias } from '#zero/named';
    import * as Namespace from '#zero/namespace';
    import type { Type } from '#zero/type';
    export { Thing } from '#zero/reexport';
    export type { Shape } from '#zero/reexport-type';
    export * from '#zero/star';
    export * as OtherNamespace from '#zero/star-namespace';
    import ThirdParty from 'third-party';
    import Relative from './relative';
  `;
  expect(collectPrivateImportSpecifiers('module.ts', source)).toEqual([
    '#zero/default', '#zero/named', '#zero/namespace', '#zero/reexport', '#zero/reexport-type',
    '#zero/side-effect', '#zero/star', '#zero/star-namespace', '#zero/type',
  ]);
});

test('import types, import-equals and literal dynamic import/require remain discoverable inside nested syntax', () => {
  const source = `
    import Adapter = require('#zero/import-equals');
    type Item = import('#zero/import-type').Item;
    type Runtime = typeof import('#zero/typeof-import');
    async function load() {
      const lazy = await import('#zero/dynamic', { with: { type: 'json' } });
      const required = require('#zero/required');
      const template = import(\`#zero/template-literal\`);
    }
  `;
  expect(collectPrivateImportSpecifiers('module.ts', source)).toEqual([
    '#zero/dynamic', '#zero/import-equals', '#zero/import-type', '#zero/required',
    '#zero/template-literal', '#zero/typeof-import',
  ]);
});

test('quoted fixture imports, plain private strings, comments and JSX attributes are not module references', () => {
  const source = `
    const source = "import X from '#zero/own';";
    const template = \`export * from '#zero/hidden'; import('#zero/fake');\`;
    const options = { ownImports: { '#zero/*': './src/*.ts' }, path: '#zero/plain' };
    // import Anything from '#zero/comment';
    /* require('#zero/block-comment'); */
    const element = <div data-target="#zero/attribute">#zero/text</div>;
    import { Real } from '#zero/real';
  `;
  expect(collectPrivateImportSpecifiers('fixture.tsx', source)).toEqual(['#zero/real']);
});

test('computed and non-module call arguments are never guessed as literal imports', () => {
  const source = `
    const target = '#zero/variable';
    import(target); require(target);
    import('#zero/concatenated' + name);
    require(\`#zero/\${name}\`);
    object.require('#zero/object-method');
    consume('#zero/caller-string');
  `;
  expect(collectPrivateImportSpecifiers('module.ts', source)).toEqual([]);
});

test('the source-wide build guard rejects actual app aliases but does not mistake Doctor fixture text for a dependency', async () => {
  expect(collectSourceImportSpecifiers('module.ts', `import Real from '@/components/actual'; const text = "import Fake from '@/components/example';"; const lazy = import('@/lazy');`))
    .toEqual(['@/components/actual', '@/lazy']);
  const fixture = await Bun.file(new URL('../src/doctor/source-only-upgrade-checks.test.ts', import.meta.url)).text();
  expect(collectSourceImportSpecifiers('fixture.test.ts', fixture).filter(value => value.startsWith('@/'))).toEqual([]);
});

test('escaped and repeated real literal targets are decoded, deduplicated and deterministic', () => {
  const source = "import { A } from '#zero/lib/utils'; export { A } from '#zero/\\u006cib/utils'; require('#zero/lib/utils');";
  expect(collectPrivateImportSpecifiers('module.ts', source)).toEqual(['#zero/lib/utils']);
});

test('the actual Doctor fixture source does not introduce its embedded private aliases into the package map', async () => {
  const source = await Bun.file(new URL('../src/doctor/source-only-modal-checks.test.ts', import.meta.url)).text();
  expect(source).toContain("'#zero/*'"); expect(source).toContain("'#zero/own'");
  expect(collectPrivateImportSpecifiers('source-only-modal-checks.test.ts', source)).toEqual([]);
});

test('only the named existing compatibility paths are retained explicitly', async () => {
  const source = await Bun.file(new URL('./sync-private-imports.ts', import.meta.url)).text();
  const file = ts.createSourceFile('sync-private-imports.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const declarations = file.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
  const retained = declarations.find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'RETAINED_COMPATIBILITY_SPECIFIERS');
  const initializer = retained?.initializer;
  const array = initializer && ts.isAsExpression(initializer) ? initializer.expression : initializer;
  expect(array && ts.isArrayLiteralExpression(array)).toBe(true);
  if (!array || !ts.isArrayLiteralExpression(array)) throw new Error('Expected the explicit compatibility list.');
  expect(array.elements.map(element => ts.isStringLiteral(element) ? element.text : null))
    .toEqual([
      '#zero/components/animate-ui/primitives/radix/popover', '#zero/components/ui/calendar',
      '#zero/components/ui/date-picker-value', '#zero/components/ui/time-picker-value',
    ]);
});

test('mapping equality ignores key order only, while wrong targets and extra/missing/replaced aliases remain stale', () => {
  const declared = { '#zero/b': './src/b.ts', '#zero/a': './src/a.ts' };
  const expected = { '#zero/a': './src/a.ts', '#zero/b': './src/b.ts' };
  const before = JSON.stringify(declared);
  expect(privateImportMapsMatch(declared, expected)).toBe(true);
  expect(privateImportMapsMatch(declared, { ...expected, '#zero/a': './src/wrong.ts' })).toBe(false);
  expect(privateImportMapsMatch(declared, { '#zero/a': './src/a.ts' })).toBe(false);
  expect(privateImportMapsMatch(declared, { ...expected, '#zero/extra': './src/extra.ts' })).toBe(false);
  expect(privateImportMapsMatch({ '#zero/a': './src/a.ts', '#zero/replaced': './src/b.ts' }, expected)).toBe(false);
  expect(privateImportMapsMatch(Object.create(expected) as Record<string, string>, expected)).toBe(false);
  expect(JSON.stringify(declared)).toBe(before);
});

test('the real private-import check passes without changing the declared package map', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const packagePath = new URL('../package.json', import.meta.url);
  const before = new Uint8Array(await Bun.file(packagePath).arrayBuffer());
  const child = Bun.spawn({ cmd: [process.execPath, '--no-env-file', fileURLToPath(new URL('./sync-private-imports.ts', import.meta.url)), '--check'],
    cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(`Read-only private-import check failed: ${stdout}\n${stderr}`);
  expect(exitCode).toBe(0);
  const after = new Uint8Array(await Bun.file(packagePath).arrayBuffer());
  expect(after).toEqual(before);
  const metadata = JSON.parse(new TextDecoder().decode(after)) as { imports: Record<string, string> };
  expect(metadata.imports['#zero/components/ui/time-picker-value']).toBe('./src/components/ui/time-picker-value.ts');
  expect(metadata.imports['#zero/components/ui/calendar']).toBe('./src/components/ui/calendar.tsx');
  expect(metadata.imports['#zero/components/ui/date-picker-value']).toBe('./src/components/ui/date-picker-value.ts');
  expect(metadata.imports['#zero/components/animate-ui/primitives/radix/popover']).toBe('./src/components/animate-ui/primitives/radix/popover.tsx');
}, 40_000);
