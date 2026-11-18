/** Pure native source-capability checks. No storage, timers, actors or provider work. */
import { expect, test } from 'bun:test';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { defineJob } from './definition';
import { JobsError } from './error';
import { assertJobSourceEligible, confirmJobSource, createTrustedJobSource, requireJobSource, type TrustedJobSource } from './source-authority';

function source() {
  return { scope: applicationServiceDataScope(), identity: { domain: 'synthetic', databaseId: 'calendar:synthetic', ownerId: 'real-synthetic-owner', rootHash: 'a'.repeat(64), scopeId: 'application' },
    realmFingerprint: 'sha256:' + 'b'.repeat(64), policyVersion: 'policy-1', semanticsVersion: 'semantics-1',
    definition: defineJob({ name: 'synthetic.source-authority', version: '1', origin: 'source', workflow: { name: 'synthetic.work', version: 1 }, parseInput: value => value }),
    signal: new AbortController().signal, assertOwnerCurrent() {}, async confirmOwnerCurrent() {}, assertEligible() {}, async confirmEligible() {} };
}
test('authored JSON and cloned opaque source tokens cannot acquire native authority', () => {
  const capability = createTrustedJobSource(source()); expect(Object.isFrozen(capability)).toBe(true);
  for (const value of [{}, { ...capability }, JSON.parse(JSON.stringify(capability)), null, source()]) {
    expect(() => requireJobSource(value as TrustedJobSource)).toThrow(expect.objectContaining({ code: 'JOBS_FORBIDDEN' }));
  }
});
test('source identity is detached and scope substitution fails before registration', () => {
  const input = source(), capability = createTrustedJobSource(input); input.identity.ownerId = 'changed-after-creation';
  expect(requireJobSource(capability).identity.ownerId).toBe('real-synthetic-owner');
  expect(() => createTrustedJobSource({ ...source(), identity: { ...source().identity, scopeId: 'tenant:other' } })).toThrow();
});
test('policy retirement denies dispatch while historical owner-only confirmation remains available', async () => {
  const input = source(); let eligible = true;
  input.assertEligible = () => { if (!eligible) throw new JobsError('JOBS_AUTHORITY_RETIRED'); };
  const binding = requireJobSource(createTrustedJobSource(input)); assertJobSourceEligible(binding); eligible = false;
  await confirmJobSource(binding, false);
  await expect(confirmJobSource(binding, true)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
});
test('owner replacement during an asynchronous confirmation is not accepted', async () => {
  const input = source(); let current = true;
  input.assertOwnerCurrent = () => { if (!current) throw new JobsError('JOBS_AUTHORITY_RETIRED'); };
  input.confirmOwnerCurrent = async () => { current = false; };
  await expect(confirmJobSource(requireJobSource(createTrustedJobSource(input)), false)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
});
test('asynchronous final guards and aborted owner lifetimes fail closed', () => {
  expect(() => createTrustedJobSource({ ...source(), assertOwnerCurrent: async () => {} })).toThrow(expect.objectContaining({ code: 'JOBS_CONFIG_INVALID' }));
  const input = source(), controller = new AbortController(); input.signal = controller.signal;
  const binding = requireJobSource(createTrustedJobSource(input)); controller.abort(new JobsError('JOBS_AUTHORITY_RETIRED'));
  expect(() => assertJobSourceEligible(binding)).toThrow();
  const asynchronous = requireJobSource(createTrustedJobSource({ ...source(), assertEligible: async () => {} }));
  expect(() => assertJobSourceEligible(asynchronous)).toThrow(expect.objectContaining({ code: 'JOBS_CONFIG_INVALID' }));
  expect(() => createTrustedJobSource({ ...source(), assertOwnerCurrent: () => false })).toThrow(expect.objectContaining({ code: 'JOBS_CONFIG_INVALID' }));
  const boolean = requireJobSource(createTrustedJobSource({ ...source(), assertEligible: () => false }));
  expect(() => assertJobSourceEligible(boolean)).toThrow(expect.objectContaining({ code: 'JOBS_CONFIG_INVALID' }));
});
