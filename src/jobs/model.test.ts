/** Pure scheduling admission/realm contract checks. Synthetic data only; no database, actor, timer or provider starts. */
import { expect, test } from 'bun:test';
import { defineDatabaseRealm } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import { JobsError, jobCommand, readJobRejection } from './error';
import { JOB_TABLES } from './realm-schema';
import { jobAdmissionDigest, jobOccurrenceId, normalizeJobAdmission } from './model';
import { jobInput, jobKey } from './validation';

const admission = () => ({ id: 'job-one', scopeId: 'application', actorId: 'synthetic-user', principal: 'synthetic-principal',
  definition: 'reports.refresh', definitionVersion: '1', definitionHash: 'a'.repeat(64),
  workflow: { name: 'reports.refresh', version: 1, definitionId: 'definition-one', versionId: 'version-one', fingerprint: 'b'.repeat(64) },
  input: { reportId: 'synthetic-report', options: { count: 1 } }, timing: { kind: 'once', at: '2026-12-01T15:00:00Z' }, overlap: 'skip', runAs: 'actor' });

test('private admissions normalize and detach canonical input; hashes bind scope, creator, workflow pin and timing', () => {
  const original = admission(), accepted = normalizeJobAdmission(original), digest = jobAdmissionDigest(accepted);
  original.input.options.count = 9; original.workflow.version = 99;
  expect(accepted.input).toEqual({ reportId: 'synthetic-report', options: { count: 1 } });
  expect(accepted.workflow.version).toBe(1); expect(accepted.timing).toMatchObject({ at: '2026-12-01T15:00:00.000Z' });
  expect(jobAdmissionDigest(normalizeJobAdmission(accepted))).toBe(digest);
  for (const changed of [{ ...admission(), scopeId: 'tenant:synthetic' }, { ...admission(), actorId: 'another-user' },
    { ...admission(), workflow: { ...admission().workflow, version: 2 } }, { ...admission(), timing: { kind: 'once', at: '2026-12-02T15:00:00Z' } }]) {
    expect(jobAdmissionDigest(normalizeJobAdmission(changed))).not.toBe(digest);
  }
  expect(jobOccurrenceId('job-one', 1, 1000)).toBe(jobOccurrenceId('job-one', 1, 1000));
  expect(jobOccurrenceId('job-one', 2, 1000)).not.toBe(jobOccurrenceId('job-one', 1, 1000));
  expect(normalizeJobAdmission({ ...admission(), scopeId: 'tenant:synthetic-ß' }).scopeId).toBe('tenant:synthetic-ß');
});

test('unknown fields, getters, malformed scope/timing and oversized input fail without reflecting private content', () => {
  let getterReads = 0;
  const getter = Object.defineProperty({}, 'id', { enumerable: true, get() { getterReads++; return 'private'; } });
  for (const value of [getter, { ...admission(), tenantPath: '/PRIVATE_INPUT' }, { ...admission(), scopeId: '/PRIVATE_INPUT' },
    { ...admission(), runAs: 'root' }, { ...admission(), workflow: { ...admission().workflow, version: 0 } },
    { ...admission(), timing: { kind: 'once', at: '2026-02-30T00:00:00Z' } }]) {
    let error: unknown; try { normalizeJobAdmission(value); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'JOBS_INPUT_INVALID' }); expect(String(error)).not.toContain('PRIVATE_INPUT');
  }
  expect(getterReads).toBe(0);
  expect(() => jobInput('x'.repeat(32 * 1024))).toThrow();
  for (const key of ['', '../other', 'a b', 'a\n', 'x'.repeat(129)]) expect(() => jobKey(key)).toThrow();
});
test('source origin binds its own policy without inventing an actor and cannot carry human authority', () => {
  const source = { id: 'src_' + 'd'.repeat(64), generation: 3, policyHash: 'e'.repeat(64) };
  const accepted = normalizeJobAdmission({ ...admission(), actorId: null, principal: null, runAs: 'service', source, initiatedBy: 'factual-initiator' });
  expect(accepted.source).toEqual(source); expect(accepted.actorId).toBeNull(); expect(accepted.principal).toBeNull();
  expect(jobAdmissionDigest(accepted)).not.toBe(jobAdmissionDigest(normalizeJobAdmission({ ...accepted, source: { ...source, generation: 4 } })));
  for (const candidate of [{ ...accepted, actorId: 'invented-user' }, { ...accepted, principal: 'invented-session' },
    { ...accepted, runAs: 'actor' }, { ...accepted, source: { ...source, generation: 0 } }, { ...admission(), initiatedBy: 'not-source' }]) {
    expect(() => normalizeJobAdmission(candidate)).toThrow();
  }
});

test('actor domain rejections throw through the transaction and retain not-committed provenance; unknown never becomes a normal rejection', () => {
  let error: unknown;
  try { jobCommand(() => { throw new JobsError('JOBS_REVISION_CONFLICT'); }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(DatabaseError);
  expect(readJobRejection(error)).toMatchObject({ code: 'JOBS_REVISION_CONFLICT', outcome: 'not-committed' });
  expect(readJobRejection(new DatabaseError('DATABASE_CONFLICT', 'synthetic', { outcome: 'unknown', retryable: false, details: { domainCode: 4 } }))).toBeNull();
  expect(new JobsError('JOBS_OUTCOME_UNKNOWN')).toMatchObject({ outcome: 'unknown', status: 503 });
  expect(new JobsError('JOBS_OUTCOME_UNKNOWN').message).toContain('may have committed');
});

test('the private schema admits real Fabric identity/relationship constraints without opening state', () => {
  const realm = defineDatabaseRealm({ name: 'zero-jobs', version: '1', tables: JOB_TABLES });
  expect(realm.name).toBe('zero-jobs');
  expect(realm.tables._jobs_occurrences!.admission_id).toContain('REFERENCES _jobs_admissions');
  expect(realm.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
});
