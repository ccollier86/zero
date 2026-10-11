/** Bounded chart-origin and target fixtures; source is inspected, never executed. */
import { expect, test } from 'bun:test';
import { checkSourceOnlyCharts } from './source-only-chart-checks';
import type { SourceOnlyFile } from './source-only-types';
import type { SourceOnlyUpgradeTargetInspection, UpgradeEvidenceStatus } from './source-only-upgrade-types';

function target(status: UpgradeEvidenceStatus = 'available', missing: string[] = []): SourceOnlyUpgradeTargetInspection {
  return { summary: { status: 'explicit', version: '2.6.0', fingerprint: { algorithm: 'sha256', scope: 'bounded-public-source', value: 'fixture', complete: true, files: 1 },
    capabilities: { modalShow: status, dropdownInnerViewport: status, popoverViewport: status, contentCard: status, selectRichSlots: status } }, findings: [],
    async inspectNamedExport(_specifier, name) { return { status: missing.includes(name) ? 'missing' : status }; } };
}
const source = (text: string, path = 'app/page.tsx'): SourceOnlyFile => ({ path, source: text });

test('Recharts aliases and namespace usage are inventory, not errors; replacement advice is verified', async () => {
  const findings = await checkSourceOnlyCharts([source(`import {LineChart as Plot} from 'recharts';
import * as R from 'recharts';
const chart=<><Plot/><R.BarChart/></>;`)], target());
  expect(findings.filter(item => item.code === 'upgrade.chart.legacy_dependency')).toHaveLength(1);
  expect(findings.filter(item => item.code === 'upgrade.chart.legacy_usage')).toHaveLength(2);
  expect(findings.every(item => item.severity === 'info' && item.category === 'manual-review')).toBe(true);
  expect(findings.map(item => item.hint).join('\n')).toContain('XYLineChart');
  expect(findings.map(item => item.hint).join('\n')).toContain('StackedBarChart');
});

test('local reexports and immutable aliases retain their chart origin without executing source', async () => {
  const findings = await checkSourceOnlyCharts([
    source(`import {Plot} from './parts'; const Alias=Plot;const chart=<Alias/>;`),
    source(`export {AreaChart as Plot} from 'recharts';throw new Error('NEVER_EXECUTE');`, 'app/parts.ts'),
  ], target());
  expect(findings.some(item => item.code === 'upgrade.chart.legacy_usage' && item.path === 'app/page.tsx:1')).toBe(true);
  expect(JSON.stringify(findings)).not.toContain('NEVER_EXECUTE');
});

test('new chart families, native names, comments, strings and shadowed imports do not become legacy rendered usage', async () => {
  const findings = await checkSourceOnlyCharts([source(`import {XYLineChart, RadarChart} from '@zero/framework/components/charts';
import {LineChart} from '@zero/framework/components/charts/arc';
import {BarChart as Old} from 'recharts';
function local(Old:any){return <Old/>}
const text="<Old/>"; // <Old/>
const chart=<><XYLineChart/><RadarChart/><LineChart/></>;`)], target());
  expect(findings.map(item => item.code)).toEqual(['upgrade.chart.legacy_dependency']);
});

test('type-only imports and similarly named components from unrelated libraries are not migration candidates', async () => {
  const findings = await checkSourceOnlyCharts([source(`import type {LineChart} from 'recharts';
import {ChartContainer, BarChart} from 'other-kit';const chart=<><ChartContainer/><BarChart/></>;`)], target());
  expect(findings).toEqual([]);
});

test('legacy Zero wrappers are identified without requiring their replacement', async () => {
  const findings = await checkSourceOnlyCharts([source(`import {ChartContainer as Frame, ChartTooltipContent} from '@zero/framework/react';const chart=<Frame/>;`)], target());
  expect(findings).toMatchObject([{ code: 'upgrade.chart.legacy_dependency', severity: 'info' }]);
});

test('missing or unknown targets never claim replacement availability', async () => {
  for (const status of ['missing', 'unknown'] as const) {
    const findings = await checkSourceOnlyCharts([source(`import {LineChart} from 'recharts';const chart=<LineChart/>;`)], target(status));
    expect(findings.every(item => item.severity === 'info')).toBe(true);
    expect(findings.map(item => item.hint).join('\n')).not.toContain('Verified replacement candidates:');
  }
  const findings = await checkSourceOnlyCharts([source(`import {BarChart} from 'recharts';const chart=<BarChart/>;`)], target('available', ['StackedBarChart']));
  expect(findings.find(item => item.code === 'upgrade.chart.legacy_usage')?.hint).not.toContain('StackedBarChart');
});

test('malformed source remains a parser-coverage concern, not a guessed chart migration', async () => {
  expect(await checkSourceOnlyCharts([source(`import {LineChart} from 'recharts';const chart=<LineChart`)], target())).toEqual([]);
});
