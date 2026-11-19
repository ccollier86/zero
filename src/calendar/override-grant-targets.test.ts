/** Real Guardian/service/native MEMORY final fence; synthetic accounts only, no output files. */
import { expect, test } from 'bun:test';
import { CalendarError } from './error';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const config = { overrides: { kind: 'appointment-overlap-v1' as const, use: 'user' as const, manageGrants: 'admin' as const } };
test('grant targets are independently current-scope admitted, replay remains factual, and departed accounts can be revoked', async () => {
  let eligible = true, checks = 0;
  const f = memoryCalendarServiceFixture({ config, overrideTargets: { assertBindable(scope, refs) {
    checks++; expect(scope.scopeKind).toBe('tenant'); expect(refs).toEqual([{ kind: 'guardian-user', userId: 'target' }]);
    if (!eligible) throw new CalendarError('CALENDAR_NOT_FOUND');
  } } });
  const manager = f.session('manager', { manager: true });
  try {
    const r = await manager.api.resources.create({ label: 'Synthetic calendar', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const options = { idempotencyKey: 'grant', expectedRevision: 1 }, grant = { categories: ['appointment-overlap'] as const };
    const accepted = await manager.api.overrides.grants.replace(r.id, 'target', grant, options);
    expect(accepted).toMatchObject({ operation: 'resource.override-grant-changed', revision: 2 });
    expect(checks).toBeGreaterThanOrEqual(2);
    eligible = false; const previous = checks, seq = f.sourceSequence(manager.scope);
    expect(await manager.api.overrides.grants.replace(r.id, 'target', grant, options)).toEqual(accepted);
    expect(checks).toBe(previous); expect(f.sourceSequence(manager.scope)).toBe(seq);
    expect(await manager.api.overrides.grants.replace(r.id, 'target', { categories: [] }, { idempotencyKey: 'revoke', expectedRevision: 2 }))
      .toMatchObject({ revision: 3, changed: true });
    expect(checks).toBe(previous);
    const before = f.sourceSequence(manager.scope);
    await expect(manager.api.overrides.grants.replace(r.id, 'target', grant, { idempotencyKey: 'departed', expectedRevision: 3 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(f.sourceSequence(manager.scope)).toBe(before); expect(await manager.api.receipts.get('departed')).toBeNull();
  } finally { await f.close(); }
});

test('ordinary and independent administration are checked before target probes; no target oracle on guessed resources', async () => {
  let checks = 0;
  const f = memoryCalendarServiceFixture({ config, overrideTargets: { assertBindable() { checks++; } } });
  const owner = f.session('owner'), manager = f.session('manager', { manager: true });
  try {
    const r = await owner.api.resources.create({ label: 'Own', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'own' });
    await expect(owner.api.overrides.grants.replace(r.id, 'guessed', { categories: ['appointment-overlap'] }, { idempotencyKey: 'not-admin', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_OVERRIDE_NOT_ALLOWED' });
    await expect(manager.api.overrides.grants.replace('missing', 'guessed', { categories: ['appointment-overlap'] }, { idempotencyKey: 'missing', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(checks).toBe(0);
  } finally { await f.close(); }
});

test('target eligibility lost at actual dispatch prevents grant mutation and all corresponding evidence', async () => {
  let eligible = true, race = false;
  const f = memoryCalendarServiceFixture({ config, overrideTargets: { assertBindable() {
    if (!eligible) throw new CalendarError('CALENDAR_NOT_FOUND');
  } }, beforeDispatch(operation) {
    if (race && operation.type === 'command' && operation.name === 'calendar.resource.override-grant') { eligible = false; race = false; }
  } });
  const manager = f.session('manager', { manager: true });
  try {
    const r = await manager.api.resources.create({ label: 'Calendar', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const seq = f.sourceSequence(manager.scope), before = f.sourceRows(manager.scope, '_calendar_effect_intents'); race = true;
    await expect(manager.api.overrides.grants.replace(r.id, 'target', { categories: ['appointment-overlap'] }, { idempotencyKey: 'race', expectedRevision: 1 }))
      .rejects.toMatchObject({ outcome: 'not-started' });
    expect(f.sourceSequence(manager.scope)).toBe(seq); expect(f.sourceRows(manager.scope, '_calendar_effect_intents')).toEqual(before);
    expect(f.sourceRows(manager.scope, '_calendar_override_grant_history')).toHaveLength(0);
    expect(await manager.api.receipts.get('race')).toBeNull(); expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});
