/** Real bounded decoder work plus load-admission checks. Synthetic raster bytes only. */
import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { BlogImageProcessor } from './media-image-processor';

test('native image admission bounds buffering, supports cancellation and drains queued work on shutdown', async () => {
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#456789' } }).png().toBuffer();
  const pool = new BlogImageProcessor({ maxInput: 100000, maxOutput: 100000, maxPixels: 10000, concurrency: 1, queued: 1 });
  let first!: () => void, queuedLoads = 0;
  const hold = new Promise<void>(resolve => { first = resolve; });
  const running = pool.normalize(async () => { await hold; return bytes; }, () => {});
  const controller = new AbortController();
  const queued = pool.normalize(async () => { queuedLoads++; return bytes; }, () => {}, controller.signal);
  await expect(pool.normalize(async () => { queuedLoads++; return bytes; }, () => {})).rejects.toMatchObject({ code: 'BLOG_CAPACITY', status: 429 });
  expect(queuedLoads).toBe(0);
  controller.abort(new Error('synthetic-cancel'));
  await expect(queued).rejects.toThrow('synthetic-cancel'); expect(queuedLoads).toBe(0);
  const waiting = pool.normalize(async () => { queuedLoads++; return bytes; }, () => {});
  pool.close(); await expect(waiting).rejects.toMatchObject({ code: 'BLOG_NOT_READY' });
  first(); expect(await running).toMatchObject({ width: 12, height: 8 }); expect(queuedLoads).toBe(0);
});

test('invalid raster and pixel bombs produce safe static domain failures', async () => {
  const pool = new BlogImageProcessor({ maxInput: 100000, maxOutput: 100000, maxPixels: 50 });
  try {
    const large = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#345678' } }).png().toBuffer();
    await expect(pool.normalize(async () => large, () => {})).rejects.toMatchObject({ code: 'BLOG_IMAGE_INVALID', status: 422 });
    await expect(pool.normalize(async () => new TextEncoder().encode('<svg>private content</svg>'), () => {})).rejects.toMatchObject({ code: 'BLOG_IMAGE_INVALID', status: 422 });
  } finally { pool.close(); }
});
