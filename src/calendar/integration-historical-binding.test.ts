/** Native owner + real source Jobs receipts, strictly MEMORY. Historical fixture
 * seeding tests retained contract admission, not physical actor/file upgrades. */
import { expect, test } from 'bun:test';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { createTrustedJobSource } from '../jobs/source-authority';
import { memorySourceJobsFixture } from '../jobs/test-support/memory-source-fixture';
import { CALENDAR_OBSERVATION_JOB, CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput,
  calendarObservationPolicy, registerCalendarObservationWorkflow } from './integration-catalog';
import { CalendarIntegrationCoordinator } from './integration-coordinator';
import { CALENDAR_INTEGRATION_HISTORICAL_REALMS } from './integration-historical-realms';
import { calendarIntegrationPolicySelection } from './integration-operator';
import type { CalendarIntegrationPolicyView } from './integration-model';
import { calendarIntegrationInput } from './integration-runtime';
import { calendarRealm } from './realm';
import { calendarValue } from './validation';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

test.each([...CALENDAR_INTEGRATION_HISTORICAL_REALMS])('qualified retained $version contracts remain inspectable and retire through the original Jobs receipt after owner upgrade', async legacy => {
  const calendar = memoryCalendarServiceFixture({ tenancy: 'single' });
  let jobs: Awaited<ReturnType<typeof memorySourceJobsFixture>> | undefined;
  let coordinator: CalendarIntegrationCoordinator | undefined;
  try {
    jobs = await memorySourceJobsFixture({ tenancy: 'single', definition: CALENDAR_OBSERVATION_JOB,
      registerWorkflow(registry) { registerCalendarObservationWorkflow(registry, () => coordinator!); } });
    const session = calendar.session('owner', { manager: true });
    await session.api.resources.create({ label: 'Synthetic resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const record = calendar.runtime.integrationOwners()[0]!, owner = calendar.runtime.forIntegrationOwner(record);
    const rule = { id: 'observe', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 };
    const pin = jobs.bridge.pin(jobs.bridge.system({ principal: 'calendar:historical:test', reason: 'Synthetic retained native policy', scope: session.scope }),
      CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput(), 1);
    const current = calendarObservationPolicy(owner, rule, pin);
    const historical = { ...current, source: { ...current.source, realmFingerprint: legacy.fingerprint } };
    // New policy admission still refuses an old realm, even when known. Only
    // genuine retained immutable source rows can reach the recovery boundary.
    expect(() => calendarIntegrationInput(record, owner.scope, 'command', 'calendar.integration.policy.install',
      { policy: historical, expectedEpoch: 0 }, 'cannot-install-old')).toThrow();
    const plane = calendar.sourceDatabase(owner.scope)!;
    runDatabaseRealmCommand(calendarRealm, plane, 'calendar.integration.policy.install', calendarValue({
      policy: historical, expectedEpoch: 0, scopeId: record.scope_id, expectedOwnerId: record.owner_id, requestId: 'synthetic-retained-install',
    }));
    const capability = createTrustedJobSource({ ...historical.source, scope: owner.scope, definition: CALENDAR_OBSERVATION_JOB,
      signal: owner.signal, assertOwnerCurrent: () => owner.assertCurrent(), confirmOwnerCurrent: () => owner.verify(),
      assertEligible() {}, async confirmEligible() {} });
    const source = jobs.service.forSource(capability);
    const original = await source.registration.activate({ expectedRevision: 0, idempotencyKey: 'synthetic-original-registration', pinInput: calendarObservationPinInput() });
    const retained = await owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: rule.id });
    // Source control journal will reconcile the original registration and retire
    // it, rather than replace its immutable historical contract.
    coordinator = new CalendarIntegrationCoordinator({ rules: [rule], pin: () => pin,
      owner: row => calendar.runtime.forIntegrationOwner(row), discover: () => ({ owners: [], nextCursor: null }),
      resolveOwner: scope => calendar.runtime.integrationOwnerForScope(scope), jobs: jobs.service,
      inspect: (id, scope) => jobs!.workflows.getInstance(id, scope), now: () => jobs!.now() });
    const inspected = await coordinator.inspect(owner.scope);
    expect(inspected?.rules[0]).toMatchObject({ selection: calendarIntegrationPolicySelection(retained), downstream: { state: 'active', matchesPolicy: true } });
    const retired = await coordinator.retire(owner.scope, { ruleId: rule.id, expected: calendarIntegrationPolicySelection(retained) });
    expect(retired).toMatchObject({ localState: 'retired', downstream: 'retired', evidenceOwnerRequired: true });
    expect((await source.registration.get())?.generation).toBe(original.generation);
    expect((await source.registration.get())?.state).toBe('retired');
    const after = await owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: rule.id });
    expect(after.policy).toEqual(historical); expect(after.id).toBe(retained.id);
  } finally {
    try {
      await coordinator?.drain(); await coordinator?.drainPhysicalIntake();
      if (jobs) { jobs.service.quiesce(); await jobs.service.drain(); try { await jobs.workflows.dispose(); } finally { await jobs.workflows.drainPhysical(); } }
      await coordinator?.closeEvidence(); await coordinator?.drainPhysicalEvidence();
    } finally { try { await jobs?.close(); } finally { await calendar.close(); } }
  }
});
