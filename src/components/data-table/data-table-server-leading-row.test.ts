/** Demand-driven sorted-first-row proof: no ranking guesses, and no stale or unbounded authority. */
import { describe, expect, test } from 'bun:test';
import { DataTableServerLeadingRow } from './data-table-server-leading-row';

function fixture() {
  const reads: { signal: AbortSignal; resolve(value: string | null): void; reject(cause: unknown): void }[] = [];
  const errors: unknown[] = [];
  let current = true, publishes = 0;
  const proof = new DataTableServerLeadingRow();
  const configure = (key = 'criteria-a', supported = true) => proof.configure({ key,
    read: supported ? signal => new Promise((resolve, reject) => { reads.push({ signal, resolve, reject }); }) : null,
    isCurrent: () => current,
    onChange: () => { publishes++; }, onError: cause => errors.push(cause),
  });
  configure();
  return { proof, reads, errors, configure, unavailable() { current = false; }, publishes: () => publishes };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('server leading-row navigation proof', () => {
  test('does no lookup without candidates, and coalesces burst changes to one current read', async () => {
    const { proof, reads } = fixture();
    proof.invalidate(); await flush(); expect(reads).toHaveLength(0);
    proof.require(true); proof.invalidate(); proof.invalidate(); await flush();
    expect(reads).toHaveLength(1); expect(proof.value()).toBeUndefined();
    reads[0]!.resolve('new-leading'); await flush(); expect(proof.value()).toBe('new-leading');
    proof.invalidate(); expect(proof.value()).toBeUndefined(); await flush();
    expect(reads).toHaveLength(2);
    reads[1]!.resolve(null); await flush(); expect(proof.value()).toBeNull();
  });

  test('cancels/revision-fences replaced proofs and accepts only latest source and authority', async () => {
    const { proof, reads, configure, unavailable } = fixture();
    proof.require(true); await flush(); proof.invalidate(); await flush();
    expect(reads[0]!.signal.aborted).toBe(true);
    reads[0]!.resolve('stale-old-event'); await flush(); expect(proof.value()).toBeUndefined();
    reads[1]!.resolve('current'); await flush(); expect(proof.value()).toBe('current');
    configure('criteria-b'); expect(proof.value()).toBeUndefined();
    proof.require(true); await flush(); expect(reads).toHaveLength(3);
    unavailable(); reads[2]!.resolve('private-old-authority'); await flush();
    expect(proof.value()).toBeUndefined(); expect(reads[2]!.signal.aborted).toBe(true);
  });

  test('uses exact current accepted first pages and rejects pages from pre-change revisions', async () => {
    const { proof, reads } = fixture();
    const staleRevision = proof.captureRevision(); proof.invalidate();
    proof.acceptFirstPage('old-first', staleRevision); expect(proof.value()).toBeUndefined();
    proof.require(true); await flush();
    proof.acceptFirstPage('accepted-first', proof.captureRevision());
    expect(reads[0]!.signal.aborted).toBe(true); expect(proof.value()).toBe('accepted-first');
    reads[0]!.resolve('late-lookup'); await flush(); expect(proof.value()).toBe('accepted-first');
  });

  test('clear/reveal and unsupported adapters remain passive without resurrecting old demand', async () => {
    const { proof, reads, configure } = fixture();
    proof.require(true); await flush(); proof.clear(); expect(reads[0]!.signal.aborted).toBe(true);
    reads[0]!.resolve('late-after-reveal'); await flush(); expect(proof.value()).toBeUndefined();
    proof.invalidate(); await flush(); expect(reads).toHaveLength(1);
    configure('unsupported', false); proof.require(true); await flush(); expect(reads).toHaveLength(1);
    proof.acceptFirstPage('safe-page-zero', proof.captureRevision()); expect(proof.value()).toBe('safe-page-zero');
  });

  test('invalid/failing proofs never become navigable and do not spin retries', async () => {
    const { proof, reads, errors } = fixture();
    proof.require(true); await flush(); reads[0]!.resolve(''); await flush();
    expect(proof.value()).toBeUndefined(); expect(errors).toHaveLength(1);
    await flush(); expect(reads).toHaveLength(1);
    proof.invalidate(); await flush(); reads[1]!.reject(new Error('private failure')); await flush();
    expect(proof.value()).toBeUndefined(); expect(errors).toHaveLength(2); expect(reads).toHaveLength(2);
  });

  test('same-key capability removal retires pending and settled lookup proof but permits later accepted first pages', async () => {
    const { proof, reads, configure } = fixture();
    proof.require(true); await flush(); configure('criteria-a', false);
    expect(reads[0]!.signal.aborted).toBe(true);
    reads[0]!.resolve('late-removed-capability'); await flush(); expect(proof.value()).toBeUndefined();
    configure('criteria-a', true); proof.require(true); await flush();
    reads[1]!.resolve('lookup-first'); await flush(); expect(proof.value()).toBe('lookup-first');
    configure('criteria-a', false); expect(proof.value()).toBeUndefined();
    proof.acceptFirstPage('safe-current-first-page', proof.captureRevision());
    configure('criteria-a', false); expect(proof.value()).toBe('safe-current-first-page');
  });
});
