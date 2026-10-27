/** Pure scheduling/cache bounds over synthetic dependencies; real authority/SQL/transport are tested natively. */
import { expect, test } from 'bun:test';
import type { ReactiveDB } from '../sync/reactive-db';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { resolveMessagingConfig } from './config';
import { ManagedMessagingGroups } from './groups';
import type { MessagingRuntime } from './runtime';
import type { MessagingDirectory } from './service';

function fixture(maxParticipants = 100) {
  let revision: number | null = 1, included = true, removed = 0, failures = 0;
  const writes: { name: string; input: any; key: string }[] = [];
  const config = resolveMessagingConfig({ maxParticipants, groups: { team: {} } }, '/synthetic-group-test', resolveAuthBehaviorConfig());
  if (!config) throw new Error('Synthetic configuration missing.');
  const system = { prepare: () => ({ get: () => revision === null ? null : { revision }, finalize() {} }), onCommit: () => () => { removed++; } } as unknown as ReactiveDB;
  const runtime = { retainedScopes: () => [], async write(_scope: unknown, name: string, input: unknown, key: string, check: () => void) { check(); writes.push({ name, input, key }); check(); return { changed: true }; } } as unknown as MessagingRuntime;
  const directory = { assertScope() {}, groupCandidates: () => ({ ids: ['user-one', 'user-two', 'user-three'], hasMore: false }),
    groupRecipient: (_scope: unknown, id: string) => included || id !== 'user-three' } as unknown as MessagingDirectory;
  const groups = new ManagedMessagingGroups({ config, system, runtime, directory, failed() { failures++; } });
  return { groups, writes, get failures() { return failures; }, get removed() { return removed; }, revision(value: number | null) { revision = value; }, include(value: boolean) { included = value; } };
}
test('session-only authority revisions do not rewrite unchanged membership, while A -> B -> A has fresh reconciliation identities', async () => {
  const f = fixture(), scope = applicationServiceDataScope();
  try {
    await f.groups.ensure(scope); expect(f.writes).toHaveLength(1);
    await f.groups.ensure(scope); f.revision(2); await f.groups.ensure(scope); expect(f.writes).toHaveLength(1);
    f.include(false); f.revision(3); await f.groups.ensure(scope); expect(f.writes).toHaveLength(2);
    expect(f.writes[1]!.input.members).toEqual(['user-one', 'user-two']);
    f.include(true); f.revision(4); await f.groups.ensure(scope); expect(f.writes).toHaveLength(3);
    expect(f.writes[0]!.input.members).toEqual(f.writes[2]!.input.members);
    expect(new Set(f.writes.map(write => write.key)).size).toBe(3);
  } finally { await f.groups.close(); }
  expect(f.removed).toBe(1); await expect(f.groups.ensure(scope)).rejects.toMatchObject({ code: 'MESSAGING_NOT_READY' });
});
test('missing Guardian authority and oversized configured groups fail before writes instead of guessing/truncating membership', async () => {
  const missing = fixture(), oversized = fixture(2), scope = applicationServiceDataScope();
  try {
    missing.revision(null); await expect(missing.groups.ensure(scope)).rejects.toMatchObject({ code: 'MESSAGING_NOT_READY' });
    expect(missing.writes).toHaveLength(0);
    await expect(oversized.groups.ensure(scope)).rejects.toMatchObject({ code: 'MESSAGING_CAPACITY' });
    expect(oversized.writes).toHaveLength(0);
  } finally { await missing.groups.close(); await oversized.groups.close(); }
});
