/** Source-copy plans stay browser-safe and exclude synthetic test harnesses. */
import { expect, test } from 'bun:test';
import { addZeroSource } from './copy';
test('vector visualization source-copy includes presentation, contracts and theme skin', async () => {
  const result = await addZeroSource({ targetDir: '/Volumes/code-bank/tmp/scratch/zero-platform/vector-visualization-copy-plan',
    items: ['components/vector-visualization'], dryRun: true });
  expect(result.filesPlanned).toContain('components/vector-visualization/index.ts');
  expect(result.filesPlanned).toContain('components/vector-visualization/vector-visualization.css');
  expect(result.rewrites.some(item => item.to === '@zero/framework/vector/visualization')).toBe(true);
  expect(result.filesPlanned.some(path => path.includes('visualization-service'))).toBe(false);
  expect(result.filesPlanned.some(path => path.includes('.test.') || path.includes('test-fixtures') || path.includes('.test-data.'))).toBe(false);
});
