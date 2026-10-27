/** Qualifies native fixture renewal, not a browser collector or a relaxation of required admission. */
import { expect, test } from 'bun:test';
import type { Client } from '../frontend/client/sdk';
import { publishingAuditHeartbeat } from './test-fixtures/publishing/audit-heartbeat';
import { PUBLISHING_FIXTURE_FILES } from './test-fixtures/publishing/fixture-files';
test('both installed and Linux consumers use the same complete native copy manifest', async () => {
  expect(PUBLISHING_FIXTURE_FILES).toContainEqual(['audit-heartbeat.ts', 'audit-heartbeat.ts']);
  for (const [source] of PUBLISHING_FIXTURE_FILES) expect(await Bun.file(new URL('./test-fixtures/publishing/' + source, import.meta.url)).exists()).toBe(true);
  for (const relative of ['./blog-publishing.package.test.ts', './test-fixtures/publishing/bootstrap-linux.ts']) {
    expect(await Bun.file(new URL(relative, import.meta.url)).text()).toContain('of PUBLISHING_FIXTURE_FILES');
  }
});
function fixture(heartbeatMs: number, observe: () => Promise<unknown>) {
  return { logging: { collectionPolicy: async () => ({ heartbeatMs, delivery: { required: true, policyVersion: 'synthetic-v1', ttlMs: 60000 } }), observe } } as unknown as Pick<Client, 'logging'>;
}
test('SDK-only publishing fixture renews actual acknowledgments and stops without leaving a collector behind', async () => {
  let calls = 0;
  const delivery = await publishingAuditHeartbeat(fixture(5, async () => { calls++; }));
  try { await Bun.sleep(25); expect(calls).toBeGreaterThan(1); }
  finally { await delivery.stop(); }
  const stopped = calls; await Bun.sleep(20); expect(calls).toBe(stopped);
});
test('one renewal is in flight; delivery failure remains a failed gate instead of a hidden protected-operation retry', async () => {
  let calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const delivery = await publishingAuditHeartbeat(fixture(1000, async () => { if (++calls > 1) await held; }));
  const a = delivery.confirm(), b = delivery.confirm(); expect(a).toBe(b); expect(calls).toBe(2);
  release(); await a; await delivery.stop();
  let failures = 0;
  const rejected = await publishingAuditHeartbeat(fixture(5, async () => { if (++failures > 1) throw new Error('Synthetic delivery interruption'); }));
  await Bun.sleep(25);
  await expect(rejected.confirm()).rejects.toThrow('Synthetic delivery interruption');
  await expect(rejected.stop()).rejects.toThrow('Synthetic delivery interruption');
  expect(failures).toBe(2);
});
