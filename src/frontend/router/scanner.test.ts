/**
 * scanner.test.ts
 *
 * Verifies file-router discovery and client-boundary directive detection.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasUseClientDirective } from './scanner';

let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe('hasUseClientDirective', () => {
  test('accepts either quote style as the first executable statement', () => {
    expect(hasDirective('"use client";\nexport default function Page() {}')).toBe(
      true,
    );
    expect(hasDirective("'use client'\nexport default function Page() {}")).toBe(
      true,
    );
  });

  test('allows file front matter and line comments before the directive', () => {
    expect(hasDirective(`
/**
 * page.tsx
 *
 * Owns an interactive route.
 */
// Hydrate this route branch.
'use client';
export default function Page() {}
`)).toBe(true);
  });

  test('rejects comments or later statements that merely mention the directive', () => {
    expect(hasDirective('// "use client"\nexport default function Page() {}')).toBe(
      false,
    );
    expect(hasDirective('"use clientish";\nexport default function Page() {}')).toBe(
      false,
    );
    expect(hasDirective('import React from "react";\n"use client";')).toBe(false);
  });
});

/** Write one temporary route module and evaluate its boundary directive. */
function hasDirective(source: string): boolean {
  testDir ??= mkdtempSync(join(tmpdir(), 'zero-scanner-'));
  const routePath = join(testDir, `route-${crypto.randomUUID()}.tsx`);
  writeFileSync(routePath, source);
  return hasUseClientDirective(routePath);
}
