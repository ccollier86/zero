import { describe, expect, test } from 'bun:test';
import { matchesPathPattern } from './usage-audit-scanner';

describe('Doctor usage path patterns', () => {
  test('globstar matches zero or multiple nested directories without rewriting its own wildcard', () => {
    for (const path of ['record.test.ts', 'app/record.test.ts', 'app/deep/record.test.ts']) {
      expect(matchesPathPattern(path, '**/*.test.ts')).toBe(true);
    }
    expect(matchesPathPattern('app/deep/generated/further/record.ts', '**/generated/**')).toBe(true);
    expect(matchesPathPattern('generated/record.ts', '**/generated/**')).toBe(true);
    expect(matchesPathPattern('app/other.ts', '**/*.test.ts')).toBe(false);
  });

  test('ordinary stars stay segment-local and literal paths retain directory prefix semantics', () => {
    expect(matchesPathPattern('app/record.tsx', 'app/*.tsx')).toBe(true);
    expect(matchesPathPattern('app/deep/record.tsx', 'app/*.tsx')).toBe(false);
    expect(matchesPathPattern('app/deep/record.tsx', 'app/**')).toBe(true);
    expect(matchesPathPattern('app/deep/record.tsx', 'app/deep')).toBe(true);
    expect(matchesPathPattern('app/deeper/record.tsx', 'app/deep')).toBe(false);
    expect(matchesPathPattern('app/a+b.ts', 'app/a+b.ts')).toBe(true);
    expect(matchesPathPattern('app/ab.ts', 'app/a+b.ts')).toBe(false);
  });
});
