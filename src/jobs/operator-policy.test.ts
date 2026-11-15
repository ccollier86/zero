/** Pure read-policy checks: no runtime, database, provider or eligibility callback execution. */
import { expect, test } from 'bun:test';
import { AuthError } from '../auth/types';
import type { JobScheduleView } from './contracts';
import { defineJob, JobDefinitionCatalog, type JobDefinitionInput } from './definition';
import { JobOperatorPolicy } from './operator-policy';

const actor = { scopeId: 'application', userId: 'synthetic-owner', principal: 'synthetic-session', manageAll: false };
const manager = { ...actor, userId: 'synthetic-manager', principal: 'synthetic-manager-session', manageAll: true };
const schedule: JobScheduleView = { id: 'job_synthetic', definition: 'synthetic.report', definitionVersion: '1', ownerId: actor.userId,
  runAs: 'actor', control: 'active', revision: 1, generation: 1, createdAt: 1, updatedAt: 1 };
const job = (name = schedule.definition, options: Partial<JobDefinitionInput<unknown>> = {}) => defineJob({
  name, version: '1', workflow: { name, version: 1 }, parseInput: value => value, ...options,
});
const authorize = () => {};

test('definition discovery filters live access and projects only bounded safe code metadata without executable callbacks', () => {
  let parsers = 0, eligibility = 0;
  const report = job('synthetic.report', { parseInput(value) { parsers++; return value; }, service: {
    principal: 'PRIVATE_SERVICE_PRINCIPAL', scopes: ['tenant'], isEligible() { eligibility++; throw new Error('Must not execute during reads'); },
  } });
  const hidden = job('synthetic.hidden');
  const old = job('synthetic.report', { version: '0', default: false });
  const catalog = new JobDefinitionCatalog([report, hidden, old]);
  const liveAccess = (definition: typeof report) => {
    if (definition.name === hidden.name) throw new AuthError('Denied', 'FORBIDDEN', 403);
  };
  const application = new JobOperatorPolicy(catalog, 'application', liveAccess).definitions();
  expect(application).toEqual({ items: [
    { name: report.name, version: '0', default: false, ownership: { actor: true, service: false } },
    { name: report.name, version: '1', default: true, ownership: { actor: true, service: false } },
  ] });
  const policy = new JobOperatorPolicy(catalog, 'tenant', liveAccess);
  expect(policy.definitions().items[1]!.ownership.service).toBe(true);
  expect(policy.actions(actor, { ...schedule, runAs: 'service' }).resume.allowed).toBe(true);
  expect(JSON.stringify(application)).not.toContain('PRIVATE');
  expect(JSON.stringify(application)).not.toContain('parseInput');
  expect(JSON.stringify(application)).not.toContain('access');
  expect(parsers).toBe(0); expect(eligibility).toBe(0);
});

test('discovery does not swallow non-denial authorization failures', () => {
  const catalog = new JobDefinitionCatalog([job()]);
  expect(() => new JobOperatorPolicy(catalog, 'application', () => { throw new AuthError('Not ready', 'AUTH_NOT_READY', 503); }))
    .toThrow('Not ready');
  expect(() => new JobOperatorPolicy(catalog, 'application', () => { throw new Error('Synthetic broken policy'); }))
    .toThrow('Synthetic broken policy');
});

test('advisory actions preserve canonical no-op pause and active-schedule readmission semantics', () => {
  const policy = new JobOperatorPolicy(new JobDefinitionCatalog([job()]), 'application', authorize);
  for (const control of ['active', 'paused'] as const) {
    expect(policy.actions(actor, { ...schedule, control })).toEqual({
      pause: { allowed: true, reason: null }, cancel: { allowed: true, reason: null }, resume: { allowed: true, reason: null },
      update: { allowed: true, reason: null }, runNow: { allowed: true, reason: null },
    });
  }
});

test('managers may stop another actor or independently run now, never impersonate that actor on update/resume', () => {
  const policy = new JobOperatorPolicy(new JobDefinitionCatalog([job()]), 'application', authorize);
  expect(policy.actions(manager, schedule)).toEqual({
    pause: { allowed: true, reason: null }, cancel: { allowed: true, reason: null }, resume: { allowed: false, reason: 'owner-required' },
    update: { allowed: false, reason: 'owner-required' }, runNow: { allowed: true, reason: null },
  });
  expect(() => policy.actions({ ...manager, manageAll: false }, schedule)).toThrow(expect.objectContaining({ code: 'JOBS_NOT_FOUND' }));
});

test('cancelled identities make all controls unavailable even to managers and with missing code', () => {
  const policy = new JobOperatorPolicy(new JobDefinitionCatalog([]), 'application', authorize);
  const actions = policy.actions(manager, { ...schedule, control: 'cancelled' });
  expect(Object.keys(actions)).toHaveLength(5);
  for (const availability of Object.values(actions)) expect(availability).toEqual({ allowed: false, reason: 'cancelled' });
});

test('missing exact versions block resume/run-now but update may deliberately select compatible authorized code', () => {
  const replacement = job(schedule.definition, { version: '2' });
  const policy = new JobOperatorPolicy(new JobDefinitionCatalog([replacement]), 'application', authorize);
  expect(policy.actions(actor, schedule)).toEqual({
    pause: { allowed: true, reason: null }, cancel: { allowed: true, reason: null }, resume: { allowed: false, reason: 'definition-unavailable' },
    update: { allowed: true, reason: null }, runNow: { allowed: false, reason: 'definition-unavailable' },
  });
  const noNamedReplacement = new JobOperatorPolicy(new JobDefinitionCatalog([job('synthetic.old', { default: false })]), 'application', authorize);
  expect(noNamedReplacement.actions(actor, schedule).update).toEqual({ allowed: false, reason: 'definition-unavailable' });
});

test('current definition access is required for readmission, not for an owner or manager to stop scheduling', () => {
  const policy = new JobOperatorPolicy(new JobDefinitionCatalog([job()]), 'application', () => { throw new AuthError('Denied', 'FORBIDDEN', 403); });
  const actions = policy.actions(actor, schedule);
  expect(actions.pause.allowed).toBe(true); expect(actions.cancel.allowed).toBe(true);
  for (const action of ['resume', 'update', 'runNow'] as const) expect(actions[action]).toEqual({ allowed: false, reason: 'access-denied' });
  const repair = new JobOperatorPolicy(new JobDefinitionCatalog([job(), job('synthetic.replacement')]), 'application', definition => {
    if (definition.name === schedule.definition) throw new AuthError('Denied', 'FORBIDDEN', 403);
  });
  expect(repair.actions(actor, schedule).update.allowed).toBe(true);
});

test('service ownership support uses declared current scope only; no read invokes custom eligibility', () => {
  let eligibility = 0;
  const report = job(schedule.definition, { service: { principal: 'synthetic-service', scopes: ['tenant'], isEligible() { eligibility++; return false; } } });
  const catalog = new JobDefinitionCatalog([report]);
  const serviceSchedule = { ...schedule, runAs: 'service' as const };
  const unavailable = new JobOperatorPolicy(catalog, 'application', authorize).actions(manager, serviceSchedule);
  for (const action of ['resume', 'update', 'runNow'] as const) expect(unavailable[action]).toEqual({ allowed: false, reason: 'ownership-unavailable' });
  const available = new JobOperatorPolicy(catalog, 'tenant', authorize).actions(manager, serviceSchedule);
  expect(available.resume.allowed).toBe(true); expect(available.update.allowed).toBe(true); expect(available.runNow.allowed).toBe(true);
  expect(eligibility).toBe(0);
});
