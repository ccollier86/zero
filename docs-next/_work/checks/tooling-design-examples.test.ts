/** Compile actual complete Doctor/design examples in memory; never run app config. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

const pages = [
  'cli/doctor/config-loading.md', 'cli/doctor/configuration-checks.md',
  'cli/doctor/source-audit.md', 'cli/doctor/database-automations.md',
  'frontend/design-system/tokens.md', 'frontend/design-system/lanes.md',
  'frontend/design-system/themes.md', 'frontend/design-system/icons.md',
  'frontend/design-system/icon-registry.md', 'frontend/design-system/icon-animation.md',
  'frontend/design-system/external-surfaces.md',
  'frontend/components/overlays/dropdown-menu.md', 'frontend/components/overlays/popover.md',
  'frontend/components/overlays/tooltip.md', 'frontend/components/overlays/collapsible.md',
  'frontend/components/overlays/sidebar.md', 'frontend/components/overlays/sidebar-state.md',
  'frontend/components/overlays/sidebar-menu.md', 'frontend/components/overlays/radial-menu.md',
];

test('complete Doctor and design-system Markdown examples compile against public source facades', async () => {
  const root = new URL('../../', import.meta.url), repo = new URL('../', root).pathname;
  const fixtures = new Map<string, string>();
  for (const page of pages) {
    const source = await Bun.file(new URL(page, root)).text();
    const examples = [...source.matchAll(/^```tsx?\n([\s\S]*?)^```/gm)];
    expect(examples.length, page).toBe(1);
    fixtures.set(new URL(page.replace('.md', '.example.tsx'), root).pathname, examples[0]![1]!);
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: {
      '@zero/framework/server': [`${repo}src/frontend/server.ts`],
      '@zero/framework/react': [`${repo}src/frontend/index.ts`],
      '@zero/framework/doctor': [`${repo}src/doctor/index.ts`],
      '@zero/framework/icons': [`${repo}src/frontend/icons.ts`],
      '@zero/framework/components/tooltip': [`${repo}src/components/tooltip/index.ts`],
    },
  };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => fixtures.has(file)
    ? ts.createSourceFile(file, fixtures.get(file)!, version, true, ts.ScriptKind.TSX)
    : read(file, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    return `${diagnostic.file?.fileName.split('/').at(-1) ?? 'compiler'}${line ? `:${line}` : ''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(diagnostics).toEqual([]);
}, 30_000);
