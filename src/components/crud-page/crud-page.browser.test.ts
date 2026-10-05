/** Exercises real CrudPage composition with receipt-controlled SDK actions. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/crud-page.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

async function openHarness(layout: 'table' | 'master-detail' = 'table', lazy = false): Promise<Page> {
  const page = await browser!.newPage();
  await page.setContent(`<div id="root" data-layout="${layout}" data-lazy="${lazy}"></div>`);
  await page.addScriptTag({ content: bundle });
  await page.getByText('Alpha', { exact: true }).waitFor();
  return page;
}

async function openCreate(page: Page) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('[data-crud-modal] input[name="name"]').fill('Created record');
  return page.locator('[data-crud-modal] form');
}

describe('CrudPage acknowledged mutations', () => {
  for (const layout of ['table', 'master-detail'] as const) {
    browserTest(`${layout} create waits for acceptance and prevents duplicate submission`, async () => {
      const page = await openHarness(layout);
      try {
        const form = await openCreate(page);
        await form.evaluate((form) => {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(await page.evaluate(() => window.__crudTest.calls.map((call) => call.action))).toEqual(['insert']);
        expect(await form.getByRole('button', { name: 'Create', exact: true }).isEnabled()).toBe(false);
        expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
        expect(await page.evaluate(() => window.__crudTest.created)).toEqual([]);
        expect(await page.evaluate(() => window.__crudTest.closes)).toEqual([]);
        await page.evaluate(() => window.__crudTest.resolveReceipt(0));
        await page.waitForFunction(() => window.__crudTest.created.length === 1);
        expect(await page.evaluate(() => window.__crudTest.closes)).toEqual(['modal-1']);
        expect(await page.evaluate(() => window.__crudTest.created[0]?.key)).toBeTruthy();
      } finally { await page.close(); }
    }, 30_000);

    browserTest(`${layout} rejected create keeps the form open and shows safe failure`, async () => {
      const page = await openHarness(layout);
      try {
        const form = await openCreate(page);
        await form.getByRole('button', { name: 'Create', exact: true }).click();
        expect(await page.evaluate(() => window.__crudTest.calls.map((call) => call.action))).toEqual(['insert']);
        await page.evaluate(() => window.__crudTest.rejectReceipt(0));
        await page.waitForFunction(() => window.__crudTest.toasts.length > 0);
        expect(await page.evaluate(() => window.__crudTest.created)).toEqual([]);
        expect(await page.evaluate(() => window.__crudTest.closes)).toEqual([]);
        expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([{ level: 'error', message: 'The row action could not be completed. Try again.' }]);
        expect(await page.evaluate(() => window.__crudTest.observability)).toContain('frontend.mutation.failed');
        expect(await form.getByRole('button', { name: 'Create', exact: true }).isEnabled()).toBe(true);
      } finally { await page.close(); }
    }, 30_000);
  }

  browserTest('edit awaits its receipt and closes its own modal, not a newer unrelated one', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: 'Open row actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const form = page.locator('[data-crud-modal="modal-1"] form');
      await form.locator('input[name="name"]').fill('Edited');
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      expect(await page.evaluate(() => window.__crudTest.calls)).toEqual([{ action: 'update', id: 'record-a', value: { name: 'Edited', notes: 'Original' }, aborted: false }]);
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
      await page.evaluate(() => window.__crudTest.openUnrelatedModal());
      await page.evaluate(() => window.__crudTest.resolveReceipt(0));
      await page.waitForFunction(() => window.__crudTest.closes.length === 1);
      expect(await page.evaluate(() => window.__crudTest.closes)).toEqual(['modal-1']);
      expect(await page.evaluate(() => window.__crudTest.modalIds())).toEqual(['modal-2']);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('detail updates await and report rejected writes without success', async () => {
    const page = await openHarness('master-detail');
    try {
      const form = page.locator('form');
      await form.locator('input[name="name"]').fill('Edited detail');
      await form.getByRole('button', { name: 'Save Changes', exact: true }).click();
      expect(await page.evaluate(() => window.__crudTest.calls)).toEqual([{ action: 'update', id: 'record-a', value: { name: 'Edited detail', notes: 'Original' }, aborted: false }]);
      expect(await form.getByRole('button', { name: 'Save Changes', exact: true }).isEnabled()).toBe(false);
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
      await page.evaluate(() => window.__crudTest.rejectReceipt(0));
      await page.waitForFunction(() => window.__crudTest.toasts.length === 1);
      expect(await page.evaluate(() => window.__crudTest.toasts[0]?.level)).toBe('error');
      expect(await form.getByRole('button', { name: 'Save Changes', exact: true }).isEnabled()).toBe(true);
      await form.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await page.evaluate(() => window.__crudTest.resolveReceipt(1));
      await page.waitForFunction(() => window.__crudTest.toasts.length === 2);
      expect(await page.evaluate(() => window.__crudTest.toasts[1]?.level)).toBe('success');
    } finally { await page.close(); }
  }, 30_000);

  for (const layout of ['table', 'master-detail'] as const) {
    browserTest(`${layout} deletion waits for confirmation and the delete receipt`, async () => {
      const page = await openHarness(layout);
      try {
        await openDelete(page, layout);
        expect(await page.evaluate(() => window.__crudTest.calls)).toEqual([]);
        await page.evaluate(() => window.__crudTest.acceptConfirm(true));
        await page.waitForFunction(() => window.__crudTest.calls.length === 1);
        expect(await page.evaluate(() => window.__crudTest.calls[0]?.action)).toBe('remove');
        expect(await page.evaluate(() => window.__crudTest.deleted)).toEqual([]);
        expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
        await page.evaluate(() => window.__crudTest.resolveReceipt(0));
        await page.waitForFunction(() => window.__crudTest.deleted.length === 1);
        expect(await page.evaluate(() => window.__crudTest.deleted)).toEqual(['record-a']);
      } finally { await page.close(); }
    }, 30_000);

    browserTest(`${layout} deletion rejection shows one error and no accepted callback`, async () => {
      const page = await openHarness(layout);
      try {
        await openDelete(page, layout);
        await page.evaluate(() => window.__crudTest.acceptConfirm(true));
        await page.waitForFunction(() => window.__crudTest.calls.length === 1);
        await page.evaluate(() => window.__crudTest.rejectReceipt(0));
        await page.waitForFunction(() => window.__crudTest.toasts.length === 1);
        expect(await page.evaluate(() => window.__crudTest.deleted)).toEqual([]);
        expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([{ level: 'error', message: 'The row action could not be completed. Try again.' }]);
        expect(await page.evaluate(() => window.__crudTest.observability)).toEqual(['frontend.mutation.failed']);
      } finally { await page.close(); }
    }, 30_000);
  }

  browserTest('rapid detail delete clicks share one confirmation and one write', async () => {
    const page = await openHarness('master-detail');
    try {
      await page.getByRole('button', { name: 'Delete', exact: true }).evaluate((button) => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForFunction(() => window.__crudTest.confirmPending());
      expect(await page.evaluate(() => window.__crudTest.confirmationCount())).toBe(1);
      expect(await page.getByRole('button', { name: 'Delete', exact: true }).isEnabled()).toBe(false);
      await page.evaluate(() => window.__crudTest.acceptConfirm(true));
      await page.waitForFunction(() => window.__crudTest.calls.length === 1);
      await page.evaluate(() => window.__crudTest.resolveReceipt(0));
      await page.waitForFunction(() => window.__crudTest.deleted.length === 1);
      expect(await page.evaluate(() => window.__crudTest.calls.length)).toBe(1);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('scope replacement suppresses old success and protects a new pending submission', async () => {
    const page = await openHarness();
    try {
      const oldForm = await openCreate(page);
      await oldForm.getByRole('button', { name: 'Create', exact: true }).click();
      await page.evaluate(() => window.__crudTest.switchScope());
      const newForm = await openCreate(page);
      await newForm.getByRole('button', { name: 'Create', exact: true }).click();
      await page.evaluate(() => window.__crudTest.resolveReceipt(0));
      expect(await page.evaluate(() => window.__crudTest.created)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.closes)).toEqual([]);
      expect(await newForm.getByRole('button', { name: 'Create', exact: true }).isEnabled()).toBe(false);
      await page.evaluate(() => window.__crudTest.resolveReceipt(1));
      await page.waitForFunction(() => window.__crudTest.created.length === 1);
      expect(await page.evaluate(() => window.__crudTest.closes)).toEqual(['modal-2']);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('unmount aborts the receipt lifecycle and suppresses stale failure effects', async () => {
    const page = await openHarness();
    try {
      const form = await openCreate(page);
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      await page.evaluate(() => window.__crudTest.unmount());
      expect(await page.evaluate(() => window.__crudTest.calls[0]?.aborted)).toBe(true);
      await page.evaluate(() => window.__crudTest.rejectReceipt(0));
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.created)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.closes)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('lazy sources use the same acknowledged create contract', async () => {
    const page = await openHarness('table', true);
    try {
      const form = await openCreate(page);
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      expect(await page.evaluate(() => window.__crudTest.calls[0]?.action)).toBe('insert');
      expect(await page.evaluate(() => window.__crudTest.created)).toEqual([]);
      await page.evaluate(() => window.__crudTest.resolveReceipt(0));
      await page.waitForFunction(() => window.__crudTest.created.length === 1);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('pre-write transform failures are presented safely without issuing a write', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__crudTest.failTransform());
      const form = await openCreate(page);
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      await page.waitForFunction(() => window.__crudTest.toasts.length === 1);
      expect(await page.evaluate(() => window.__crudTest.calls)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([{ level: 'error', message: 'The row action could not be completed. Try again.' }]);
      expect(await page.evaluate(() => window.__crudTest.closes)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('after-create callback failure does not repeat or mislabel an accepted write', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__crudTest.failAcceptedCallback());
      const form = await openCreate(page);
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      await page.evaluate(() => window.__crudTest.resolveReceipt(0));
      await page.waitForFunction(() => window.__crudTest.closes.length === 1);
      expect(await page.evaluate(() => window.__crudTest.calls.length)).toBe(1);
      expect(await page.evaluate(() => window.__crudTest.closes)).toEqual(['modal-1']);
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([
        { level: 'success', message: 'Create successful' },
        { level: 'error', message: 'The record change was accepted, but a follow-up action failed.' },
      ]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancelled or stale confirmations do not delete data', async () => {
    const page = await openHarness('master-detail');
    try {
      await openDelete(page, 'master-detail');
      await page.evaluate(() => window.__crudTest.acceptConfirm(false));
      await page.waitForFunction(() => !window.__crudTest.confirmPending());
      expect(await page.evaluate(() => window.__crudTest.calls)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
      await openDelete(page, 'master-detail');
      await page.evaluate(() => window.__crudTest.switchScope());
      await page.waitForFunction(() => !window.__crudTest.confirmPending());
      expect(await page.evaluate(() => window.__crudTest.calls)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.deleted)).toEqual([]);
      expect(await page.evaluate(() => window.__crudTest.toasts)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);
});

async function openDelete(page: Page, layout: 'table' | 'master-detail') {
  if (layout === 'table') {
    await page.getByRole('button', { name: 'Open row actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.waitForFunction(() => window.__crudTest.confirmPending());
}
