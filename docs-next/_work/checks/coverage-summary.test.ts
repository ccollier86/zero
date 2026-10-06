import { expect, test } from 'bun:test';
import { summarizeInventoryCoverage } from './coverage-summary';

test('an existing but empty inventory is unmeasured, not fully placed', () => {
  expect(summarizeInventoryCoverage([
    { system: 'guardian', featureGroups: 2, drafted: 2, missing: [] },
    { system: 'docs-plugin', featureGroups: 0, drafted: 0, missing: [] },
  ])).toEqual({ kind: 'draft-placement-only', systems: 2, featureGroups: 2, draftedFeatureGroups: 2,
    fullyPlacedSystems: 1, unmeasuredSystems: ['docs-plugin'], coverage: [
      { system: 'guardian', featureGroups: 2, drafted: 2, missing: [] },
      { system: 'docs-plugin', featureGroups: 0, drafted: 0, missing: [] },
    ] });
});

test('missing destinations and inconsistent draft counts cannot become fully placed systems', () => {
  const summary = summarizeInventoryCoverage([
    { system: 'complete', featureGroups: 1, drafted: 1, missing: [] },
    { system: 'missing', featureGroups: 2, drafted: 1, missing: ['Second feature'] },
    { system: 'inconsistent', featureGroups: 2, drafted: 1, missing: [] },
  ]);
  expect(summary.fullyPlacedSystems).toBe(1); expect(summary.unmeasuredSystems).toEqual([]);
  expect(summary.featureGroups).toBe(5); expect(summary.draftedFeatureGroups).toBe(3);
});
