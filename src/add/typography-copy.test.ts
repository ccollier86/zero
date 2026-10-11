/** Source-copy/public export qualification for optional text consumers; no app boot or font/network installation. */
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { addZeroSource } from './copy';
import { listStaticAddableTargets } from './registry';
import { renderThemeFoundationCss } from '../design-system/theme-css';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('typography is an explicit copy/export target with its opt-in companion styles and no test assets', async () => {
  expect(listStaticAddableTargets().some(target => target.id === 'components/typography')).toBe(true);
  const result = await addZeroSource({ targetDir: join(scratch, 'typography-copy-plan'), items: ['components/typography'], dryRun: true });
  for (const file of ['components/typography/index.ts', 'components/typography/text.tsx', 'components/typography/heading.tsx',
    'design-system/theme-typography.ts', 'frontend/styles/theme-next.css']) expect(result.filesPlanned).toContain(file);
  expect(result.filesPlanned.some(file => /\.(?:test|browser-fixture|package-fixture)\./u.test(file))).toBe(false);
  expect(result.filesPlanned).not.toContain('frontend/styles/globals.css');
  expect(result.filesWritten).toHaveLength(0);
  const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
  expect(pkg.exports['./components/typography']).toEqual({ types: './src/components/typography/index.ts', import: './src/components/typography/index.ts' });
});

test('copied Text/Heading browser-build against their app-owned closure without activating configuration', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'typography-consumer-'));
  try {
    const root = new URL('../../', import.meta.url).pathname, installed = join(root, 'node_modules'), modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(installed)).filter(name => name !== '@zero').map(name => symlink(join(installed, name), join(modules, name))));
    await symlink(root, join(modules, '@zero/framework'), 'dir');
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] } } }));
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('TYPOGRAPHY_COPY_MUST_NOT_BOOT');\n");
    const result = await addZeroSource({ targetDir: consumer, items: ['components/typography'] });
    expect(result.filesWritten).toContain('components/typography/text.tsx');
    expect(await Bun.file(join(consumer, 'frontend/styles/theme-next.css')).text()).toBe(renderThemeFoundationCss());
    await writeFile(join(consumer, 'entry.tsx'), "import {Text, Heading} from './components/typography'; export const content = <section><Heading as='h1' variant='page'>Title</Heading><Text as='p'>Body</Text></section>;\n");
    const build = await Bun.build({ entrypoints: [join(consumer, 'entry.tsx')], target: 'browser' });
    if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
    expect(build.success).toBe(true);
    expect(await build.outputs[0]!.text()).not.toContain('TYPOGRAPHY_COPY_MUST_NOT_BOOT');
    expect(await Bun.file(join(consumer, 'zero.config.ts')).text()).toContain('TYPOGRAPHY_COPY_MUST_NOT_BOOT');
    expect((await addZeroSource({ targetDir: consumer, items: ['components/typography'] })).filesWritten).toHaveLength(0);
  } finally {
    // Dispose only the exact newly allocated disposable source-copy fixture.
    await rm(consumer, { recursive: true, force: true });
  }
}, 40_000);
