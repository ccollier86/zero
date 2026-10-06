import { describe, expect, test } from 'bun:test';
import { loadCascaderBranch } from './cascader-branch-navigation';
import { CascaderLoadController } from './cascader-load-controller';
import { buildCascaderIndex } from './cascader-model';
import type { CascaderIndexEntry, CascaderNode } from './cascader.types';

const organization: CascaderNode = { value: 'organization', label: 'Organization', hasChildren: true };
const table: CascaderNode = { value: 'organization/table', label: 'Table', hasChildren: true };
const column: CascaderNode = { value: 'organization/table/column', label: 'Column', hasChildren: true };
const leaf: CascaderNode = { value: 'organization/table/column/read', label: 'Read' };

function entry(nodes: readonly CascaderNode[]): CascaderIndexEntry {
  const node = nodes.at(-1)!;
  const labels = nodes.map((item) => item.label);
  return { node, path: nodes.map((item) => item.value), labelPath: labels,
    pathLabel: labels.join(' / '), children: node.children ?? [],
    hasChildren: node.hasChildren === true || !!node.children?.length,
    disabled: nodes.some((item) => item.disabled === true) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('loadCascaderBranch', () => {
  test('a remote unknown path loads roots, ancestors and target in order before navigation', async () => {
    const calls: (string | null)[] = [];
    const responses = new Map<string | null, readonly CascaderNode[]>([
      [null, [organization]], [organization.value, [table]], [table.value, [column]], [column.value, [leaf]],
    ]);
    const controller = new CascaderLoadController({
      items: [], getChildren: async (node) => {
        const key = node?.value ?? null;
        calls.push(key);
        return responses.get(key)!;
      },
    });
    const result = await loadCascaderBranch(entry([organization, table, column]), {
      items: [], load: controller.load, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true,
    });
    expect(calls).toEqual([null, organization.value, table.value, column.value]);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected admitted branch.');
    expect(result.entry.path).toEqual([organization.value, table.value, column.value]);
    expect(result.entry.pathLabel).toBe('Organization / Table / Column');
    expect(result.entry.children).toEqual([leaf]);
    expect(result.entry).toEqual(buildCascaderIndex([], controller.getLoadedChildren()).byValue.get(column.value)!);
  });

  test('already known ancestors are not refetched but a cached/static target still calls load', async () => {
    const staticColumn = { ...column, children: [leaf] };
    const staticTable = { ...table, children: [staticColumn] };
    const staticOrganization = { ...organization, children: [staticTable] };
    const calls: (string | null)[] = [];
    const items = [staticOrganization];
    const controller = new CascaderLoadController({ items, getChildren: async () => { throw new Error('No network needed'); } });
    const options = { items, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true,
      load: (node: CascaderNode | null) => { calls.push(node?.value ?? null); return controller.load(node); } };
    expect((await loadCascaderBranch(entry([organization, table, column]), options)).status).toBe('ready');
    expect((await loadCascaderBranch(entry([organization, table, column]), options)).status).toBe('ready');
    expect(calls).toEqual([column.value, column.value]);
  });

  test('static target navigation retires an obsolete pending adapter load', async () => {
    const obsolete = { value: 'obsolete', label: 'Obsolete', hasChildren: true };
    const staticTarget = { ...column, children: [leaf] };
    const response = deferred<readonly CascaderNode[]>();
    let signal: AbortSignal | undefined;
    const items = [obsolete, staticTarget];
    const controller = new CascaderLoadController({
      items, getChildren: (_, context) => { signal = context.signal; return response.promise; },
    });
    const pending = controller.load(obsolete);
    await tick();
    const result = await loadCascaderBranch(entry([staticTarget]), {
      items, load: controller.load, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true,
    });
    expect(result.status).toBe('ready');
    expect(signal?.aborted).toBe(true);
    expect(await pending).toBe(false);
    response.resolve([{ value: 'late', label: 'Late' }]);
    await tick();
    expect(controller.getLoadedChildren().has(obsolete.value)).toBe(false);
  });

  test('target failure never supplies a navigable entry and rerunning the same trail retries it', async () => {
    let attempts = 0;
    const items = [{ ...organization, children: [table] }];
    const controller = new CascaderLoadController({ items, getChildren: async () => {
      if (++attempts === 1) throw new Error('Private provider failure');
      return [leaf];
    } });
    const options = { items, load: controller.load, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true };
    const failed = await loadCascaderBranch(entry([organization, table]), options);
    expect(failed).toEqual({ status: 'failed' });
    expect(JSON.stringify(failed)).not.toContain('Private');
    const ready = await loadCascaderBranch(entry([organization, table]), options);
    expect(ready.status).toBe('ready');
    expect(attempts).toBe(2);
  });

  test('a successful empty target stays at its parent and becomes a selectable leaf', async () => {
    const emptyTarget = { ...table, children: [] };
    const items = [{ ...organization, children: [emptyTarget] }];
    const controller = new CascaderLoadController({ items, getChildren: async () => [] });
    const result = await loadCascaderBranch(entry([organization, emptyTarget]), {
      items, load: controller.load, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true,
    });
    expect(result).toEqual({ status: 'empty' });
    const admitted = buildCascaderIndex(items, controller.getLoadedChildren()).byValue.get(table.value)!;
    expect(admitted.hasChildren).toBe(false);
    expect(admitted.children).toEqual([]);
  });

  test('a globally known ID on another ancestor chain is unavailable, not silently rerouted', async () => {
    const other = { value: 'other', label: 'Other', children: [{ ...table, children: [leaf] }] };
    const wrongParent = { ...organization, children: [{ value: 'different', label: 'Different' }] };
    const items = [wrongParent, other];
    const calls: string[] = [];
    const controller = new CascaderLoadController({ items });
    const result = await loadCascaderBranch(entry([organization, table]), {
      items, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true,
      load: (node) => { calls.push(node?.value ?? 'root'); return controller.load(node); },
    });
    expect(result).toEqual({ status: 'missing' });
    expect(calls).toEqual([organization.value]);
  });

  test('an absent ancestor or unavailable root leaves navigation unchanged', async () => {
    const items = [organization];
    const controller = new CascaderLoadController({ items, getChildren: async () => [] });
    const result = await loadCascaderBranch(entry([organization, table]), {
      items, load: controller.load, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true,
    });
    expect(result).toEqual({ status: 'missing' });
    const rootless = new CascaderLoadController({ items: [], getChildren: async () => [] });
    expect(await loadCascaderBranch(entry([organization, table]), {
      items: [], load: rootless.load, getLoadedChildren: rootless.getLoadedChildren, isCurrent: () => true,
    })).toEqual({ status: 'missing' });
  });

  test('disabled canonical ancestors remain unavailable even if the remote path says otherwise', async () => {
    const items = [{ ...organization, disabled: true, children: [{ ...table, children: [leaf] }] }];
    let calls = 0;
    const result = await loadCascaderBranch(entry([organization, table]), {
      items, getLoadedChildren: () => new Map(), isCurrent: () => true,
      load: async () => { calls++; return true; },
    });
    expect(result).toEqual({ status: 'missing' });
    expect(calls).toBe(0);
  });

  test('an unresolved branch without an adapter cannot open a fabricated empty child level', async () => {
    const controller = new CascaderLoadController({ items: [organization] });
    expect(await loadCascaderBranch(entry([organization]), {
      items: [organization], load: controller.load, getLoadedChildren: controller.getLoadedChildren, isCurrent: () => true,
    })).toEqual({ status: 'missing' });
  });

  test('a superseded intent during ancestral wait wins over success and prevents loading its descendants', async () => {
    const response = deferred<readonly CascaderNode[]>();
    const calls: string[] = [];
    let revision = 1;
    const intent = revision;
    const controller = new CascaderLoadController({ items: [organization], getChildren: (node) => {
      calls.push(node!.value);
      return response.promise;
    } });
    const pending = loadCascaderBranch(entry([organization, table]), {
      items: [organization], load: controller.load, getLoadedChildren: controller.getLoadedChildren,
      isCurrent: () => revision === intent,
    });
    await tick();
    revision = 2;
    revision = 3; // Returning to the same query/scope still has a newer intent.
    response.resolve([table]);
    expect(await pending).toEqual({ status: 'stale' });
    expect(calls).toEqual([organization.value]);
  });

  test('late failure/rejection after scope change is stale rather than a current retry target', async () => {
    const response = deferred<boolean>();
    let current = true;
    const pending = loadCascaderBranch(entry([organization]), {
      items: [organization], getLoadedChildren: () => new Map(), isCurrent: () => current,
      load: () => response.promise,
    });
    await tick();
    current = false;
    response.reject(new Error('old source failure'));
    expect(await pending).toEqual({ status: 'stale' });
    let calls = 0;
    expect(await loadCascaderBranch(entry([organization]), {
      items: [organization], getLoadedChildren: () => new Map(), isCurrent: () => false,
      load: async () => { calls++; return false; },
    })).toEqual({ status: 'stale' });
    expect(calls).toBe(0);
  });

  test('rejected current adapter calls become generic failure without exposing their reason', async () => {
    const result = await loadCascaderBranch(entry([organization]), {
      items: [organization], getLoadedChildren: () => new Map(), isCurrent: () => true,
      load: async () => { throw new Error('secret source detail'); },
    });
    expect(result).toEqual({ status: 'failed' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
