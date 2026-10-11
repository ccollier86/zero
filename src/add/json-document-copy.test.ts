/** Copied editor closure and public route checks; never replaces an application's custom source. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { addZeroSource } from './copy';
import { SourceOnlyUpgradeExports } from '../doctor/source-only-upgrade-exports';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const root = new URL('../../', import.meta.url).pathname;
test('JSON source-copy retains both editors, new helpers/CSS and shared controls without server/test assets', async () => {
  const result = await addZeroSource({ targetDir: join(scratch, 'json-document-copy-preview'), items: ['components/json-editor'], dryRun: true });
  for (const name of ['index.ts', 'json-editor.tsx', 'json-editor.types.ts', 'json-editor-theme.tsx', 'json-editor-widgets.tsx',
    'json-document-editor.tsx', 'json-document-editor.css', 'json-document.types.ts', 'json-document-session.ts',
    'json-document-model.ts', 'json-document-source.ts', 'json-document-tree-model.ts', 'json-document-parts.tsx', 'use-json-document-motion.ts',
    'document.types.ts', 'document-source.ts', 'document-source-contract.ts', 'document-source-ranges.ts', 'document-number-precision.ts', 'document-yaml-codec.ts', 'document-toml-codec.ts', 'document-env-codec.ts', 'document-source-input.ts', 'document-format-control.tsx', 'use-document-escape-boundary.ts']) {
    expect(result.filesPlanned).toContain(`components/json-editor/${name}`);
  }
  for (const name of ['components/ui/select.tsx', 'components/ui/textarea.tsx', 'components/tooltip/index.ts', 'components/_internal/scroll-viewport/scroll-viewport-attachment.tsx']) expect(result.filesPlanned).toContain(name);
  expect(result.filesPlanned.some(path => /\.(?:test|browser-fixture|package-fixture)\./u.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /frontend\/server|\/databases\//u.test(path))).toBe(false);
  expect(result.filesWritten).toHaveLength(0);
});

test('new JSON values and types resolve through all public routes without removing the original', async () => {
  const manifest = await Bun.file(join(root, 'package.json')).json();
  for (const route of ['@zero/framework', '@zero/framework/react', '@zero/framework/components/json-editor']) {
    // Each assertion proves one supported binding. An intentionally bounded full audit may report unknown after exhausting its aggregate budget.
    for (const name of ['DocumentEditor', 'parseDocumentSource', 'JsonDocumentEditor', 'JsonEditor', 'parseJsonDocument', 'diffJsonDocument']) expect({ route, name, status: (await new SourceOnlyUpgradeExports(root, manifest.exports).inspect(route, name)).status }).toEqual({ route, name, status: 'available' });
    for (const name of ['DocumentEditorProps', 'DocumentEditorHandle', 'DocumentFormat', 'DocumentSourceChange', 'DocumentParseResult', 'JsonDocumentEditorHandle', 'JsonDocumentParseResult', 'JsonDocumentValue', 'JsonEditorHandle']) expect({ route, name, status: (await new SourceOnlyUpgradeExports(root, manifest.exports).inspect(route, name, 'any')).status }).toEqual({ route, name, status: 'available' });
  }
});

test('actual copied JSON editors browser-build with shared styles and preserve existing customization', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'json-document-copy-'));
  try {
    const modules = join(consumer, 'node_modules'); await mkdir(join(modules, '@zero'), { recursive: true });
    for (const name of (await readdir(join(root, 'node_modules'))).filter(name => name !== '@zero')) await symlink(join(root, 'node_modules', name), join(modules, name));
    await symlink(root, join(modules, '@zero/framework'), 'dir');
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] } } }));
    const copy = await addZeroSource({ targetDir: consumer, items: ['components/json-editor'] });
    expect(copy.filesWritten).toContain('components/json-editor/json-document-editor.css');
    const path = join(consumer, 'components/json-editor/json-editor.tsx');
    const original = await Bun.file(path).text(); await Bun.write(path, original + '\n// CONSUMER CUSTOMIZATION MUST SURVIVE\n');
    expect((await addZeroSource({ targetDir: consumer, items: ['components/json-editor'] })).filesWritten).toHaveLength(0);
    expect(await Bun.file(path).text()).toContain('CONSUMER CUSTOMIZATION MUST SURVIVE');
    await Bun.write(join(consumer, 'entry.tsx'), "import {DocumentEditor, JsonDocumentEditor, JsonEditor} from './components/json-editor'; export const editors=<><DocumentEditor format='yaml' sourceText='name: Zero'/><DocumentEditor format='toml' sourceText='name=\\\"Zero\\\"'/><DocumentEditor format='env' sourceText='NAME=Zero'/><JsonDocumentEditor value={{}} onChange={()=>{}}/><JsonEditor value={{}} onChange={()=>{}}/></>;\n");
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', 'entry.tsx', '--target', 'browser', '--outdir', 'build'],
      { cwd: consumer, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Copied JSON editor failed: ${stdout}\n${stderr}`);
    expect(code).toBe(0); expect(await Bun.file(join(consumer, 'build/entry.css')).text()).toContain('zero-json-document');
  } finally { await rm(consumer, { recursive: true, force: true }); }
}, 45_000);
