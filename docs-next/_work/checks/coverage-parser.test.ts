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
