/** Exact historical copy edges protect app-owned customizations even when compatibility files arrive transitively. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getComponentCompatibilityCompanions } from './component-compatibility';
import { addZeroSource } from './copy';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('organization preserves supported package paths without publishing canonical helpers or fixtures', async () => {
  const root = join(import.meta.dir, '../..');
  for (const name of ['calendar', 'date-picker', 'date-range-picker', 'time-picker', 'select', 'card', 'content-card']) {
    expect(Bun.resolveSync(`@zero/framework/components/ui/${name}`, root)).toEndWith(`/src/components/ui/${name}.tsx`);
  }
  expect(Bun.resolveSync('@zero/framework/components/popover', root)).toEndWith('/src/components/popover/index.ts');
  const privatePaths = ['controls/date-time', 'controls/select', 'surfaces/card', 'surfaces/popover',
    '_internal/overlay-scope', '_internal/anchored-surface', '_internal/scroll-viewport', '_internal/magnetic-highlight',
    'ui/calendar.test', 'ui/calendar.browser-fixture', 'ui/date-time-picker.test', 'ui/date-time-picker.browser-fixture',
    'controls/date-time/calendar.browser-fixture', '_internal/overlay-scope/overlay-scope.test'];
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'public-component-paths-'));
  try {
    await mkdir(join(consumer, 'node_modules/@zero'), { recursive: true });
    await symlink(root, join(consumer, 'node_modules/@zero/framework'), 'dir');
    await Bun.write(join(consumer, 'tsconfig.json'), '{"compilerOptions":{}}');
    // The repository's intentional @zero/framework/components/* source alias
    // bypasses package exports. Test actual consumer resolution outside it.
    const script = `const paths=${JSON.stringify(privatePaths)};console.log(JSON.stringify(paths.map(path=>{try{Bun.resolveSync('@zero/framework/components/'+path,process.cwd());return false;}catch{return true;}})));`;
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], { cwd: consumer, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH } });
    const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(status, err).toBe(0); expect(JSON.parse(out)).toEqual(privatePaths.map(() => true));
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test('compatibility edges are immutable exact files, never guessed directories or unrelated sources', () => {
  const card = getComponentCompatibilityCompanions('components/ui/card.tsx');
  expect(card).toEqual(['components/ui/card-status.tsx', 'components/ui/card-presentation.ts']);
  expect(Object.isFrozen(card)).toBe(true);
  expect(() => (card as string[]).push('components/auth')).toThrow();
  const empty = getComponentCompatibilityCompanions('components/ui/unmoved.tsx');
  expect(empty).toEqual([]);
  expect(Object.isFrozen(empty)).toBe(true);
  expect(getComponentCompatibilityCompanions('components/ui')).toEqual([]);
  expect(getComponentCompatibilityCompanions('__proto__')).toEqual([]);
  expect(getComponentCompatibilityCompanions('toString')).toEqual([]);
});

test('a different UI target preserves moved Card dependencies without directly requesting Card', async () => {
  const result = await addZeroSource({ items: ['components/ui/stat-card'], targetDir: join(scratch, 'compatibility-plan'), dryRun: true });
  for (const file of ['components/ui/stat-card.tsx', 'components/ui/card.tsx',
    'components/ui/card-status.tsx', 'components/ui/card-presentation.ts',
    'components/surfaces/card/card.tsx', 'components/surfaces/card/card-status.tsx',
    'components/surfaces/card/card-presentation.ts']) expect(result.filesPlanned).toContain(file);
  expect(result.filesPlanned.some(file => /\.(?:test|spec|browser-fixture)\./u.test(file))).toBe(false);
  expect(result.filesPlanned.some(file => /^(?:components\/(?:auth|charts|storage)|frontend\/server|databases\/)/u.test(file))).toBe(false);
  expect(result.filesWritten).toEqual([]);
});

test('another family importing Select preserves its old helpers without adding a direct Select request', async () => {
  const result = await addZeroSource({ items: ['components/data-table'], targetDir: join(scratch, 'compatibility-plan'), dryRun: true });
  for (const file of ['components/ui/select.tsx', 'components/ui/select-morph.css',
    'components/ui/select-morph-motion.ts', 'components/ui/select-magnetic.ts',
    'components/ui/select-motion-geometry.ts', 'components/ui/select-paint.ts']) expect(result.filesPlanned).toContain(file);
  expect(result.filesPlanned.some(file => /\.(?:test|spec|browser-fixture)\./u.test(file))).toBe(false);
  expect(result.filesWritten).toEqual([]);
});

test('transitive compatibility copies skip customized old dependencies; force remains explicit and scoped', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'compatibility-copy-'));
  const customPath = join(consumer, 'components/ui/card-status.tsx');
  const custom = '/* Synthetic app-owned CardStatus customization. */\n';
  try {
    await mkdir(dirname(customPath), { recursive: true });
    await writeFile(customPath, custom);
    const options = { items: ['components/ui/stat-card'], targetDir: consumer };
    const first = await addZeroSource(options);
    expect(first.filesSkipped).toContain('components/ui/card-status.tsx');
    expect(await readFile(customPath, 'utf8')).toBe(custom);
    expect(first.filesWritten).toContain('components/ui/card-presentation.ts');
    expect((await addZeroSource(options)).filesWritten).toEqual([]);
    const forced = await addZeroSource({ ...options, force: true });
    expect(forced.filesWritten).toContain('components/ui/card-status.tsx');
    expect(await readFile(customPath, 'utf8')).not.toBe(custom);
    expect(forced.filesWritten).not.toContain('frontend/styles/globals.css');
  } finally {
    // Only the allocated synthetic consumer is disposable; no application files are removed.
    await rm(consumer, { recursive: true, force: true });
  }
});
