/** Measures first-draft guide placement, not behavior/security/release correctness. */
import { parseDocumentationPage } from './markdown';
import { inventoryFeatureDestinations } from './coverage-parser';

const root = new URL('../../', import.meta.url);
const inventoryRoot = new URL('_work/audits/systems/', root);
const systems: Array<{ system: string; featureGroups: number; drafted: number; missing: string[] }> = [];

for (const filename of new Bun.Glob('*.md').scanSync({ cwd: inventoryRoot.pathname, onlyFiles: true })) {
  if (filename === 'index.md') continue;
  const url = new URL(filename, inventoryRoot);
  const source = await Bun.file(url).text();
  const page = parseDocumentationPage(source);
  const rows = inventoryFeatureDestinations(source);
  let drafted = 0;
  const missing: string[] = [];
  for (const row of rows) {
    const target = row.destination?.startsWith('docs-next/')
      ? new URL(row.destination.slice('docs-next/'.length), root)
      : row.destination ? new URL(row.destination, url) : undefined;
    if (target && await Bun.file(target).exists()) drafted += 1;
    else missing.push(row.feature);
  }
  systems.push({ system: String(page.metadata.system ?? filename.replace('.md', '')),
    featureGroups: rows.length, drafted, missing });
}
systems.sort((left, right) => left.system.localeCompare(right.system));
console.log(JSON.stringify({
  kind: 'draft-placement-only',
  systems: systems.length,
  featureGroups: systems.reduce((count, system) => count + system.featureGroups, 0),
  draftedFeatureGroups: systems.reduce((count, system) => count + system.drafted, 0),
  fullyPlacedSystems: systems.filter(system => system.featureGroups > 0 && system.missing.length === 0).length,
  coverage: systems,
}, null, 2));
