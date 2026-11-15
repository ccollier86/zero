/** Pure code-catalog checks: no credentials, files, processes, providers or jobs are created. */
import { expect, test } from 'bun:test';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { defineJob, JobDefinitionCatalog, assertJobServiceEligibility, type JobServicePolicy } from './definition';
const declaration = () => ({ name: 'synthetic.report', version: '1', workflow: { name: 'synthetic.report', version: 1 }, parseInput: (input: unknown) => input });

test('code-owned jobs detach metadata, default to admin and require the exact registered reference', () => {
  const source = declaration(), job = defineJob(source), other = defineJob(declaration()), catalog = new JobDefinitionCatalog([job]);
  source.workflow.version = 2;
  expect(job.workflow.version).toBe(1); expect(job.access).toBe('admin'); expect(job.service).toBeNull();
  expect(catalog.resolve(job)).toBe(job); expect(catalog.resolve(job.name)).toBe(job);
  expect(() => catalog.resolve(other)).toThrow(); expect(() => new JobDefinitionCatalog([{ ...job }])).toThrow();
  expect(() => new JobDefinitionCatalog([job, other])).toThrow();
  expect(catalog.fingerprint).toBe(new JobDefinitionCatalog([job]).fingerprint);
  expect(defineJob({ ...declaration(), version: '2' }).fingerprint).not.toBe(job.fingerprint);
});
test('parsers are bounded detached canonical JSON, not non-idempotent transforms or async work', () => {
  const job = defineJob(declaration()), value = { synthetic: { count: 1 } }, parsed = job.parseInput(value); value.synthetic.count = 3;
  expect(parsed).toEqual({ synthetic: { count: 1 } });
  expect(() => defineJob({ ...declaration(), parseInput: value => ({ wrapped: value }) }).parseInput(1)).toThrow();
  expect(() => defineJob({ ...declaration(), parseInput: async value => value }).parseInput(1)).toThrow();
  expect(() => defineJob({ ...declaration(), parseInput: async () => { throw new Error('synthetic parser failure'); } }).parseInput(1)).toThrow();
  expect(() => job.parseInput('x'.repeat(32768))).toThrow();
});
test('default selection is explicit while old registered versions remain pinned and recoverable without executing newer policy', () => {
  const old = defineJob({ ...declaration(), default: false }), current = defineJob({ ...declaration(), version: '2' });
  const catalog = new JobDefinitionCatalog([old, current]);
  expect(catalog.resolve(old.name)).toBe(current); expect(catalog.resolve(old.name, '1')).toBe(old); expect(catalog.resolve(old)).toBe(old);
  expect(old.fingerprint).toBe(defineJob(declaration()).fingerprint);
  expect(() => catalog.resolve(old.name, 'missing')).toThrow();
  expect(() => new JobDefinitionCatalog([defineJob(declaration()), current])).toThrow();
  expect(new JobDefinitionCatalog([old, current]).fingerprint).toBe(new JobDefinitionCatalog([current, old]).fingerprint);
});
test('service execution requires deliberate scoped code policy and live synchronous eligibility without actor fallback', () => {
  let eligible = true;
  const policy: JobServicePolicy = { principal: 'reports.daily', scopes: ['application'], isEligible: () => eligible };
  const job = defineJob({ ...declaration(), service: policy }), app = applicationServiceDataScope();
  assertJobServiceEligibility(job, app, 'synthetic-user', {});
  eligible = false; expect(() => assertJobServiceEligibility(job, app, 'synthetic-user', {})).toThrow();
  expect(() => assertJobServiceEligibility(job, trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'other' }), 'synthetic-user', {})).toThrow();
  expect(() => assertJobServiceEligibility(defineJob(declaration()), app, 'synthetic-user', {})).toThrow();
  const asynchronous = defineJob({ ...declaration(), service: { ...policy, isEligible: (async () => true) as unknown as JobServicePolicy['isEligible'] } });
  expect(() => assertJobServiceEligibility(asynchronous, app, 'synthetic-user', {})).toThrow();
});
