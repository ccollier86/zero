/** Explicit source-copy qualification of the parallel theme; no app bootstrap, automatic activation or legacy stylesheet edits. */
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { addZeroSource } from './copy';
import { listStaticAddableTargets } from './registry';
import { renderThemeFoundationCss } from '../design-system/theme-css';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('theme-foundation is an explicit copy target and dry-run includes pure API plus supplemental CSS only', async () => {
  expect(listStaticAddableTargets().some(target => target.id === 'theme-foundation')).toBe(true);
  const result = await addZeroSource({ targetDir: join(scratch, 'theme-copy-plan'), items: ['theme-foundation'], dryRun: true });
  for (const path of ['design-system/index.ts', 'design-system/theme-tokens.ts', 'design-system/theme-motion.ts',
    'design-system/theme-validation.ts', 'design-system/theme-utility-aliases.ts', 'frontend/styles/theme-next.css']) expect(result.filesPlanned).toContain(path);
  expect(result.filesPlanned.every(path => path.startsWith('design-system/') || path === 'frontend/styles/theme-next.css')).toBe(true);
  expect(result.filesPlanned.some(path => /\.(?:test|browser-fixture|package-fixture)\./u.test(path))).toBe(false);
  expect(result.filesWritten).toHaveLength(0); expect(result.rewrites).toHaveLength(0);
});

test('actual copied foundation builds in browser/server, matches CSS and preserves existing consumer source', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'theme-foundation-consumer-'));
  try {
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('THEME_COPY_MUST_NOT_BOOT_CONFIG');\n");
    const result = await addZeroSource({ targetDir: consumer, items: ['theme-foundation'] });
    expect(result.filesWritten).toContain('design-system/index.ts');
    expect(await readFile(join(consumer, 'frontend/styles/theme-next.css'), 'utf8')).toBe(renderThemeFoundationCss());
    for (const target of ['browser', 'bun'] as const) {
      const build = await Bun.build({ entrypoints: [join(consumer, 'design-system/index.ts')], target });
      if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
      expect(build.success).toBe(true); expect(build.outputs).toHaveLength(1);
      expect(await build.outputs[0]!.text()).not.toContain('THEME_COPY_MUST_NOT_BOOT_CONFIG');
    }
    const local = '// application-owned change, preserve it\n';
    await writeFile(join(consumer, 'design-system/theme-foundation.ts'), local);
    const repeat = await addZeroSource({ targetDir: consumer, items: ['theme-foundation'] });
    expect(repeat.filesSkipped).toContain('design-system/theme-foundation.ts');
    expect(repeat.filesWritten).toHaveLength(0);
    expect(await readFile(join(consumer, 'design-system/theme-foundation.ts'), 'utf8')).toBe(local);
    expect(await readFile(join(consumer, 'zero.config.ts'), 'utf8')).toContain('THEME_COPY_MUST_NOT_BOOT_CONFIG');
  } finally {
    // Only this exact newly allocated disposable test consumer is removed.
    await rm(consumer, { recursive: true, force: true });
  }
}, 30_000);

test('actual copied portal/tooltip/modal consumer includes the observer closure and browser-builds without configuration', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'theme-components-consumer-'));
  try {
    const packageRoot = new URL('../../', import.meta.url).pathname;
    const installed = join(packageRoot, 'node_modules'), modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(installed)).filter(name => name !== '@zero').map(name => symlink(join(installed, name), join(modules, name))));
    await symlink(packageRoot, join(modules, '@zero/framework'), 'dir');
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] } } }));
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('THEME_COMPONENT_COPY_MUST_NOT_BOOT_CONFIG');\n");
    const result = await addZeroSource({ targetDir: consumer, items: ['theme-foundation', 'components/ui/combobox', 'components/tooltip', 'modals'] });
    expect(result.filesWritten).toContain('lib/observe-presentation-theme.ts');
    expect(result.filesWritten).toContain('components/overlays/overlay-scope.tsx');
    expect(result.filesWritten).toContain('frontend/styles/theme-next.css');
    expect(result.filesWritten.some(file => /\.(?:test|browser-fixture|test-fixture|package-fixture)\./u.test(file))).toBe(false);
    expect(result.filesWritten).not.toContain('frontend/styles/globals.css');
    await writeFile(join(consumer, 'entry.ts'), [
      "import { createThemeAttributes } from './design-system';",
      "import * as Overlay from './components/ui/combobox';",
      "import * as Tooltip from './components/tooltip';",
      "import * as Modals from './modals';",
      'export { createThemeAttributes, Overlay, Tooltip, Modals };',
    ].join('\n'));
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', 'entry.ts', '--target', 'browser', '--outdir', 'build'],
      { cwd: consumer, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Copied theme component build failed: ${stdout}\n${stderr}`);
    expect(code).toBe(0); expect(await Bun.file(join(consumer, 'build/entry.js')).exists()).toBe(true);
  } finally {
    // Dispose only this exact test allocation, never framework or user-owned source.
    await rm(consumer, { recursive: true, force: true });
  }
}, 40_000);
