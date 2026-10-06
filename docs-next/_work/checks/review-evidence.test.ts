/** Synthetic review-claim checks; no package or runtime is inspected. */
import { expect, test } from 'bun:test';
import { validateReviewEvidence } from './review-evidence';

const baseline = {
  package: '@zero/framework', version: '2.5.0', commit: 'a'.repeat(40),
  snapshot: 'clean', date: '2026-10-06', evidence_level: 'source-observed',
};

test('unreviewed pages and clean or dirty source observations remain truthful drafts', () => {
  expect(validateReviewEvidence({ status: 'draft' })).toEqual([]);
  expect(validateReviewEvidence({ reviewed_against: baseline })).toEqual([]);
  expect(validateReviewEvidence({ reviewed_against: { ...baseline, snapshot: 'dirty' } })).toEqual([]);
});

test('malformed review records and undeclared snapshot/evidence aliases fail', () => {
  expect(validateReviewEvidence({ reviewed_against: [] })).toContain('reviewed_against must be a mapping');
  for (const snapshot of ['committed', 'committed-baseline-clean', undefined]) {
    expect(validateReviewEvidence({ reviewed_against: { ...baseline, snapshot } }))
      .toContain('reviewed_against.snapshot must be clean or dirty');
  }
  expect(validateReviewEvidence({ reviewed_against: { ...baseline, evidence_level: 'fully-tested' } }))
    .toContain('reviewed_against.evidence_level is invalid');
});

test('review identities require package, version, complete source commit and dated evidence', () => {
  for (const [field, value] of [['package', ''], ['version', 2.5], ['commit', '0ef2cb3'], ['date', 'today']] as const) {
    expect(validateReviewEvidence({ reviewed_against: { ...baseline, [field]: value } }).length).toBeGreaterThan(0);
  }
});

test('enum arrays and other malformed YAML values cannot pass by string coercion', () => {
  for (const snapshot of [['clean'], ['dirty'], { value: 'clean' }, null, true]) {
    expect(validateReviewEvidence({ reviewed_against: { ...baseline, snapshot } }))
      .toContain('reviewed_against.snapshot must be clean or dirty');
  }
  for (const evidence_level of [['source-observed'], { value: 'source-observed' }, null, true]) {
    expect(validateReviewEvidence({ reviewed_against: { ...baseline, evidence_level } }))
      .toContain('reviewed_against.evidence_level is invalid');
  }
});

test('implementation verification cannot be inferred from a dirty working tree', () => {
  expect(validateReviewEvidence({ reviewed_against: { ...baseline, evidence_level: 'implementation-verified' } })).toEqual([]);
  expect(validateReviewEvidence({ reviewed_against: { ...baseline, snapshot: 'dirty', evidence_level: 'implementation-verified' } }))
    .toContain('implementation/package verification requires a clean committed snapshot');
});

test('package-qualified claims need the exact matching archive identity', () => {
  const qualified = { ...baseline, evidence_level: 'package-qualified' };
  expect(validateReviewEvidence({ reviewed_against: qualified }))
    .toContain('package-qualified evidence requires reviewed_against.artifact');
  const artifact = { version: baseline.version, commit: baseline.commit, sha256: 'b'.repeat(64) };
  expect(validateReviewEvidence({ reviewed_against: { ...qualified, artifact } })).toEqual([]);
  expect(validateReviewEvidence({ reviewed_against: { ...qualified, artifact: { ...artifact, version: '2.4.3' } } }))
    .toContain('reviewed_against.artifact version/commit must match the reviewed package');
  expect(validateReviewEvidence({ reviewed_against: { ...qualified, artifact: { ...artifact, sha256: 'unknown' } } }))
    .toContain('reviewed_against.artifact.sha256 must identify the qualified archive');
});
