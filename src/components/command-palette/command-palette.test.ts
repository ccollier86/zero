import { expect, test } from 'bun:test';
import { filterCommandPaletteItems } from './command-palette';

test('rich palette filtering combines independent terms, descriptions, keywords and group selection', () => {
  const items = [{ id: '1', label: 'Billing guide', description: 'Manage invoices', group: 'posts', keywords: ['Finance'] }, { id: '2', label: 'Avery', group: 'people' }];
  expect(filterCommandPaletteItems(items, 'FINANCE invoice').map(item => item.id)).toEqual(['1']);
  expect(filterCommandPaletteItems(items, '', 'people').map(item => item.id)).toEqual(['2']);
  expect(filterCommandPaletteItems(items, 'missing')).toEqual([]);
});
test('result windows remain bounded, and filtering does not mutate caller records', () => {
  const items = Object.freeze(Array.from({ length: 1000 }, (_, id) => Object.freeze({ id: String(id), label: `Result ${id}` })));
  expect(filterCommandPaletteItems(items, '')).toHaveLength(20); expect(filterCommandPaletteItems(items, '', undefined, Infinity)).toHaveLength(20);
  expect(filterCommandPaletteItems(items, '', undefined, 10000)).toHaveLength(100); expect(items[0]?.label).toBe('Result 0');
});
