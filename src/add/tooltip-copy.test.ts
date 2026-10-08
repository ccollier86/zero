/** Tooltip source-copy surface qualification; planning alone does not create an app or execute config. */
import { expect, test } from 'bun:test';
import { addZeroSource } from './copy';

test('tooltip copying includes production primitives and excludes tests and synthetic browser apps', async () => {
  const result = await addZeroSource({
    targetDir: '/Volumes/code-bank/tmp/scratch/zero-platform/tooltip-copy-plan-only',
    items: ['components/tooltip'], dryRun: true,
  });
  expect(result.filesWritten).toEqual([]);
  expect(result.filesPlanned).toContain('components/tooltip/index.ts');
  expect(result.filesPlanned).toContain('components/tooltip/tooltip-placement.ts');
  expect(result.filesPlanned).toContain('components/animate-ui/primitives/radix/tooltip.tsx');
  expect(result.filesPlanned).toContain('components/animate-ui/primitives/animate/tooltip.tsx');
  expect(result.filesPlanned).toContain('components/kbd/kbd.tsx');
  expect(result.filesPlanned.some(file => /\.(?:test|browser-fixture|test-fixture|package-fixture)\./u.test(file))).toBe(false);
  expect(result.filesPlanned).not.toContain('modals/modal-manager.tsx');
});
