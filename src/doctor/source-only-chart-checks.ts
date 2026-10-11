/**
 * Read-only chart migration inventory over admitted source. Resolves import,
 * alias and local re-export identity with the existing bounded binding graph;
 * never executes chart data, rewrites consumers or marks supported Recharts broken.
 */
import ts from 'typescript';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import type { SourceOnlyFile } from './source-only-types';
import type { SourceOnlyUpgradeTargetInspection } from './source-only-upgrade-types';
import { createUpgradeBindingGraph, isUpgradePublicSpecifier } from './source-only-upgrade-bindings';
import { getSourceOnlyUpgradeCatalog } from './source-only-upgrade-catalog';

const replacements: Readonly<Record<string, readonly string[]>> = Object.freeze({
  LineChart: ['XYLineChart'], AreaChart: ['AreaChart'], BarChart: ['GroupedBarChart', 'StackedBarChart', 'HorizontalBarChart'],
  ComposedChart: ['ComposedChart'], ScatterChart: ['ScatterChart', 'BubbleChart'],
  PieChart: ['PieChart'], RadarChart: ['RadarChart'], RadialBarChart: ['RadialBarChart'],
  Sankey: ['SankeyChart'], FunnelChart: ['FunnelChart'], Treemap: ['Treemap'],
});
const legacyParts = new Set(['ChartContainer', 'ChartTooltip', 'ChartTooltipContent', 'ChartLegend', 'ChartLegendContent', 'ChartStyle']);
const docs = './docs-next/frontend/charts/index.md';
const dependencyRule = getSourceOnlyUpgradeCatalog().find(rule => rule.detector === 'chart-dependency')!;
const usageRule = getSourceOnlyUpgradeCatalog().find(rule => rule.detector === 'chart-usage')!;

/** Inventory proven legacy dependencies and rendered chart families against an actual upgrade target. */
export async function checkSourceOnlyCharts(files: readonly SourceOnlyFile[], target: SourceOnlyUpgradeTargetInspection): Promise<PlatformDoctorFinding[]> {
  const graph = createUpgradeBindingGraph(files, specifier => isUpgradePublicSpecifier(specifier) || specifier === 'recharts');
  const findings: PlatformDoctorFinding[] = [];
  const inspections = new Map<string, ReturnType<SourceOnlyUpgradeTargetInspection['inspectNamedExport']>>();
  const available = async (name: string) => {
    const specifier = name === 'Treemap' ? '@zero/framework/components/charts/arc' : '@zero/framework/components/charts';
    const key = `${specifier}\0${name}`;
    if (!inspections.has(key)) inspections.set(key, target.inspectNamedExport(specifier, name, 'value'));
    return (await inspections.get(key)!).status;
  };
  const facade = await available('ZeroChart');
  for (const module of graph.modules) {
    if (!module.parsed) continue; // Existing parser/upgrade coverage findings retain their owner.
    const reported = new Set<string>();
    const add = (node: ts.Node, code: string, message: string, hint: string) => {
      const line = module.file.getLineAndCharacterOfPosition(node.getStart(module.file)).line + 1;
      findings.push({ code, severity: 'info', category: 'manual-review', confidence: 'high',
        path: `${module.input.path}:${line}`, line, message, hint, docs });
    };
    // Import evidence is a dependency inventory, not a claim that the chart is rendered.
    for (const reference of graph.references(module)) {
      const binding = reference.binding;
      if (binding.typeOnly) continue;
      const legacy = binding.specifier === 'recharts' || isUpgradePublicSpecifier(binding.specifier) && legacyParts.has(binding.name);
      if (!legacy || reported.has('dependency')) continue;
      reported.add('dependency');
      add(reference.node, dependencyRule.code,
        'This source retains a Recharts or legacy Zero chart dependency. It remains supported; inspect it as a migration candidate.',
        facade === 'available'
          ? 'The inspected target exposes ZeroChart. Inventory series, axes, stacking, formatters, tooltip/legend behavior, responsive sizing and data subscriptions before selecting a replacement. Do not mechanically rename imports.'
          : 'New chart-facade availability is unproven or absent in the inspected target. Keep the existing chart and verify the intended package before planning a replacement.');
    }
    const pending: ts.Node[] = [module.file];
    while (pending.length) {
      const node = pending.pop()!;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        if (!ts.isJsxNamespacedName(opening.tagName)) {
          const binding = graph.expression(module, opening.tagName);
          if (binding.kind === 'named' && !binding.typeOnly && binding.specifier === 'recharts') {
            const candidates = replacements[binding.name];
            if (candidates && !reported.has(binding.name)) {
              reported.add(binding.name);
              const inspected = await Promise.all(candidates.map(available));
              const known = candidates.filter((_, index) => inspected[index] === 'available');
              add(opening.tagName, usageRule.code,
                `A rendered Recharts ${binding.name} is a chart-migration candidate, not an unsupported API.`,
                known.length
                  ? `Verified replacement candidates: ${known.join(', ')}. Map the actual data model, dimensions, grouping, null/negative values, interaction and query projection explicitly. Existing custom callbacks and server authority remain app-owned.`
                  : 'No matching replacement was verified in the inspected target. Keep this implementation and review the chart catalog; compatible legacy usage is not a migration error.');
            }
          }
        }
      }
      ts.forEachChild(node, child => { pending.push(child); });
    }
  }
  return findings;
}
