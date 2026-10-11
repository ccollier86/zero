/** Date/time family ownership preserves every pre-move source-copy path and exact component/context identity. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addZeroSource } from './copy';
import { buildSourceCopyBrowserFixture } from './test-support/build-source-copy-fixture';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../test-support/playwright-test-browser';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
// Frozen before the move: retaining only the new canonical dependencies would silently drop customized old helper destinations.
const baselines: Readonly<Record<string, readonly string[]>> = {
  "components/ui/calendar": [
    "components/animate-ui/icons/animation-loop.ts",
    "components/animate-ui/icons/icon.tsx",
    "components/animate-ui/primitives/animate/slot.tsx",
    "components/overlays/menu-active-highlight.css",
    "components/overlays/menu-active-highlight.tsx",
    "components/overlays/overlay-scope.tsx",
    "components/overlays/scroll-viewport-decoration.tsx",
    "components/overlays/scroll-viewport-metrics.ts",
    "components/overlays/scroll-viewport.css",
    "components/overlays/use-scroll-viewport.ts",
    "components/ui/button.tsx",
    "components/ui/calendar-month-presentation.tsx",
    "components/ui/calendar-motion.ts",
    "components/ui/calendar-view-context.tsx",
    "components/ui/calendar-view-model.ts",
    "components/ui/calendar-view-motion.ts",
    "components/ui/calendar.tsx",
    "components/ui/picker-value-text.tsx",
    "hooks/use-is-in-view.tsx",
    "hooks/use-media-query.ts",
    "lib/observe-presentation-theme.ts",
    "lib/utils.ts"
  ],
  "components/ui/date-picker": [
    "components/animate-ui/components/radix/popover.tsx",
    "components/animate-ui/icons/animation-loop.ts",
    "components/animate-ui/icons/icon.tsx",
    "components/animate-ui/primitives/animate/slot.tsx",
    "components/animate-ui/primitives/radix/popover.tsx",
    "components/overlays/anchored-surface-motion.ts",
    "components/overlays/anchored-surface.css",
    "components/overlays/menu-active-highlight.css",
    "components/overlays/menu-active-highlight.tsx",
    "components/overlays/overlay-scope.tsx",
    "components/overlays/scroll-viewport-decoration.tsx",
    "components/overlays/scroll-viewport-metrics.ts",
    "components/overlays/scroll-viewport.css",
    "components/overlays/use-scroll-viewport.ts",
    "components/ui/button.tsx",
    "components/ui/calendar-month-presentation.tsx",
    "components/ui/calendar-motion.ts",
    "components/ui/calendar-view-context.tsx",
    "components/ui/calendar-view-model.ts",
    "components/ui/calendar-view-motion.ts",
    "components/ui/calendar.tsx",
    "components/ui/date-picker-value.ts",
    "components/ui/date-picker.tsx",
    "components/ui/input.tsx",
    "components/ui/picker-popover-motion.ts",
    "components/ui/picker-value-text.tsx",
    "hooks/use-controlled-state.tsx",
    "hooks/use-is-in-view.tsx",
    "hooks/use-media-query.ts",
    "hooks/use-stable-callback.ts",
    "lib/get-strict-context.tsx",
    "lib/observe-presentation-theme.ts",
    "lib/utils.ts"
  ],
  "components/ui/date-range-picker": [
    "components/animate-ui/components/radix/popover.tsx",
    "components/animate-ui/icons/animation-loop.ts",
    "components/animate-ui/icons/icon.tsx",
    "components/animate-ui/primitives/animate/slot.tsx",
    "components/animate-ui/primitives/radix/popover.tsx",
    "components/overlays/anchored-surface-motion.ts",
    "components/overlays/anchored-surface.css",
    "components/overlays/menu-active-highlight.css",
    "components/overlays/menu-active-highlight.tsx",
    "components/overlays/overlay-scope.tsx",
    "components/overlays/scroll-viewport-decoration.tsx",
    "components/overlays/scroll-viewport-metrics.ts",
    "components/overlays/scroll-viewport.css",
    "components/overlays/use-scroll-viewport.ts",
    "components/ui/button.tsx",
    "components/ui/calendar-month-presentation.tsx",
    "components/ui/calendar-motion.ts",
    "components/ui/calendar-view-context.tsx",
    "components/ui/calendar-view-model.ts",
    "components/ui/calendar-view-motion.ts",
    "components/ui/calendar.tsx",
    "components/ui/date-range-picker.tsx",
    "components/ui/picker-value-text.tsx",
    "hooks/use-controlled-state.tsx",
    "hooks/use-is-in-view.tsx",
    "hooks/use-media-query.ts",
    "lib/get-strict-context.tsx",
    "lib/observe-presentation-theme.ts",
    "lib/utils.ts"
  ],
  "components/ui/time-picker": [
    "components/animate-ui/components/radix/popover.tsx",
    "components/animate-ui/icons/animation-loop.ts",
    "components/animate-ui/icons/icon.tsx",
    "components/animate-ui/primitives/animate/slot.tsx",
    "components/animate-ui/primitives/radix/popover.tsx",
    "components/overlays/anchored-surface-motion.ts",
    "components/overlays/anchored-surface.css",
    "components/overlays/menu-active-highlight.css",
    "components/overlays/menu-active-highlight.tsx",
    "components/overlays/overlay-scope.tsx",
    "components/overlays/scroll-viewport-decoration.tsx",
    "components/overlays/scroll-viewport-metrics.ts",
    "components/overlays/scroll-viewport.css",
    "components/overlays/use-scroll-viewport.ts",
    "components/ui/button.tsx",
    "components/ui/calendar-motion.ts",
    "components/ui/input.tsx",
    "components/ui/picker-value-text.tsx",
    "components/ui/time-picker-value.ts",
    "components/ui/time-picker.tsx",
    "hooks/use-controlled-state.tsx",
    "hooks/use-is-in-view.tsx",
    "hooks/use-media-query.ts",
    "hooks/use-stable-callback.ts",
    "lib/get-strict-context.tsx",
    "lib/observe-presentation-theme.ts",
    "lib/utils.ts"
  ],
  "components/ui/calendar-month-presentation": [
    "components/animate-ui/icons/animation-loop.ts",
    "components/animate-ui/icons/icon.tsx",
    "components/animate-ui/primitives/animate/slot.tsx",
    "components/overlays/menu-active-highlight.css",
    "components/overlays/menu-active-highlight.tsx",
    "components/overlays/overlay-scope.tsx",
    "components/overlays/scroll-viewport-decoration.tsx",
    "components/overlays/scroll-viewport-metrics.ts",
    "components/overlays/scroll-viewport.css",
    "components/overlays/use-scroll-viewport.ts",
    "components/ui/button.tsx",
    "components/ui/calendar-month-presentation.tsx",
    "components/ui/calendar-motion.ts",
    "components/ui/calendar-view-context.tsx",
    "components/ui/calendar-view-model.ts",
    "components/ui/calendar-view-motion.ts",
    "components/ui/picker-value-text.tsx",
    "hooks/use-is-in-view.tsx",
    "hooks/use-media-query.ts",
    "lib/observe-presentation-theme.ts",
    "lib/utils.ts"
  ],
  "components/ui/calendar-view-context": [
    "components/ui/calendar-view-context.tsx"
  ],
  "components/ui/picker-value-text": [
    "components/ui/calendar-motion.ts",
    "components/ui/picker-value-text.tsx",
    "hooks/use-media-query.ts"
  ]
};
const canonical: Readonly<Record<string, readonly string[]>> = {
  "components/ui/calendar": [
    "calendar.tsx",
    "calendar-month-presentation.tsx",
    "calendar-view-context.tsx",
    "calendar-view-model.ts",
    "calendar-view-motion.ts",
    "calendar-motion.ts",
    "picker-value-text.tsx"
  ],
  "components/ui/date-picker": [
    "calendar.tsx",
    "calendar-month-presentation.tsx",
    "calendar-view-context.tsx",
    "calendar-view-model.ts",
    "calendar-view-motion.ts",
    "calendar-motion.ts",
    "picker-value-text.tsx",
    "date-picker.tsx",
    "date-picker-scroll.tsx",
    "date-picker-value.ts",
    "picker-popover-motion.ts"
  ],
  "components/ui/date-range-picker": [
    "calendar.tsx",
    "calendar-month-presentation.tsx",
    "calendar-view-context.tsx",
    "calendar-view-model.ts",
    "calendar-view-motion.ts",
    "calendar-motion.ts",
    "picker-value-text.tsx",
    "date-range-picker.tsx"
  ],
  "components/ui/time-picker": [
    "time-picker.tsx",
    "time-picker-value.ts",
    "picker-value-text.tsx",
    "calendar-motion.ts"
  ],
  "components/ui/calendar-month-presentation": [
    "calendar-month-presentation.tsx",
    "calendar-view-context.tsx",
    "calendar-view-model.ts",
    "calendar-view-motion.ts",
    "calendar-motion.ts",
    "picker-value-text.tsx"
  ],
  "components/ui/calendar-view-context": [
    "calendar-view-context.tsx"
  ],
  "components/ui/picker-value-text": [
    "picker-value-text.tsx",
    "calendar-motion.ts"
  ]
};
const legacyFiles = [
  "components/ui/calendar.tsx",
  "components/ui/calendar-month-presentation.tsx",
  "components/ui/calendar-view-context.tsx",
  "components/ui/calendar-view-model.ts",
  "components/ui/calendar-view-motion.ts",
  "components/ui/calendar-motion.ts",
  "components/ui/date-picker.tsx",
  "components/ui/date-picker-value.ts",
  "components/ui/date-range-picker.tsx",
  "components/ui/time-picker.tsx",
  "components/ui/time-picker-value.ts",
  "components/ui/picker-value-text.tsx",
  "components/ui/picker-popover-motion.ts"
];
const items = Object.keys(baselines);

for (const item of items) test(`${item} retains its entire former copy plan and only its own canonical closure`, async () => {
  const result = await addZeroSource({ targetDir: join(scratch, 'date-time-organization-plan'), items: [item], dryRun: true });
  for (const oldPath of baselines[item]!) expect(result.filesPlanned).toContain(oldPath);
  expect(result.filesPlanned.filter(path => path.startsWith('components/controls/date-time/')))
    .toEqual(canonical[item]!.map(path => 'components/controls/date-time/' + path).sort());
  if (item === 'components/ui/date-picker') {
    for (const path of ['scroll-viewport-attachment.tsx', 'scroll-viewport-decoration-next.tsx',
      'scroll-viewport-interactions.ts', 'scroll-viewport-next.css']) {
      expect(result.filesPlanned).toContain('components/_internal/scroll-viewport/' + path);
    }
  }
  expect(result.filesPlanned.some(path => /\.(?:test|spec|browser-fixture|test-fixture|package-fixture)\./u.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /^(?:frontend\/server\/|databases\/|components\/(?:charts|data-table|auth|storage)\/)/u.test(path))).toBe(false);
  expect(result.filesPlanned).not.toContain('components/controls/date-time/index.ts');
  expect(result.filesPlanned).not.toContain('frontend/styles/globals.css');
  expect(result.filesWritten).toHaveLength(0);
});

test('custom old date/time components and helpers remain untouched during initial and repeat organized copies', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'date-time-organization-preservation-'));
  try {
    for (const path of legacyFiles) {
      await mkdir(dirname(join(consumer, path)), { recursive: true });
      await writeFile(join(consumer, path), `/* Synthetic app customization retained: ${path}. */\n`);
    }
    const result = await addZeroSource({ targetDir: consumer, items });
    for (const path of legacyFiles) {
      expect(result.filesSkipped).toContain(path);
      expect(result.filesWritten).not.toContain(path);
      expect(await readFile(join(consumer, path), 'utf8')).toBe(`/* Synthetic app customization retained: ${path}. */\n`);
    }
    // The additive scroll facade accompanies, rather than replaces, the original picker engine.
    expect(result.filesWritten.filter(path => path.startsWith('components/controls/date-time/'))).toHaveLength(14);
    expect((await addZeroSource({ targetDir: consumer, items })).filesWritten).toHaveLength(0);
    for (const path of legacyFiles) expect(await readFile(join(consumer, path), 'utf8')).toBe(`/* Synthetic app customization retained: ${path}. */\n`);
  } finally {
    // Only this freshly allocated synthetic consumer is disposable.
    await rm(consumer, { recursive: true, force: true });
  }
});

(playwrightTestBrowserAvailable ? test : test.skip)('a fresh consumer browser build preserves all old/new date helpers and mixed Calendar presentation contexts', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'date-time-organization-consumer-'));
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
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('DATE_TIME_COPY_CONFIG_MUST_NOT_EXECUTE');\n");
    await writeFile(join(consumer, '.env'), 'ZERO_DATE_TIME_COPY_ENV_TRIPWIRE=must-not-load\n');
    const result = await addZeroSource({ targetDir: consumer, items });
    for (const oldPath of legacyFiles) expect(result.filesWritten).toContain(oldPath);
    await writeFile(join(consumer, 'entry.tsx'), [
      "import * as React from 'react'; import {createRoot} from 'react-dom/client';",
      "import * as Legacy0 from './components/ui/calendar'; import * as Canonical0 from './components/controls/date-time/calendar';",
      "import * as Legacy1 from './components/ui/calendar-month-presentation'; import * as Canonical1 from './components/controls/date-time/calendar-month-presentation';",
      "import * as Legacy2 from './components/ui/calendar-view-context'; import * as Canonical2 from './components/controls/date-time/calendar-view-context';",
      "import * as Legacy3 from './components/ui/calendar-view-model'; import * as Canonical3 from './components/controls/date-time/calendar-view-model';",
      "import * as Legacy4 from './components/ui/calendar-view-motion'; import * as Canonical4 from './components/controls/date-time/calendar-view-motion';",
      "import * as Legacy5 from './components/ui/calendar-motion'; import * as Canonical5 from './components/controls/date-time/calendar-motion';",
      "import * as Legacy6 from './components/ui/date-picker'; import * as Canonical6 from './components/controls/date-time/date-picker-scroll';",
      "import * as Legacy7 from './components/ui/date-picker-value'; import * as Canonical7 from './components/controls/date-time/date-picker-value';",
      "import * as Legacy8 from './components/ui/date-range-picker'; import * as Canonical8 from './components/controls/date-time/date-range-picker';",
      "import * as Legacy9 from './components/ui/time-picker'; import * as Canonical9 from './components/controls/date-time/time-picker';",
      "import * as Legacy10 from './components/ui/time-picker-value'; import * as Canonical10 from './components/controls/date-time/time-picker-value';",
      "import * as Legacy11 from './components/ui/picker-value-text'; import * as Canonical11 from './components/controls/date-time/picker-value-text';",
      "import * as Legacy12 from './components/ui/picker-popover-motion'; import * as Canonical12 from './components/controls/date-time/picker-popover-motion';",
      'const same=(a:Record<string,unknown>,b:Record<string,unknown>)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);',
      'Object.assign(window,{__dateOrganization:{identities:[same(Legacy0,Canonical0),same(Legacy1,Canonical1),same(Legacy2,Canonical2),same(Legacy3,Canonical3),same(Legacy4,Canonical4),same(Legacy5,Canonical5),same(Legacy6,Canonical6),same(Legacy7,Canonical7),same(Legacy8,Canonical8),same(Legacy9,Canonical9),same(Legacy10,Canonical10),same(Legacy11,Canonical11),same(Legacy12,Canonical12)]}});',
      'createRoot(document.getElementById("root")!).render(<><Legacy0.Calendar defaultMonth={new Date(2026,1,3)}/>',
      '<Legacy2.CalendarPresentationContext.Provider value={{showToday:false,enableViewPicker:true}}><Canonical2.CalendarPresentationContext.Consumer>{value=><output data-testid="mixed-presentation-context">{String(!value.showToday&&value.enableViewPicker)}</output>}</Canonical2.CalendarPresentationContext.Consumer></Legacy2.CalendarPresentationContext.Provider>',
      '<Legacy2.CalendarMonthViewContext.Provider value={{calendarMonth:{date:new Date(2026,1,1),weeks:[]},displayIndex:0,view:"years",setView(){},requestDayFocus:{current:false}}}><Canonical2.CalendarMonthViewContext.Consumer>{value=><output data-testid="mixed-month-context">{value?.view}</output>}</Canonical2.CalendarMonthViewContext.Consumer></Legacy2.CalendarMonthViewContext.Provider>',
      '<Canonical6.DatePicker appearance="button" value={new Date(2026,1,3)} inputProps={{"aria-label":"Copied date"}}/><Legacy9.TimePicker value="17:46" name="meetingTime" aria-label="Copied time"/><Canonical8.DateRangePicker placeholder="Copied range"/></>);',
    ].join('\n'));
    await buildSourceCopyBrowserFixture(join(consumer, 'entry.tsx'), join(consumer, 'build'), consumer);
    const script = await readFile(join(consumer, 'build/entry.js'), 'utf8');
    const css = await readFile(join(consumer, 'build/entry.css'), 'utf8');
    expect(script).not.toContain('DATE_TIME_COPY_CONFIG_MUST_NOT_EXECUTE');
    expect(script).not.toContain('ZERO_DATE_TIME_COPY_ENV_TRIPWIRE');
    expect(css).toContain('.zero-menu-active-highlight');
    lease = await acquirePlaywrightTestBrowser();
    const page = await lease.browser.newPage({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(5_000);
    try {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
      await page.getByRole('button', { name: 'February, choose month', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as unknown as { __dateOrganization: { identities: boolean[] } }).__dateOrganization.identities))
        .toEqual(Array.from({ length: 13 }, () => true));
      expect(await page.getByTestId('mixed-presentation-context').textContent()).toBe('true');
      expect(await page.getByTestId('mixed-month-context').textContent()).toBe('years');
      expect(await page.getByRole('button', { name: 'Copied date, Feb 3, 2026', exact: true }).count()).toBe(1);
      expect(await page.locator('input[type="hidden"][name="meetingTime"]').inputValue()).toBe('17:46');
      expect(await page.getByRole('button', { name: 'Copied range', exact: true }).getAttribute('type')).toBe('button');
      await page.getByRole('button', { name: 'February, choose month', exact: true }).click();
      await page.getByRole('grid', { name: 'Months in 2026', exact: true }).waitFor();
      await page.getByRole('button', { name: 'April 2026', exact: true }).click();
      await page.getByRole('grid', { name: 'April 2026', exact: true }).waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
    expect(await readFile(join(consumer, 'zero.config.ts'), 'utf8')).toContain('DATE_TIME_COPY_CONFIG_MUST_NOT_EXECUTE');
    expect(await readFile(join(consumer, '.env'), 'utf8')).toContain('must-not-load');
    expect((await addZeroSource({ targetDir: consumer, items })).filesWritten).toHaveLength(0);
  } finally {
    lease?.release();
    await rm(consumer, { recursive: true, force: true });
  }
}, 120_000);
