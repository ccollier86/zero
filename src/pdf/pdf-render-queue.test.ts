/**
 * pdf-render-queue.test.ts
 *
 * Verifies deadline accounting and shutdown behavior for the bounded PDF
 * semaphore without involving Chromium or storage.
 */

import { describe, expect, test } from 'bun:test';

import { PdfRenderQueue } from './pdf-render-queue';

describe('PdfRenderQueue', () => {
  test('passes only the remaining timeout budget after queue wait', async () => {
    const queue = new PdfRenderQueue(1, 1);
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.run(async () => {
      await blocked;
      return true;
    }, 1_000);

    while (queue.active === 0) await Bun.sleep(1);
    const second = queue.run(async (remainingMs) => remainingMs, 1_000);
    await Bun.sleep(20);
    releaseFirst();

    expect(await second).toBeLessThan(1_000);
    await first;
  });

  test('rejects queued and future work when closed', async () => {
    const queue = new PdfRenderQueue(1, 1);
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.run(async () => {
      await blocked;
      return true;
    }, 1_000);

    while (queue.active === 0) await Bun.sleep(1);
    const queued = queue.run(async () => true, 1_000);
    while (queue.queued === 0) await Bun.sleep(1);
    queue.close();

    await expect(queued).rejects.toMatchObject({ code: 'PDF_SERVICE_CLOSED' });
    await expect(queue.run(async () => true, 1_000))
      .rejects.toMatchObject({ code: 'PDF_SERVICE_CLOSED' });
    releaseFirst();
    await first;
  });
});
