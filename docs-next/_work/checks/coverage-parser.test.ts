import { expect, test } from 'bun:test';
import { inventoryFeatureDestinations } from './coverage-parser';

test('guide links need not occupy the final column and feature-prefixed names remain features', () => {
  expect(inventoryFeatureDestinations(`## Features And Documentation Coverage
| Feature | Evidence | Guide | Status |
| --- | --- | --- | --- |
| Feature bundle | names/a | [Guide](../../../backend/ai/index.md) | Authored |

## Later
`)).toEqual([{ feature: 'Feature bundle', destination: '../../../backend/ai/index.md' }]);
});
test('both rooted and section-relative literal guide plans are extracted', () => {
  expect(inventoryFeatureDestinations(`## Features And Documentation Coverage
| Feature | Guide |
| --- | --- |
| A | \`frontend/forms/index.md\` |
| B | \`docs-next/backend/fabric/realms.md\` |
`)).toEqual([{ feature: 'A', destination: 'docs-next/frontend/forms/index.md' },
    { feature: 'B', destination: 'docs-next/backend/fabric/realms.md' }]);
});
test('agent and command inventory variants retain their real feature rows', () => {
  expect(inventoryFeatureDestinations(`## Actual Files And Features
| Command/feature | Guide |
| --- | --- |
| Agent entrance | \`agents/tooling/entrypoints.md\` |
`)).toEqual([{ feature: 'Agent entrance', destination: 'docs-next/agents/tooling/entrypoints.md' }]);
});

test('optional plugin guide destinations use the same literal/link contract as existing sections', () => {
  expect(inventoryFeatureDestinations(`## Features And Documentation Coverage
| Feature | Evidence | Guide | Review status |
| --- | --- | --- | --- |
| Public reader | source | [Reader](../../../plugins/docs/reader.md) | Authored |
| Publication | source | \`docs-next/plugins/docs/publication.md\` | Authored |
| Search | source | \`plugins/docs/search.md\` | Authored |
| Internal note | source | [Working note](../../../_work/plugins/private.md) | Internal |
`)).toEqual([
    { feature: 'Public reader', destination: '../../../plugins/docs/reader.md' },
    { feature: 'Publication', destination: 'docs-next/plugins/docs/publication.md' },
    { feature: 'Search', destination: 'docs-next/plugins/docs/search.md' },
    { feature: 'Internal note' },
  ]);
});

test('the actual docs-plugin inventory has a measured feature table with existing canonical homes', async () => {
  const inventory = new URL('../audits/systems/docs-plugin.md', import.meta.url);
  const rows = inventoryFeatureDestinations(await Bun.file(inventory).text());
  expect(rows).toHaveLength(21);
  for (const row of rows) {
    expect(row.destination, row.feature).toBeDefined();
    const target = row.destination?.startsWith('docs-next/')
      ? new URL('../../' + row.destination.slice('docs-next/'.length), import.meta.url)
      : new URL(row.destination!, inventory);
    expect(await Bun.file(target).exists(), row.feature).toBe(true);
  }
});
