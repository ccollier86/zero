/** Private preview and upload transports are bounded before body buffering and retire on the existing SDK generation signal. */
import { expect, test } from 'bun:test';
import { readBlogBinaryJson } from './blog-response-body';
import { createBlogPreviewAdmission } from './blog-preview-admission';
import { createBlogMediaClient } from './blog-media-client';
import type { BlogTransport } from './blog-content-client';

test('binary acknowledgments enforce a streaming size bound, cancellation and valid JSON', async () => {
  const signal = new AbortController();
  expect(await readBlogBinaryJson(Response.json({ accepted: true }), signal.signal)).toEqual({ accepted: true });
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } }));
  await expect(readBlogBinaryJson(response, signal.signal)).rejects.toThrow('admitted size'); expect(cancelled).toBe(true);
  signal.abort(); await expect(readBlogBinaryJson(Response.json({}), signal.signal)).rejects.toBeDefined();
});
test('preview admission starts four at a time, rejects overflow and removes aborted queued work', async () => {
  const admit = createBlogPreviewAdmission(), owners = Array.from({ length: 37 }, () => new AbortController());
  const release: (() => void)[] = []; let started = 0;
  const jobs = owners.slice(0, 36).map(owner => admit(owner.signal, () => { started++; return new Promise<void>(resolve => release.push(resolve)); }));
  expect(started).toBe(4);
  await expect(admit(owners[36]!.signal, async () => {})).rejects.toThrow('capacity');
  void jobs[4]!.catch(() => {}); owners[4]!.abort(); await expect(jobs[4]).rejects.toBeDefined();
  release.shift()!(); await jobs[0]; expect(started).toBe(5);
  const rest = Promise.allSettled(jobs); for (const owner of owners.slice(5)) owner.abort();
  for (const end of release) end(); await rest;
});
test('upload accepts only a matching admitted asset acknowledgment', async () => {
  const owner = new AbortController(), call = (async () => ({})) as BlogTransport;
  const wrong = createBlogMediaClient(call, async () => Response.json({ id: 'wrong', state: 'ready', kind: 'image', sizeBytes: 1 }), () => owner.signal);
  await expect(wrong.upload('image-one', new Blob(['x']), { requestId: 'fixed' })).rejects.toThrow('reconcile');
  const denied = createBlogMediaClient(call, async () => Response.json({ code: 'BLOG_MEDIA_INVALID' }, { status: 422 }), () => owner.signal);
  await expect(denied.upload('image-one', new Blob(['x']), { requestId: 'fixed' })).rejects.toMatchObject({ status: 422, code: 'BLOG_MEDIA_INVALID' });
});
