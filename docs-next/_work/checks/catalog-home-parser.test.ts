import { expect, test } from 'bun:test';
import { catalogHomes } from './catalog-home-parser';

test('literal destinations remain rooted in the reader tree, not the catalog folder', () => {
  expect(catalogHomes('| Named symbol | Surface | Home |\n| `useExample` | `package` | `frontend/sdk/http.md` |'))
    .toEqual([{ symbol: 'useExample', destination: 'frontend/sdk/http.md', rooted: true }]);
});

test('linked destinations retain anchors and do not confuse source evidence with homes', () => {
  expect(catalogHomes('| `Client` | `x \\| null` | [source](../../../../src/frontend/client/sdk.ts) | [guide](../../../frontend/sdk/http.md#query) |'))
    .toEqual([{ symbol: 'Client', destination: '../../../frontend/sdk/http.md#query', rooted: false }]);
});

test('a source-only row is unresolved instead of falsely covered', () => {
  expect(catalogHomes('| `Unassigned` | [source](../../../../src/file.ts) | pending |'))
    .toEqual([{ symbol: 'Unassigned', destination: null, rooted: false }]);
});
