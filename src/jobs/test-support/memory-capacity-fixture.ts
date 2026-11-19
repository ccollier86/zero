/** Owned MEMORY-only realm fixture. Handoff receipt inputs are explicit native
 * broker doubles, not proof of actual Torrent/provider or process execution.
 */
import { createReactiveDB } from '../../sync/reactive-db';
import { createDatabaseReadQuerySession } from '../../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../../databases/database-realm';
import type { DatabaseSerializableValue } from '../../databases/database-operations';
import { jobsRealm } from '../realm';
import { JobsError, readJobRejection } from '../error';
import { jobSourceId, type JobSourceContract, type JobSourceRegistration, type JobSourceScheduleReceipt } from '../source-model';
import { jobOccurrenceId } from '../model';

export const capacityNow = Date.parse('2026-12-01T00:00:00.000Z'), capacityDue = capacityNow + 1000;
export const capacityIdentity = { domain: 'synthetic.capacity', databaseId: 'synthetic-capacity-owner', ownerId: 'native-synthetic-owner', rootHash: '1'.repeat(64), scopeId: 'application' };
export const capacityContract: JobSourceContract = { identity: capacityIdentity, realmFingerprint: 'sha256:' + '2'.repeat(64), policyVersion: 'synthetic-capacity-v1', semanticsVersion: 'synthetic-capacity-v1',
  definition: { name: 'synthetic.capacity', version: '1', fingerprint: '3'.repeat(64) },
  workflow: { name: 'synthetic.capacity.workflow', version: 1, definitionId: 'synthetic-definition', versionId: 'synthetic-version', fingerprint: '4'.repeat(64) } };
export const capacitySeal = { authorityJson: 'SYNTHETIC_CAPACITY_SEAL', authorityMac: '5'.repeat(64) };
export function memoryCapacityFixture() {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase();
  try {
    raw.run('PRAGMA foreign_keys=ON'); raw.run('PRAGMA temp_store=MEMORY');
    for (const migration of jobsRealm.migrations) raw.transaction(() => migration.up(raw))();
    for (const [table, schema] of Object.entries(jobsRealm.tables)) db.defineTable(table, schema);
    const unwrap = <T>(result: unknown): T => { const r = result as { ok: boolean; value: T; code: ConstructorParameters<typeof JobsError>[0] };
      if (!r.ok) throw new JobsError(r.code); return r.value; };
    const command = <T = any>(name: string, input: unknown): T => {
      try { return unwrap<T>(runDatabaseRealmCommand(jobsRealm, db, name, input as DatabaseSerializableValue)); }
      catch (error) { throw readJobRejection(error) ?? error; }
    };
    const query = <T = any>(name: string, input: unknown): T => {
      const session = createDatabaseReadQuerySession(raw);
      try { return unwrap<T>(runDatabaseRealmQuery(jobsRealm, session.context, name, input as DatabaseSerializableValue)); }
      finally { session.close(); }
    };
    command('jobs.owner.bind', { scopeId: 'application', ownerId: 'synthetic-jobs-capacity-owner' });
    const registration = command<JobSourceRegistration>('jobs.source.register', { contract: capacityContract, expectedRevision: 0, requestId: 'register-capacity-source', now: capacityNow });
    const admission = (id: string, at = capacityDue) => ({ id, scopeId: 'application', actorId: null, principal: null, source: { id: registration.id, generation: registration.generation, policyHash: registration.policyHash },
      definition: capacityContract.definition.name, definitionVersion: '1', definitionHash: capacityContract.definition.fingerprint, workflow: capacityContract.workflow,
      input: { synthetic: true }, timing: { kind: 'once', at: new Date(at).toISOString(), maxLatenessMs: 60_000 }, overlap: 'skip', runAs: 'service' });
    const createInput = (id: string, at = capacityDue) => ({ identity: capacityIdentity, requestId: 'create-' + id, admission: admission(id, at), seal: capacitySeal, now: capacityNow });
    const create = (id: string, at = capacityDue) => command<JobSourceScheduleReceipt>('jobs.source.schedule.create', createInput(id, at));
    const materialize = (id: string, revision = 1, now = capacityDue) => command('jobs.materialize', { scopeId: 'application', id, expectedRevision: revision, now });
    const claim = (id: string, generation = 1, at = capacityDue, now = at) => command('jobs.claim', { scopeId: 'application', id: jobOccurrenceId(id, generation, at), nonce: 'synthetic-claim', leaseMs: 1000, now });
    const dispatch = (id: string, generation = 1, at = capacityDue, leaseGeneration = 1) => command('jobs.dispatch', {
      scopeId: 'application', id: jobOccurrenceId(id, generation, at), nonce: 'synthetic-claim', leaseGeneration, now: at,
      receipt: { instanceId: 'synthetic-workflow-' + id + '-' + generation, name: capacityContract.workflow.name, definitionVersion: 1, createdAt: new Date(at).toISOString() },
    });
    const complete = (id: string, generation = 1, at = capacityDue) => command('jobs.complete', { scopeId: 'application', id: jobOccurrenceId(id, generation, at),
      instanceId: 'synthetic-workflow-' + id + '-' + generation, status: 'completed', now: at + 1 });
    const finish = (id: string) => { materialize(id); claim(id); dispatch(id); complete(id); };
    const cancel = (id: string, revision = 1) => command('jobs.source.schedule.change', { identity: capacityIdentity, requestId: 'cancel-' + id, id, expectedRevision: revision, action: 'cancel', now: capacityNow });
    const replace = (id: string, revision = 1, at = capacityDue + 120_000) => command('jobs.source.schedule.change', {
      identity: capacityIdentity, requestId: 'replace-' + id + '-' + revision, id, expectedRevision: revision, action: 'readmit', admission: admission(id, at), seal: capacitySeal, now: capacityNow,
    });
    const capacity = () => query('jobs.source.capacity', { identity: capacityIdentity });
    return { db, raw, registration, sourceId: jobSourceId(capacityIdentity), command, query, admission, createInput, create, materialize, claim, dispatch, complete, finish, cancel, replace, capacity,
      work: (id: string) => db.get('_jobs_schedule_work', id), live: (id: string) => db.get('_jobs_work_usage', id)?.count,
      history: (id: string) => db.get('_jobs_usage', id)?.count, close() { db.dispose(); } };
  } catch (error) { db.dispose(); throw error; }
}
