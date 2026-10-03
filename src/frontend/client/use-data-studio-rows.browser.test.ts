/** Browser regression for stale-while-revalidate Data Studio row projection. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const TEST_TIMEOUT = 60_000;
let browser: Browser | undefined;
let browserLease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  browserLease = await acquirePlaywrightTestBrowser();
  browser = browserLease.browser;
  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'data-studio-rows-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  await writeFile(entrypoint, fixtureSource(
    join(import.meta.dir, 'use-data-studio-rows.ts'),
    join(import.meta.dir, 'data-studio-query-state.ts'),
  ));
  const result = await Bun.build({
    entrypoints: [entrypoint],
    root: process.cwd(),
    outdir: buildDir,
    naming: 'bundle.js',
    target: 'browser',
    format: 'iife',
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
}, TEST_TIMEOUT);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    browserLease?.release();
  }
}, TEST_TIMEOUT);

describe('useDataStudioRows browser projection', () => {
  browserTest('retains only the exact visible page while its authoritative cache refetches', async () => {
    const page = await openHarness();
    try {
      await expectSnapshot(page, { rows: 'Ada', total: '2', cached: true });

      await page.evaluate(() => window.__dataStudioRowsHarness.invalidate());
      await expectSnapshot(page, { rows: 'Ada', total: '2', cached: false });

      await page.evaluate(() => window.__dataStudioRowsHarness.resolve('Grace', 1));
      await expectSnapshot(page, { rows: 'Grace', total: '1', cached: true });

      await page.evaluate(() => window.__dataStudioRowsHarness.changeQuery());
      await expectSnapshot(page, { rows: '', total: '0', cached: false });

      await page.evaluate(() => window.__dataStudioRowsHarness.resolve('Filtered', 1));
      await expectSnapshot(page, { rows: 'Filtered', total: '1', cached: true });
      await page.evaluate(() => window.__dataStudioRowsHarness.invalidateAndChangeScope());
      await expectSnapshot(page, { rows: '', total: '0', cached: false });
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('reloads the active row query after an authoritative schema revision', async () => {
    const page = await openHarness();
    try {
      await page.waitForFunction(() => window.__dataStudioRowsHarness.schemaLoads() > 0);
      const previousLoads = await page.evaluate(() => (
        window.__dataStudioRowsHarness.schemaLoads()
      ));
      await page.evaluate(() => window.__dataStudioRowsHarness.bumpSchemaRevision());
      await page.waitForFunction((previous) => (
        window.__dataStudioRowsHarness.schemaLoads() > previous
      ), previousLoads);
      expect(await page.evaluate(() => window.__dataStudioRowsHarness.schemaLoads()))
        .toBeGreaterThan(previousLoads);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);
});

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath) throw new Error('Browser harness unavailable');
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__dataStudioRowsHarness === 'object');
  return page;
}

async function expectSnapshot(
  page: Page,
  expected: { readonly rows: string; readonly total: string; readonly cached: boolean },
): Promise<void> {
  await page.waitForFunction((value) => {
    const root = document.querySelector('[data-slot="row-projection"]');
    return root?.getAttribute('data-rows') === value.rows
      && root?.getAttribute('data-total') === value.total
      && window.__dataStudioRowsHarness.snapshot().cached === value.cached;
  }, expected);
  expect(await page.locator('[data-slot="row-projection"]').getAttribute('data-rows'))
    .toBe(expected.rows);
  expect(await page.locator('[data-slot="row-projection"]').getAttribute('data-total'))
    .toBe(expected.total);
}

function fixtureSource(hookPath: string, queryStatePath: string): string {
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { useDataStudioRows } from ${JSON.stringify(hookPath)};
import { useDataStudioRowQuery } from ${JSON.stringify(queryStatePath)};

const table = {
  tableId: 'table-one',
  key: 'contacts',
  name: 'Contacts',
  description: null,
  status: 'active',
  schema: {
    version: 1,
    columns: [{
      columnId: 'column-name', key: 'name', label: 'Name', type: 'text', required: true,
    }],
  },
  schemaRevision: 1,
  revision: 1,
  rowCount: 2,
  createdAt: 1,
  updatedAt: 1,
};
let boundaryKey = 'organization:one';
let query = { limit: 25, offset: 0, sortColumnId: 'column-name', sortDirection: 'asc' };
let cachedPage = makePage('Ada', 2);
const surface = {
  cache: {
    getRowPage() { return cachedPage; },
  },
};
let schemaTable = table;
let schemaLoads = 0;
const schemaSurface = {
  cache: { getRowPage() { return undefined; } },
  async listRows() {
    schemaLoads += 1;
    return makePage('Ada', 2);
  },
};
const root = createRoot(document.getElementById('root'));

function makePage(name, total) {
  return {
    rows: [{
      rowId: 'row-one',
      tableId: table.tableId,
      schemaRevision: 1,
      revision: 1,
      values: { 'column-name': name },
      createdAt: 1,
      updatedAt: 1,
    }],
    total,
    limit: 25,
    offset: 0,
    nextOffset: null,
  };
}

function Harness() {
  const [selectedRowId, setSelectedRowId] = React.useState(null);
  const [offset, setOffset] = React.useState(0);
  const [offsetHistory, setOffsetHistory] = React.useState([]);
  const selectedTableIdRef = React.useRef(table.tableId);
  const boundaryKeyRef = React.useRef(boundaryKey);
  const boundaryReadyRef = React.useRef(true);
  boundaryKeyRef.current = boundaryKey;
  const state = useDataStudioRows({
    surface,
    boundary: {
      key: boundaryKey,
      scopeKey: boundaryKey,
      dataRevision: 1,
      stable: true,
      ready: true,
      phase: 'idle',
    },
    scopeAvailable: true,
    shouldLoad: false,
    canRead: true,
    cacheVisible: true,
    selectedTable: table,
    selectedTableIdRef,
    boundaryKeyRef,
    boundaryReadyRef,
    rowQuery: query,
    selectedRowId,
    setSelectedRowId,
    offset,
    offsetHistory,
    setOffsetState: setOffset,
    setOffsetHistory,
  });
  return React.createElement('div', {
    'data-slot': 'row-projection',
    'data-rows': state.rows.map((row) => row.values['column-name']).join(','),
    'data-total': String(state.cachedPage?.total ?? 0),
  });
}

function SchemaRefreshHarness() {
  const [selectedRowId, setSelectedRowId] = React.useState(null);
  const [offset, setOffset] = React.useState(0);
  const [offsetHistory, setOffsetHistory] = React.useState([]);
  const selectedTableIdRef = React.useRef(schemaTable.tableId);
  const boundaryKeyRef = React.useRef('organization:one');
  const boundaryReadyRef = React.useRef(true);
  const rowQuery = useDataStudioRowQuery({
    capabilities: {
      enabled: true,
      scope: 'organization',
      permissions: { read: true, write: true, manage: true },
      limits: {
        maxTables: 100,
        maxRowsPerTable: 100000,
        maxColumns: 128,
        maxPageSize: 25,
        maxRowBytes: 262144,
      },
    },
    selectedTable: schemaTable,
    filters: [],
    debouncedSearch: '',
    sortColumnId: null,
    sortDirection: 'asc',
    offset,
    requestedPageSize: 25,
  });
  useDataStudioRows({
    surface: schemaSurface,
    boundary: {
      key: 'organization:one',
      scopeKey: 'organization:one',
      dataRevision: 1,
      stable: true,
      ready: true,
      phase: 'idle',
    },
    scopeAvailable: true,
    shouldLoad: true,
    canRead: true,
    cacheVisible: false,
    selectedTable: schemaTable,
    selectedTableIdRef,
    boundaryKeyRef,
    boundaryReadyRef,
    rowQuery,
    selectedRowId,
    setSelectedRowId,
    offset,
    offsetHistory,
    setOffsetState: setOffset,
    setOffsetHistory,
  });
  return null;
}

function render() {
  root.render(React.createElement(React.Fragment, null,
    React.createElement(Harness),
    React.createElement(SchemaRefreshHarness),
  ));
}

window.__dataStudioRowsHarness = {
  invalidate() {
    cachedPage = undefined;
    render();
  },
  resolve(name, total) {
    cachedPage = makePage(name, total);
    render();
  },
  changeQuery() {
    cachedPage = undefined;
    query = { ...query, search: 'filtered' };
    render();
  },
  invalidateAndChangeScope() {
    cachedPage = undefined;
    boundaryKey = 'organization:two';
    render();
  },
  bumpSchemaRevision() {
    schemaTable = {
      ...schemaTable,
      schemaRevision: schemaTable.schemaRevision + 1,
      revision: schemaTable.revision + 1,
    };
    render();
  },
  schemaLoads() { return schemaLoads; },
  snapshot() {
    return { cached: cachedPage !== undefined };
  },
};
render();
`;
}

declare global {
  interface Window {
    __dataStudioRowsHarness: {
      invalidate(): void;
      resolve(name: string, total: number): void;
      changeQuery(): void;
      invalidateAndChangeScope(): void;
      bumpSchemaRevision(): void;
      schemaLoads(): number;
      snapshot(): { cached: boolean };
    };
  }
}
