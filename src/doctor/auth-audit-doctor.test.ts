import { describe, expect, test } from 'bun:test';
import { runPlatformDoctor } from './platform-doctor';

describe('platform doctor auth audit policy', () => {
  test('surfaces invalid audit retention policy as an auth config error', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {},
      auth: {
        audit: { retentionDays: 0 },
      },
      email: false,
    });

    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'auth.config.invalid',
      path: 'auth',
    }));
    expect(report.findings.find((finding) => finding.code === 'auth.config.invalid')?.message)
      .toContain('Audit retentionDays');
  });
});
