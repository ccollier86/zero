/** Logging readiness findings remain read-only and cannot advertise automatic compliance. */
import { expect, test } from 'bun:test';
import { runPlatformDoctor } from './platform-doctor';

test('disabled logging adds no logging findings; enabled capture reports declared gaps and indefinite retention', () => {
  const base = { projectRoot: '/Volumes/code-bank/tmp/scratch/zero-platform/doctor-logging', db: { mode: 'memory' as const }, tables: {}, auth: false as const, email: false as const, ai: false as const, pdf: false as const };
  expect(runPlatformDoctor(base, { env: {} }).findings.some(f => f.code.startsWith('logging.'))).toBe(false);
  const findings = runPlatformDoctor({ ...base, logging: true }, { env: {} }).findings;
  expect(findings.some(f => f.code === 'logging.api.no_auth')).toBe(true);
  expect(findings.some(f => f.code === 'logging.retention.indefinite')).toBe(true);
  expect(findings.some(f => f.code === 'logging.coverage.declared')).toBe(true);
  expect(findings.some(f => /compliance.*ready|certified/.test(f.code))).toBe(false);
});
