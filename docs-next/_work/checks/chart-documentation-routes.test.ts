/** Stable IDs/heading anchors captured before the 2026-10-10 chart manual move. */
import { expect, test } from 'bun:test';
import { parseDocumentationPage } from './markdown';

const root = new URL('../../', import.meta.url);

// This freezes retained-path compatibility obligations, not API/example text.
// Full examples belong only to canonical manuals and compile in charts-examples.
const manuals = [
  {
    old: 'frontend/components/charts.md', canonical: 'frontend/charts/sankey.md',
    id: 'zero.frontend.components.charts', anchors: [
      'zero-charts-and-sankey-flow', 'aggregate-data', 'interaction-and-presentation',
      'custom-inspectors', 'reactive-aggregate-collections', 'safe-color-overrides',
      'headless-flow-math', 'related-guides-and-next-steps',
    ],
  },
  {
    old: 'frontend/components/race-bar-chart.md', canonical: 'frontend/charts/race-bar.md',
    id: 'zero.frontend.components.race-bar-chart', anchors: [
      'race-bar-chart', 'start-with-an-ordered-history', 'identity-admission-and-updates',
      'settings-and-defaults', 'controlled-state-and-callbacks',
      'commands-and-inspector-composition', 'reactive-rollup-history',
      'headless-ranking-math', 'theme-and-related-work',
    ],
  },
  {
    old: 'frontend/components/funnel-chart.md', canonical: 'frontend/charts/funnel.md',
    id: 'zero.frontend.components.funnel-chart', anchors: [
      'funnel-chart', 'start-with-a-conversion-cohort', 'identity-and-admission',
      'settings-and-defaults', 'controlled-state-and-commands',
      'inspector-and-accessible-data', 'reactive-cohort-aggregates',
      'headless-cohort-math', 'shared-design-language', 'qualification',
    ],
  },
  {
    old: 'frontend/components/arc-charts.md', canonical: 'frontend/charts/arc.md',
    id: 'zero.frontend.components.arc-charts', anchors: [
      'arc-charts', 'choosing-a-chart', 'static-data', 'data-integrity-and-limits',
      'controls-and-defaults', 'reactive-zero-data', 'inspection-and-accessibility',
      'tokens-and-composition',
    ],
  },
  {
    old: 'frontend/components/native-charts.md', canonical: 'frontend/charts/native.md',
    id: 'zero.frontend.components.native-charts', anchors: [
      'handmade-charts', 'public-entries', 'choose-the-geometry', 'static-composition',
      'cartesian-settings', 'statistical-and-polar-settings', 'reactive-zero-data',
      'observed-time-streams-and-inspection', 'headless-math-integrity-and-budgets',
      'tokens-motion-and-verification',
    ],
  },
] as const;

for (const manual of manuals) {
  test(`${manual.id}: one canonical manual retains identity and all former section routes`, async () => {
    const canonicalText = await Bun.file(new URL(manual.canonical, root)).text();
    const compatibilityText = await Bun.file(new URL(manual.old, root)).text();
    const canonical = parseDocumentationPage(canonicalText);
    const compatibility = parseDocumentationPage(compatibilityText);

    expect(canonical.metadata.id).toBe(manual.id);
    expect(compatibility.metadata.id).toBe(`${manual.id}.compatibility`);
    expect(canonical.metadata.type).toBe('reference');
    expect(compatibility.metadata.type).toBe('reference');
    expect(compatibility.metadata.status).toBe('draft');
    expect(compatibility.metadata.visibility).toBe('internal');

    for (const anchor of manual.anchors) {
      expect(canonical.anchors.has(anchor), `${manual.canonical}#${anchor}`).toBe(true);
      expect(compatibility.anchors.has(anchor), `${manual.old}#${anchor}`).toBe(true);
      const target = new URL(`${manual.canonical}#${anchor}`, root).href;
      expect(compatibility.links.some(link => new URL(link, new URL(manual.old, root)).href === target)).toBe(true);
    }

    expect([...canonicalText.matchAll(/^```tsx?\n([\s\S]*?)^```/gm)]).toHaveLength(5);
    expect([...compatibilityText.matchAll(/^(`{3,}|~{3,})/gm)]).toHaveLength(0);
    const parent = new URL('frontend/charts/index.md', root).pathname;
    expect(canonical.links.some(link => new URL(link, new URL(manual.canonical, root)).pathname === parent)).toBe(true);
  });
}

test('chart subsystem navigation and retained routes have independent unique IDs', async () => {
  const overviewPath = 'frontend/charts/index.md';
  const overview = parseDocumentationPage(await Bun.file(new URL(overviewPath, root)).text());
  const componentsPath = 'frontend/components/index.md';
  const components = parseDocumentationPage(await Bun.file(new URL(componentsPath, root)).text());
  const ids: unknown[] = [];
  let examples = 0;
  for (const manual of manuals) {
    const canonicalPath = new URL(manual.canonical, root).pathname;
    const oldPath = new URL(manual.old, root).pathname;
    expect(overview.links.some(link => new URL(link, new URL(overviewPath, root)).pathname === canonicalPath)).toBe(true);
    expect(components.links.some(link => new URL(link, new URL(componentsPath, root)).pathname === oldPath)).toBe(true);
    for (const path of [manual.canonical, manual.old]) {
      const text = await Bun.file(new URL(path, root)).text();
      ids.push(parseDocumentationPage(text).metadata.id);
      examples += [...text.matchAll(/^```tsx?\n([\s\S]*?)^```/gm)].length;
    }
  }
  expect(new Set(ids).size).toBe(10);
  expect(examples).toBe(25);
  expect(manuals.reduce((count, manual) => count + manual.anchors.length, 0)).toBe(45);
});
