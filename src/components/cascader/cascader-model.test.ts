/**
 * cascader-model.test.ts
 *
 * Verifies tree admission, full-path search, and bounded selection without React
 * or network fixtures. Async lifecycle and accessible rendering are tested by
 * their respective controller and component suites.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildCascaderIndex,
  getCascaderLevel,
  searchCascaderIndex,
  updateCascaderSelection,
} from './cascader-model';
import type { CascaderNode } from './cascader.types';

function fixtures(): CascaderNode[] {
  return [
    {
      value: 'people', label: 'People', keywords: ['users'], children: [
        { value: 'people.name', label: 'Name', description: 'The public display name' },
        { value: 'people.email', label: 'Email', keywords: ['contact'] },
      ],
    },
    {
      value: 'projects', label: 'Projects', children: [
        { value: 'projects.name', label: 'Name' },
        {
          value: 'projects.settings', label: 'Settings', children: [
            { value: 'projects.settings.notifications', label: 'Notifications' },
          ],
        },
      ],
    },
    { value: 'lazy', label: 'Lazy branch', hasChildren: true },
    { value: 'empty', label: 'Empty branch', children: [] },
  ];
}

describe('Cascader effective tree index', () => {
  test('indexes all levels with globally unique IDs and distinct repeated labels', () => {
    const index = buildCascaderIndex(fixtures());
    expect(index.byValue.size).toBe(9);
    expect(index.byValue.get('people.name')?.path).toEqual(['people', 'people.name']);
    expect(index.byValue.get('people.name')?.labelPath).toEqual(['People', 'Name']);
    expect(index.byValue.get('people.name')?.pathLabel).toBe('People / Name');
    expect(index.byValue.get('projects.name')?.pathLabel).toBe('Projects / Name');
    expect(index.byValue.get('projects.settings.notifications')?.path).toEqual([
      'projects', 'projects.settings', 'projects.settings.notifications',
    ]);
    expect(index.byValue.get('lazy')?.hasChildren).toBe(true);
    expect(index.byValue.get('empty')?.hasChildren).toBe(false);
  });

  test('navigation validates the complete branch path rather than only its last ID', () => {
    const index = buildCascaderIndex(fixtures());
    expect(getCascaderLevel(index, []).map(({ node }) => node.value))
      .toEqual(['people', 'projects', 'lazy', 'empty']);
    expect(getCascaderLevel(index, ['projects']).map(({ node }) => node.value))
      .toEqual(['projects.name', 'projects.settings']);
    expect(getCascaderLevel(index, ['projects', 'projects.settings']).map(({ node }) => node.value))
      .toEqual(['projects.settings.notifications']);
    expect(getCascaderLevel(index, ['people', 'projects.settings'])).toEqual([]);
    expect(getCascaderLevel(index, ['projects.settings'])).toEqual([]);
    expect(getCascaderLevel(index, ['missing'])).toEqual([]);
    expect(getCascaderLevel(index, ['people', 'people.name'])).toEqual([]);
  });

  test('completed loads replace children and preserve their full ancestry', () => {
    const index = buildCascaderIndex(fixtures(), new Map([
      ['people', [{ value: 'people.phone', label: 'Phone' }]],
      ['lazy', [{ value: 'lazy.country', label: 'Country' }]],
      ['orphan', [{ value: 'orphan.secret', label: 'Stale result' }]],
    ]));
    expect(index.byValue.has('people.name')).toBe(false);
    expect(index.byValue.get('people.phone')?.pathLabel).toBe('People / Phone');
    expect(index.byValue.get('lazy.country')?.path).toEqual(['lazy', 'lazy.country']);
    expect(index.byValue.has('orphan.secret')).toBe(false);
    expect(getCascaderLevel(index, ['lazy']).map(({ node }) => node.value)).toEqual(['lazy.country']);
  });

  test('empty completed lazy loads become leaves instead of perpetual loading branches', () => {
    const index = buildCascaderIndex(fixtures(), new Map([['lazy', []], ['people', []]]));
    expect(index.byValue.get('lazy')?.hasChildren).toBe(false);
    expect(index.byValue.get('people')?.hasChildren).toBe(false);
    expect(index.byValue.has('people.name')).toBe(false);
  });

  test('an optional completed root load replaces roots rather than appending another scope', () => {
    const index = buildCascaderIndex(fixtures(), new Map([
      [null, [{ value: 'replacement', label: 'Replacement' }]],
    ]));
    expect(index.byValue.size).toBe(1);
    expect(index.roots.map((node) => node.value)).toEqual(['replacement']);
    expect(index.byValue.has('people')).toBe(false);
  });

  test('propagates disabled ancestry while retaining nodes for display and search', () => {
    const index = buildCascaderIndex([
      { value: 'disabled', label: 'Disabled', disabled: true, children: [
        { value: 'nested', label: 'Nested', disabled: false, children: [
          { value: 'leaf', label: 'Leaf' },
        ] },
      ] },
    ]);
    expect(index.byValue.get('disabled')?.disabled).toBe(true);
    expect(index.byValue.get('nested')?.disabled).toBe(true);
    expect(index.byValue.get('leaf')?.disabled).toBe(true);
    expect(searchCascaderIndex(index, 'leaf').map(({ node }) => node.value)).toEqual(['leaf']);
  });

  test('snapshots arrays and path metadata without freezing or modifying application nodes', () => {
    const children: CascaderNode[] = [{ value: 'leaf', label: 'Leaf' }];
    const items: CascaderNode[] = [{ value: 'root', label: 'Root', children }];
    const index = buildCascaderIndex(items);
    children.push({ value: 'later', label: 'Later' });
    items.push({ value: 'another', label: 'Another' });
    expect(index.roots.length).toBe(1);
    expect(index.byValue.get('root')?.children.length).toBe(1);
    expect(index.byValue.has('later')).toBe(false);
    expect(Object.isFrozen(index.roots)).toBe(true);
    expect(Object.isFrozen(index.byValue.get('leaf')?.path)).toBe(true);
    expect(Object.isFrozen(index.byValue.get('leaf')?.labelPath)).toBe(true);
    expect(Object.isFrozen(items[0])).toBe(false);
  });

  test('preserves arbitrary stable string IDs and typed data without delimiter collisions', () => {
    const index = buildCascaderIndex([
      { value: '__proto__', label: 'Prototype', data: { code: 3 }, children: [
        { value: 'with / separator', label: 'Slash', data: { code: 7 } },
      ] },
    ]);
    expect(index.byValue.get('with / separator')?.path).toEqual(['__proto__', 'with / separator']);
    expect(index.byValue.get('__proto__')?.node.data?.code).toBe(3);
  });

  test('rejects duplicate values across branches, including completed async children', () => {
    const duplicate = [{ value: 'same', label: 'First' }, { value: 'same', label: 'Second' }];
    expect(() => buildCascaderIndex(duplicate)).toThrow('globally unique values');
    expect(() => buildCascaderIndex(fixtures(), new Map([
      ['lazy', [{ value: 'people.name', label: 'Duplicate after load' }]],
    ]))).toThrow('duplicated');
  });

  test('rejects cycles with a useful error before recursing forever', () => {
    const node: CascaderNode = { value: 'cycle', label: 'Cycle' };
    node.children = [node];
    expect(() => buildCascaderIndex([node])).toThrow('cycle');
    const lazy: CascaderNode = { value: 'lazy', label: 'Lazy', hasChildren: true };
    expect(() => buildCascaderIndex([lazy], new Map([['lazy', [lazy]]]))).toThrow('cycle');
  });

  test.each([
    [null, 'must be an object'],
    [{ value: '', label: 'Name' }, 'nonempty string value'],
    [{ value: '  ', label: 'Name' }, 'nonempty string value'],
    [{ value: 42, label: 'Name' }, 'nonempty string value'],
    [{ value: 'id', label: '' }, 'nonempty label'],
    [{ value: 'id', label: 'Name', children: {} }, 'children'],
    [{ value: 'id', label: 'Name', keywords: [42] }, 'keywords'],
    [{ value: 'id', label: 'Name', disabled: 'yes' }, 'flags'],
    [{ value: 'id', label: 'Name', hasChildren: 1 }, 'flags'],
    [{ value: 'id', label: 'Name', description: {} }, 'description'],
  ])('rejects malformed option %#', (node, message) => {
    expect(() => buildCascaderIndex([node as CascaderNode])).toThrow(message as string);
  });

  test('rejects malformed root arrays and completed child lists', () => {
    expect(() => buildCascaderIndex({} as CascaderNode[])).toThrow('root options');
    expect(() => buildCascaderIndex([], new Map([
      [null, null as unknown as CascaderNode[]],
    ]))).toThrow('root options');
    expect(() => buildCascaderIndex(fixtures(), new Map([
      ['lazy', null as unknown as CascaderNode[]],
    ]))).toThrow('Loaded Cascader children');
  });
});

describe('Cascader deep path search', () => {
  test('matches repeated leaf names with distinct path annotations', () => {
    const results = searchCascaderIndex(buildCascaderIndex(fixtures()), 'name');
    expect(results.map(({ pathLabel }) => pathLabel)).toEqual(['People / Name', 'Projects / Name']);
  });

  test('matches multiple tokens across ancestors, keywords, and own labels', () => {
    const index = buildCascaderIndex(fixtures());
    expect(searchCascaderIndex(index, 'people name').map(({ node }) => node.value)).toEqual(['people.name']);
    expect(searchCascaderIndex(index, 'users contact').map(({ node }) => node.value)).toEqual(['people.email']);
    expect(searchCascaderIndex(index, 'projects notifications').map(({ node }) => node.value))
      .toEqual(['projects.settings.notifications']);
    expect(searchCascaderIndex(index, 'display public').map(({ node }) => node.value)).toEqual(['people.name']);
    expect(searchCascaderIndex(index, 'not in tree')).toEqual([]);
  });

  test('searches branches as well as leaves, without pretending unloaded children exist', () => {
    const index = buildCascaderIndex(fixtures());
    expect(searchCascaderIndex(index, 'settings').map(({ node }) => node.value))
      .toEqual(['projects.settings', 'projects.settings.notifications']);
    expect(searchCascaderIndex(index, 'lazy').map(({ node }) => node.value)).toEqual(['lazy']);
    expect(searchCascaderIndex(index, 'country')).toEqual([]);
    const loaded = buildCascaderIndex(fixtures(), new Map([
      ['lazy', [{ value: 'lazy.country', label: 'Country' }]],
    ]));
    expect(searchCascaderIndex(loaded, 'country').map(({ node }) => node.value)).toEqual(['lazy.country']);
  });

  test('normalizes accents, case, and whitespace while retaining canonical labels', () => {
    const index = buildCascaderIndex([
      { value: 'team', label: 'Équipe', children: [{ value: 'team.resume', label: 'Résumé' }] },
    ]);
    const result = searchCascaderIndex(index, '  EQUIPE  resume  ');
    expect(result[0]?.pathLabel).toBe('Équipe / Résumé');
    expect(searchCascaderIndex(index, '  ')).toEqual([]);
  });

  test('prioritizes exact/prefix labels and keeps tree order for equal matches', () => {
    const index = buildCascaderIndex([
      { value: 'parent', label: 'Contact', children: [{ value: 'nested', label: 'Other' }] },
      { value: 'contains', label: 'Emergency contact' },
      { value: 'prefix', label: 'Contact details' },
      { value: 'exact', label: 'Contact' },
    ]);
    expect(searchCascaderIndex(index, 'contact').map(({ node }) => node.value))
      .toEqual(['parent', 'exact', 'prefix', 'contains', 'nested']);
  });
});

describe('Cascader leaf selection', () => {
  const index = buildCascaderIndex(fixtures());

  test('adds and removes leaves with stable deduplicated values', () => {
    expect(updateCascaderSelection(index, [], 'people.name')).toEqual({
      values: ['people.name'], changed: true,
    });
    expect(updateCascaderSelection(index, ['people.name', 'people.name'], 'people.email')).toEqual({
      values: ['people.name', 'people.email'], changed: true,
    });
    expect(updateCascaderSelection(index, ['people.name', 'people.email'], 'people.name')).toEqual({
      values: ['people.email'], changed: true,
    });
  });

  test('enforces caps atomically while allowing removal at or above the cap', () => {
    expect(updateCascaderSelection(index, ['people.name'], 'people.email', { maxSelected: 1 }))
      .toEqual({ values: ['people.name'], changed: false, reason: 'selection-limit' });
    expect(updateCascaderSelection(index, ['people.name', 'people.email'], 'people.email', { maxSelected: 1 }))
      .toEqual({ values: ['people.name'], changed: true });
    expect(updateCascaderSelection(index, [], 'people.name', { maxSelected: 0 }))
      .toEqual({ values: [], changed: false, reason: 'selection-limit' });
    expect(updateCascaderSelection(index, ['people.name'], 'people.name', { maxSelected: 0 }))
      .toEqual({ values: [], changed: true });
  });

  test('single-select replaces the prior leaf without violating a cap of one', () => {
    expect(updateCascaderSelection(index, ['people.name'], 'projects.name', {
      multiple: false, maxSelected: 1,
    })).toEqual({ values: ['projects.name'], changed: true });
  });

  test('rejects branches, unknown IDs, and disabled ancestors', () => {
    expect(updateCascaderSelection(index, [], 'projects').reason).toBe('branch');
    expect(updateCascaderSelection(index, [], 'lazy').reason).toBe('branch');
    expect(updateCascaderSelection(index, [], 'missing').reason).toBe('unknown');
    const disabled = buildCascaderIndex([
      { value: 'root', label: 'Root', disabled: true, children: [{ value: 'leaf', label: 'Leaf' }] },
    ]);
    expect(updateCascaderSelection(disabled, [], 'leaf').reason).toBe('disabled');
    expect(updateCascaderSelection(index, [], 'empty').changed).toBe(true);
  });

  test('permits removal of a selected value after it becomes missing, disabled, or a branch', () => {
    expect(updateCascaderSelection(index, ['missing'], 'missing')).toEqual({ values: [], changed: true });
    expect(updateCascaderSelection(index, ['lazy'], 'lazy')).toEqual({ values: [], changed: true });
    const disabled = buildCascaderIndex([{ value: 'disabled', label: 'Disabled', disabled: true }]);
    expect(updateCascaderSelection(disabled, ['disabled'], 'disabled')).toEqual({ values: [], changed: true });
  });

  test('rejects malformed caps, including NaN, infinity, fractions, and unsafe integers', () => {
    for (const maxSelected of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => updateCascaderSelection(index, [], 'people.name', { maxSelected }))
        .toThrow('nonnegative safe integer');
    }
  });

  test('does not mutate or alias the caller selection, including rejected additions', () => {
    const values = ['people.name'];
    const added = updateCascaderSelection(index, values, 'people.email');
    const rejected = updateCascaderSelection(index, values, 'missing');
    values.push('projects.name');
    expect(added.values).toEqual(['people.name', 'people.email']);
    expect(rejected.values).toEqual(['people.name']);
    expect(Object.isFrozen(added.values)).toBe(true);
    expect(Object.isFrozen(rejected.values)).toBe(true);
  });
});
