/** Real-browser coverage for Storage Studio editing and responsive selection. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

declare global {
  interface Window {
    __storageStudioHarness: {
      resolve: () => void;
      remote: (name: string) => void;
      clearSelection: () => void;
      commits: () => string[];
      page: () => number;
    };
  }
}

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const TEST_TIMEOUT = 60_000;
let browser: Browser | undefined;
let browserLease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;
let stylesheetPath: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  browserLease = await acquirePlaywrightTestBrowser();
  browser = browserLease.browser;
  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'storage-studio-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  await writeFile(entrypoint, fixtureSource(
    join(import.meta.dir, 'storage-studio-workspace.tsx'),
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
  stylesheetPath = (await buildPlatformStyles(buildDir, join(buildDir, 'missing-app'))).cssPath;
}, TEST_TIMEOUT);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    browserLease?.release();
  }
}, TEST_TIMEOUT);

describe('StorageStudioWorkspace browser contract', () => {
  browserTest('keeps inline editing stable and protects stale drafts', async () => {
    const page = await openHarness();
    try {
      const cell = page.locator('[data-slot="inline-edit-text"]').first();
      const before = await cell.boundingBox();
      if (!before) throw new Error('Expected a drive name cell');

      await page.getByRole('button', { name: /Edit drive name/ }).click();
      const input = page.getByRole('textbox', { name: 'Edit drive name' });
      const during = await cell.boundingBox();
      const style = await input.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { background: computed.backgroundColor, border: computed.borderTopWidth };
      });
      expect(during?.width).toBeCloseTo(before.width, 1);
      expect(during?.height).toBeCloseTo(before.height, 1);
      expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px' });

      await input.fill('Discarded');
      await input.press('Escape');
      expect(await cell.textContent()).toContain('Clinical files');

      await page.getByRole('button', { name: /Edit drive name/ }).click();
      await input.fill('Updated drive');
      await input.press('Enter');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="inline-edit-text"]')
          ?.getAttribute('data-save-state') === 'pending'
      ));
      await page.evaluate(() => window.__storageStudioHarness.resolve());
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="inline-edit-text"]')
          ?.getAttribute('data-save-state') === 'saved'
      ));
      expect(await cell.textContent()).toContain('Updated drive');

      await page.getByRole('button', { name: /Edit drive name/ }).click();
      await input.fill('Stale local name');
      await page.evaluate(() => window.__storageStudioHarness.remote('Remote drive'));
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="inline-edit-text"]')
          ?.getAttribute('data-save-state') === 'conflict'
      ));
      expect(await cell.textContent()).toContain('Remote drive');
      expect(await page.evaluate(() => window.__storageStudioHarness.commits())).toEqual(['Updated drive']);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('moves between the mobile catalog and inspector without duplicating the workspace', async () => {
    const page = await openHarness();
    try {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.evaluate(() => window.__storageStudioHarness.clearSelection());

      const workspace = page.locator('[data-slot="storage-studio-workspace"]');
      const list = page.locator('[data-slot="storage-studio-list"]');
      const inspector = page.locator('[data-slot="storage-studio-inspector"]');
      expect(await workspace.count()).toBe(1);
      expect(await list.isVisible()).toBe(true);
      expect(await inspector.isVisible()).toBe(false);

      await page.locator('[data-storage-item-id="drive-1"] td').nth(2).click();
      await page.getByRole('button', { name: 'Back to drives' }).waitFor({ state: 'visible' });
      expect(await list.isVisible()).toBe(false);
      expect(await inspector.isVisible()).toBe(true);

      await page.getByRole('button', { name: 'Back to drives' }).click();
      await list.waitFor({ state: 'visible' });
      expect(await inspector.isVisible()).toBe(false);
      expect(await workspace.count()).toBe(1);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('navigates cursor pages through the bounded controller actions', async () => {
    const page = await openHarness();
    try {
      expect(await page.evaluate(() => window.__storageStudioHarness.page())).toBe(1);
      await page.getByRole('button', { name: 'Next page' }).click();
      await page.waitForFunction(() => window.__storageStudioHarness.page() === 2);
      expect(await page.getByText('Page 2', { exact: false }).count()).toBe(1);
      await page.getByRole('button', { name: 'Previous page' }).click();
      await page.waitForFunction(() => window.__storageStudioHarness.page() === 1);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);
});

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath || !stylesheetPath) throw new Error('Browser harness unavailable');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<div id="root" style="height:760px"></div>');
  await page.addStyleTag({ path: stylesheetPath });
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__storageStudioHarness === 'object');
  return page;
}

function fixtureSource(componentPath: string): string {
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { StorageStudioWorkspace } from ${JSON.stringify(componentPath)};

const createdAt = Date.UTC(2026, 9, 3, 12);
let driveName = 'Clinical files';
let revision = 1;
let selected = null;
let pending = null;
let commitValues = [];
let currentPage = 1;
const root = createRoot(document.getElementById('root'));

function drive() {
  return {
    drive: {
      drive_id: 'drive-1', tenant_id: 'tenant-1', name: driveName,
      owner_id: 'user-1', max_size_bytes: 1024, max_file_size_bytes: 512,
      allowed_mime_types: '*', public: 0, created_at: createdAt,
      access: { effectiveAccess: 'admin', canRead: true, canWrite: true,
        canAdmin: true, isOwner: true, isPlatformAdmin: false, isPublic: false },
    },
    profile: {
      driveId: 'drive-1', key: 'clinical-files', ownerKind: 'organization',
      ownerId: 'tenant-1', scopeKind: 'tenant', lifecycle: 'ready', revision,
      isolation: 'shared-cas', generation: 1, createdAt, updatedAt: createdAt,
      readyAt: createdAt, degradedAt: null, suspendedAt: null, deletingAt: null,
      deletedAt: null, restoringAt: null, failedAt: null, failureCode: null,
    },
    control: { canManage: true, canDelete: true, canSuspend: true, canRestore: false },
  };
}

function capabilities() {
  return {
    enabled: true, scopeKind: 'tenant', ownerChoices: ['organization', 'personal'],
    canReadCatalog: true, canProvisionOrganization: true, canProvisionPersonal: true,
    canManage: true, canDelete: true,
    policy: { isolation: 'shared-cas', allowPublicDrives: false,
      allowPublicObjects: false, maxCapabilityTTL: 3600, maxOrganizationDrives: 25,
      maxPersonalDrivesPerUser: 2, defaultDriveSizeBytes: 1024,
      defaultFileSizeBytes: 512, maxDriveSizeBytes: 2048, maxFileSizeBytes: 1024,
      maxObjectsPerDrive: 100, maxConcurrentUploadBytes: 1024 },
  };
}

function commitName(next) {
  commitValues.push(next);
  return new Promise((resolve) => {
    pending = () => {
      driveName = next;
      revision += 1;
      render();
      resolve();
    };
  });
}

function render() {
  const current = drive();
  const controller = {
    status: 'ready', capabilities: capabilities(), view: 'drives', drives: [current], files: [],
    selectedDrive: selected ? current : null, selectedFile: null, selectedFileAccess: null,
    currentPath: null, breadcrumbs: [{ label: 'Root', path: null }], usage: null, jobs: [],
    drivePagination: { page: currentPage, count: 1, hasPrevious: currentPage > 1, hasNext: currentPage < 2 },
    filters: { search: '', owner: 'all', lifecycle: 'all', objectType: 'all', sortBy: 'name', sortDir: 'asc' },
    setSearch() {}, setOwnerFilter() {}, setLifecycleFilter() {}, setObjectTypeFilter() {},
    setSortBy() {}, setSortDir() {},
    selectDrive(id) { selected = id; render(); },
    openDrive() {}, selectFile() {}, openFolder() {}, openBreadcrumb() {},
    showDriveCatalog() {}, refresh() {},
    previousDrivePage() { currentPage = Math.max(1, currentPage - 1); render(); },
    nextDrivePage() { currentPage = Math.min(2, currentPage + 1); render(); },
    operations: { createDrive() {}, renameDrive(_drive, name) { return commitName(name); }, deleteDrive() {} },
  };
  root.render(React.createElement(StorageStudioWorkspace, { controller }));
}

window.__storageStudioHarness = {
  resolve() { pending?.(); pending = null; },
  remote(name) { driveName = name; revision += 1; render(); },
  clearSelection() { selected = null; render(); },
  commits() { return commitValues; },
  page() { return currentPage; },
};
render();
`;
}
