import { describe, expect, test } from 'bun:test';
import { resolveAuthAuditConfig } from './auth-audit-config';

describe('resolveAuthAuditConfig', () => {
  test('applies secure bounded defaults and normalizes a custom policy', () => {
    expect(resolveAuthAuditConfig(undefined)).toEqual({
      retentionDays: 365,
      pruneBatchSize: 1_000,
      pruneInterval: '6h',
      pruneIntervalMs: 6 * 60 * 60 * 1_000,
    });
    expect(resolveAuthAuditConfig({
      retentionDays: 30,
      pruneBatchSize: 250,
      pruneInterval: '15m',
    })).toEqual({
      retentionDays: 30,
      pruneBatchSize: 250,
      pruneInterval: '15m',
      pruneIntervalMs: 15 * 60 * 1_000,
    });
  });

  test('rejects unknown, malformed, and unbounded retention settings', () => {
    expect(() => resolveAuthAuditConfig({ typo: true } as never))
      .toThrow('unknown key');
    expect(() => resolveAuthAuditConfig({ retentionDays: 0 }))
      .toThrow('between 1 and 3650');
    expect(() => resolveAuthAuditConfig({ pruneBatchSize: 10_001 }))
      .toThrow('between 1 and 10000');
    expect(() => resolveAuthAuditConfig({ pruneInterval: '59s' }))
      .toThrow('between 1m and 7d');
    expect(() => resolveAuthAuditConfig([] as never))
      .toThrow('must be an object');
  });
});
