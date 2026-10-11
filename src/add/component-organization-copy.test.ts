/** Family organization preserves bounded legacy source-copy destinations, ownership and native public identities. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addZeroSource } from './copy';
import { buildSourceCopyBrowserFixture } from './test-support/build-source-copy-fixture';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../test-support/playwright-test-browser';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const cardHelpers = ['components/ui/card-status.tsx', 'components/ui/card-presentation.ts'];
const selectHelpers = ['components/ui/select-morph.css', 'components/ui/select-morph-motion.ts',
  'components/ui/select-magnetic.ts', 'components/ui/select-motion-geometry.ts', 'components/ui/select-paint.ts'];
const cases = [
  { item: 'components/ui/card', legacy: ['components/ui/card.tsx', ...cardHelpers],
    family: ['components/surfaces/card/card.tsx', 'components/surfaces/card/card-status.tsx', 'components/surfaces/card/card-presentation.ts'] },
  { item: 'components/ui/content-card', legacy: ['components/ui/content-card.tsx', 'components/ui/content-card.css', 'components/ui/card.tsx', ...cardHelpers],
    family: ['components/surfaces/card/card.tsx', 'components/surfaces/card/card-status.tsx', 'components/surfaces/card/card-presentation.ts',
      'components/surfaces/card/content-card.tsx', 'components/surfaces/card/content-card.css'] },
  { item: 'components/ui/card-status', legacy: [...cardHelpers],
    family: ['components/surfaces/card/card-status.tsx', 'components/surfaces/card/card-presentation.ts'] },
  { item: 'components/ui/select', legacy: ['components/ui/select.tsx', ...selectHelpers],
    family: ['components/controls/select/select.tsx', 'components/controls/select/select-morph.css', 'components/controls/select/select-morph-motion.ts',
      'components/controls/select/select-magnetic.ts', 'components/controls/select/select-motion-geometry.ts', 'components/controls/select/select-paint.ts'] },
] as const;

for (const entry of cases) test(`${entry.item} preserves all legacy destinations and only its admitted family closure`, async () => {
  const result = await addZeroSource({ targetDir: join(scratch, 'component-organization-plan'), items: [entry.item], dryRun: true });
  for (const path of entry.legacy) expect(result.filesPlanned).toContain(path);
  expect(result.filesPlanned.filter(path => path.startsWith('components/surfaces/card/') || path.startsWith('components/controls/select/')))
    .toEqual([...entry.family].sort());
  expect(result.filesPlanned.some(path => /\.(?:test|spec|browser-fixture|test-fixture|package-fixture)\./u.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /^(?:frontend\/server\/|databases\/|components\/(?:charts|data-table|auth|storage)\/)/u.test(path))).toBe(false);
  expect(result.filesPlanned).not.toContain('frontend/styles/globals.css');
  expect(result.filesWritten).toHaveLength(0);
});

test('existing custom legacy Card/Select/helper/CSS destinations are not overwritten by the organized copy', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'component-organization-preservation-'));
  const legacy = [...new Set(cases.flatMap(entry => [...entry.legacy]))];
  try {
    for (const path of legacy) {
      await mkdir(dirname(join(consumer, path)), { recursive: true });
      await writeFile(join(consumer, path), `/* Synthetic application-owned customization: ${path}. */\n`);
    }
    const result = await addZeroSource({ targetDir: consumer, items: cases.map(entry => entry.item) });
    for (const path of legacy) {
      expect(result.filesSkipped).toContain(path);
      expect(result.filesWritten).not.toContain(path);
      expect(await readFile(join(consumer, path), 'utf8')).toBe(`/* Synthetic application-owned customization: ${path}. */\n`);
    }
    expect(result.filesWritten).toContain('components/surfaces/card/content-card.tsx');
    expect(result.filesWritten).toContain('components/controls/select/select.tsx');
    const repeat = await addZeroSource({ targetDir: consumer, items: cases.map(entry => entry.item) });
    expect(repeat.filesWritten).toHaveLength(0);
  } finally {
    // Only this freshly allocated synthetic consumer is disposable.
    await rm(consumer, { recursive: true, force: true });
  }
});

(playwrightTestBrowserAvailable ? test : test.skip)('a fresh copied consumer shares old/new Card and Select component/helper identities', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'component-organization-consumer-'));
  let lease: Awaited<ReturnType<typeof acquirePlaywrightTestBrowser>> | undefined;
  try {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const installed = join(root, 'node_modules'), modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(installed)).filter(name => name !== '@zero').map(name => symlink(join(installed, name), join(modules, name))));
    await symlink(root, join(modules, '@zero/framework'), 'dir');
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] },
    } }));
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('ORGANIZATION_COPY_CONFIG_MUST_NOT_EXECUTE');\n");
    await writeFile(join(consumer, '.env'), 'ZERO_ORGANIZATION_COPY_ENV_TRIPWIRE=must-not-load\n');
    const result = await addZeroSource({ targetDir: consumer, items: cases.map(entry => entry.item) });
    expect(result.filesWritten).toContain('components/ui/content-card.css');
    expect(result.filesWritten).toContain('components/ui/select-morph.css');
    await writeFile(join(consumer, 'entry.tsx'), [
      "import * as React from 'react'; import {createRoot} from 'react-dom/client';",
      "import * as OldCard from './components/ui/card'; import * as Card from './components/surfaces/card/card';",
      "import {ContentCard as OldContentCard} from './components/ui/content-card'; import {ContentCard} from './components/surfaces/card/content-card';",
      "import * as OldCardFeedback from './components/ui/card-presentation'; import * as CardFeedback from './components/surfaces/card/card-presentation';",
      "import {CardStatus as OldStatus} from './components/ui/card-status'; import {CardStatus} from './components/surfaces/card/card-status';",
      "import * as OldSelect from './components/ui/select'; import * as Select from './components/controls/select/select';",
      "import {useSelectMagnetic as oldMagnetic} from './components/ui/select-magnetic'; import {useSelectMagnetic} from './components/controls/select/select-magnetic';",
      "import {useSelectMorphMotion as oldMorph} from './components/ui/select-morph-motion'; import {useSelectMorphMotion} from './components/controls/select/select-morph-motion';",
      "import * as OldGeometry from './components/ui/select-motion-geometry'; import * as Geometry from './components/controls/select/select-motion-geometry';",
      "import * as OldPaint from './components/ui/select-paint'; import * as Paint from './components/controls/select/select-paint';",
      "import './components/ui/content-card.css'; import './components/ui/select-morph.css';",
      'const same=(a:Record<string,unknown>,b:Record<string,unknown>)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);',
      'Object.assign(window,{__organization:{card:same(OldCard,Card),contentCard:OldContentCard===ContentCard,status:OldStatus===CardStatus,',
      'cardFeedback:same(OldCardFeedback,CardFeedback),select:same(OldSelect,Select),magnetic:oldMagnetic===useSelectMagnetic,morph:oldMorph===useSelectMorphMotion,',
      'geometry:same(OldGeometry,Geometry),paint:same(OldPaint,Paint)}});',
      'createRoot(document.getElementById("root")!).render(<><OldCard.Card><Card.CardTitle asChild><h2>Native mixed Card</h2></Card.CardTitle></OldCard.Card>',
      '<OldContentCard title="Copied card" status="Connected" details="Deliberate details"/>',
      '<OldSelect.Select name="choice" defaultValue="one"><Select.SelectTrigger aria-label="Mixed Select"><OldSelect.SelectValue/></Select.SelectTrigger>',
      '<OldSelect.SelectContent><Select.SelectItem value="one">One</Select.SelectItem></OldSelect.SelectContent></OldSelect.Select></>);',
    ].join('\n'));
    await buildSourceCopyBrowserFixture(join(consumer, 'entry.tsx'), join(consumer, 'build'), consumer);
    const script = await readFile(join(consumer, 'build/entry.js'), 'utf8');
    const css = await readFile(join(consumer, 'build/entry.css'), 'utf8');
    expect(css).toContain('.zero-content-card'); expect(css).toContain('.zero-select-highlight');
    expect(script).not.toContain('ORGANIZATION_COPY_CONFIG_MUST_NOT_EXECUTE');
    expect(script).not.toContain('ZERO_ORGANIZATION_COPY_ENV_TRIPWIRE');
    lease = await acquirePlaywrightTestBrowser();
    const page = await lease.browser.newPage({ reducedMotion: 'reduce' });
    try {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
      await page.getByRole('heading', { name: 'Native mixed Card' }).waitFor();
      await page.getByRole('combobox', { name: 'Mixed Select' }).waitFor();
      expect(await page.evaluate(() => (window as unknown as { __organization: Record<string, boolean> }).__organization))
        .toEqual({ card: true, contentCard: true, status: true, cardFeedback: true, select: true, magnetic: true, morph: true, geometry: true, paint: true });
      expect(await page.locator('[data-slot="content-card"]').getAttribute('data-zero-card-density')).toBe('compact');
      expect(await page.getByRole('combobox', { name: 'Mixed Select' }).textContent()).toContain('One');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
    expect(await readFile(join(consumer, 'zero.config.ts'), 'utf8')).toContain('ORGANIZATION_COPY_CONFIG_MUST_NOT_EXECUTE');
    expect(await readFile(join(consumer, '.env'), 'utf8')).toContain('must-not-load');
    expect((await addZeroSource({ targetDir: consumer, items: cases.map(entry => entry.item) })).filesWritten).toHaveLength(0);
  } finally {
    lease?.release();
    // Never remove repository dependencies or application-owned source.
    await rm(consumer, { recursive: true, force: true });
  }
}, 120_000);
