/** All requests intercepted; no real identities, persistent state, providers or browser required. */
import { expect, test } from 'bun:test';
import { createWorkflowClient } from './workflow-client';
import type { FetchInit } from './sdk';
import { sanitizeRequestPath } from '../../observability/safe-request-path';

const accepted = { instanceId: 'synthetic-run', name: 'synthetic-workflow', createdAt: '2026-11-14T12:00:00.000Z', definitionVersion: 1 };

test('workflow SDK sends one exact admission identity and validates/detaches the original receipt', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createWorkflowClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init }); return structuredClone(accepted) as T; });
  try {
    const result = await client.enqueueOnce('synthetic-workflow', { value: 1 }, { idempotencyKey: 'same:one', version: 1 });
    expect(result).toEqual(accepted); expect(Object.isFrozen(result)).toBe(true);
    expect(calls).toHaveLength(1); expect(calls[0]!.path).toBe('/workflows/enqueue');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: { name: 'synthetic-workflow', input: { value: 1 }, idempotencyKey: 'same:one', version: 1 } });
    expect(await client.getStartReceipt('same:one')).toEqual(accepted);
    expect(calls[1]!.path).toBe('/workflows/starts/same%3Aone');
  } finally { client.clear(); }
});

test('scope replacement rejects a late accepted receipt and aborts its transport instead of publishing it to the next account', async () => {
  let complete!: (value: unknown) => void, signal: AbortSignal | undefined;
  const response = new Promise<unknown>(resolve => { complete = resolve; });
  const client = createWorkflowClient(async <T>(_path: string, init?: FetchInit) => { signal = init?.signal ?? undefined; return await response as T; });
  const pending = client.enqueueOnce('synthetic-workflow', null, { idempotencyKey: 'late:one' });
  const outcome = pending.catch(error => error);
  try {
    client.clear(); expect(signal?.aborted).toBe(true); complete(accepted);
    expect(await outcome).toMatchObject({ name: 'AbortError' });
  } finally { complete(accepted); await outcome; client.clear(); }
});

test('invalid input/receipts are rejected, uncertain failures are not automatically replayed and keys are redacted from diagnostics', async () => {
  let calls = 0;
  const client = createWorkflowClient(async () => { calls++; throw new Error('Synthetic uncertain transport'); });
  try {
    await expect(client.enqueueOnce('synthetic-workflow', {}, { idempotencyKey: '' })).rejects.toThrow(); expect(calls).toBe(0);
    await expect(client.enqueueOnce('synthetic-workflow', {}, { idempotencyKey: 'uncertain:one' })).rejects.toThrow('Synthetic uncertain transport'); expect(calls).toBe(1);
    expect(sanitizeRequestPath('/workflows/starts/PRIVATE_LOGICAL_KEY')).toBe('/workflows/starts/:key');
  } finally { client.clear(); }
  const invalid = createWorkflowClient(async <T>() => ({ ...accepted, input: 'must-not-be-projected' }) as T);
  try { await expect(invalid.getStartReceipt('bad:one')).rejects.toThrow(); } finally { invalid.clear(); }
});
