/** Chart source-copy is presentation-only and excludes synthetic harnesses. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addZeroSource } from './copy';

test('chart source-copy includes composition, pure math and token skin', async () => {
  const result = await addZeroSource({
    targetDir: '/Volumes/code-bank/tmp/scratch/zero-platform/charts-copy-plan',
    items: ['components/charts'], dryRun: true,
  });
  expect(result.filesPlanned).toContain('components/charts/index.ts');
  expect(result.filesPlanned).toContain('components/charts/chart-tokens.css');
  expect(result.filesPlanned).toContain('components/charts/chart-color.ts');
  expect(result.filesPlanned).toContain('components/charts/chart-tokens.ts');
  expect(result.filesPlanned).toContain('components/charts/sankey/sankey-model.ts');
  expect(result.filesPlanned).toContain('components/charts/sankey/sankey.css');
  expect(result.filesPlanned).toContain('components/charts/race-bar/race-bar-model.ts');
  expect(result.filesPlanned).toContain('components/charts/race-bar/race-bar-types.ts');
  expect(result.filesPlanned).toContain('components/charts/race-bar/race-bar-chart.tsx');
  expect(result.filesPlanned).toContain('components/charts/race-bar/race-bar.css');
  expect(result.filesPlanned).toContain('components/charts/funnel/funnel-model.ts');
  expect(result.filesPlanned).toContain('components/charts/funnel/funnel-types.ts');
  expect(result.filesPlanned).toContain('components/charts/funnel/funnel-chart.tsx');
  expect(result.filesPlanned).toContain('components/charts/funnel/funnel.css');
  expect(result.filesPlanned.some(path => /\.(?:test|browser-fixture|test-data|package-fixture)\./.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /frontend\/server|\/databases\//.test(path))).toBe(false);
  expect(result.rewrites.some(item => item.from === '#zero/lib/utils')).toBe(true);
}, 60_000);

test('dedicated Arc source-copy includes all twelve models, skin and shared overlays', async () => {
  const result = await addZeroSource({ targetDir: '/Volumes/code-bank/tmp/scratch/zero-platform/arc-copy-plan', items: ['components/charts/arc'], dryRun: true });
  for (const name of ['line-chart', 'bar-chart', 'donut-chart', 'streamgraph', 'brush-chart', 'waffle-chart', 'slope-chart', 'sparkline', 'gauge', 'activity-heatmap', 'ridgeline', 'treemap']) {
    expect(result.filesPlanned).toContain(`components/charts/arc/${name}/${name}.tsx`);
    expect(result.filesPlanned).toContain(`components/charts/arc/${name}/${name}-model.ts`);
    expect(result.filesPlanned).toContain(`components/charts/arc/${name}/${name}.css`);
  }
  expect(result.filesPlanned).toContain('components/charts/arc/arc-charts.css');
  expect(result.filesPlanned).toContain('components/charts/chart-color.ts');
  expect(result.filesPlanned).toContain('components/charts/chart-tokens.css');
  expect(result.filesPlanned).toContain('components/charts/arc/shared/motion-tokens.ts');
  expect(result.filesPlanned).toContain('components/tooltip/index.ts');
  expect(result.filesPlanned.some(path => /\.(?:test|browser-fixture|test-data|package-fixture)\./.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /frontend\/server|\/databases\//.test(path))).toBe(false);
});

test('dedicated native source-copy retains all four families, shared inspectors and pure helpers', async () => {
  const result = await addZeroSource({ targetDir: '/Volumes/code-bank/tmp/scratch/zero-platform/native-copy-plan', items: ['components/charts/native'], dryRun: true });
  for (const file of ['native-charts.css', 'cartesian/cartesian-chart.tsx', 'cartesian/cartesian-model.ts', 'statistical/histogram-chart.tsx', 'statistical/box-plot-chart.tsx', 'statistical/waterfall-chart.tsx', 'statistical/candlestick-chart.tsx', 'statistical/matrix-heatmap.tsx', 'polar/pie-chart.tsx', 'polar/radar-chart.tsx', 'polar/radial-bar-chart.tsx', 'polar/sunburst-chart.tsx', 'polar/polar-model.ts', 'polar/polar-layout.ts', 'realtime/realtime-chart.tsx', 'realtime/realtime-model.ts', 'realtime/realtime-path-state.ts', 'shared/admission.ts', 'shared/native-chart.tsx', 'shared/native-motion.ts']) expect(result.filesPlanned).toContain(`components/charts/native/${file}`);
  expect(result.filesPlanned).toContain('components/charts/chart-color.ts');
  expect(result.filesPlanned).toContain('components/tooltip/index.ts');
  expect(result.filesPlanned).toContain('components/charts/chart-tokens.css');
  expect(result.filesPlanned).toContain('components/charts/chart-color.ts');
  expect(result.filesPlanned.some(path => /\.(?:test|browser-fixture|test-data|package-fixture)\./.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /frontend\/server|\/databases\/|\/recharts\/|\/d3\//.test(path))).toBe(false);
});

for (const item of ['components/charts', 'components/charts/arc', 'components/charts/native']) test(`actual copied ${item} browser-builds without app configuration`, async () => {
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'charts-copy-consumer-'));
  try {
    const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
    const installed = join(packageRoot, 'node_modules'), modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    // Reuse already installed dependencies through disposable links; do not
    // mutate the repository's node_modules or download a second dependency tree.
    await Promise.all((await readdir(installed)).filter(name => name !== '@zero').map(name =>
      symlink(join(installed, name), join(modules, name))));
    await symlink(packageRoot, join(modules, '@zero/framework'), 'dir');
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] },
    } }));
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('CHART_COPY_CONFIG_MUST_NOT_EXECUTE');\n");
    const result = await addZeroSource({ targetDir: consumer, items: [item] });
    expect(result.filesWritten).toContain(item + '/index.ts');
    expect(result.filesWritten).toContain(item === 'components/charts/native' ? 'components/charts/native/native-charts.css' : 'components/charts/arc/arc-charts.css');
    expect(result.filesWritten).toContain('components/charts/chart-tokens.css');
    expect(result.filesWritten).toContain('lib/observe-presentation-theme.ts');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', item + '/index.ts',
      '--target', 'browser', '--outdir', 'build'], { cwd: consumer, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error('Copied chart browser build failed:\n' + stdout + '\n' + stderr);
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(consumer, 'build/index.js')).exists()).toBe(true);
  } finally {
    // Only this exact newly allocated synthetic source-copy consumer is disposable.
    await rm(consumer, { recursive: true, force: true });
  }
}, 60_000);
