/**
 * Validates declared documentation review provenance for the authoring gate.
 * Pure metadata checks only: this does not inspect artifacts, execute examples,
 * or promote a page's review status or release applicability.
 */

function mapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Returns schema/claim inconsistencies when optional review evidence is present. */
export function validateReviewEvidence(metadata: Record<string, unknown>): string[] {
  if (metadata.reviewed_against === undefined) return [];
  const review = metadata.reviewed_against;
  if (!mapping(review)) return ['reviewed_against must be a mapping'];
  const problems: string[] = [];
  for (const field of ['package', 'version']) {
    if (!nonblank(review[field])) problems.push(`reviewed_against.${field} must be a nonblank string`);
  }
  if (typeof review.commit !== 'string' || !/^[a-f\d]{40}$/u.test(review.commit)) {
    problems.push('reviewed_against.commit must be a full source commit');
  }
  if (typeof review.snapshot !== 'string' || !['clean', 'dirty'].includes(review.snapshot)) {
    problems.push('reviewed_against.snapshot must be clean or dirty');
  }
  if (typeof review.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(review.date)) {
    problems.push('reviewed_against.date must use YYYY-MM-DD');
  }
  if (typeof review.evidence_level !== 'string'
    || !['source-observed', 'implementation-verified', 'package-qualified'].includes(review.evidence_level)) {
    problems.push('reviewed_against.evidence_level is invalid');
  }
  if (review.evidence_level !== 'source-observed' && review.snapshot !== 'clean') {
    problems.push('implementation/package verification requires a clean committed snapshot');
  }
  if (review.evidence_level === 'package-qualified') {
    const artifact = review.artifact;
    if (!mapping(artifact)) {
      problems.push('package-qualified evidence requires reviewed_against.artifact');
    } else {
      if (artifact.version !== review.version || artifact.commit !== review.commit) {
        problems.push('reviewed_against.artifact version/commit must match the reviewed package');
      }
      if (typeof artifact.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(artifact.sha256)) {
        problems.push('reviewed_against.artifact.sha256 must identify the qualified archive');
      }
    }
  }
  return problems;
}
