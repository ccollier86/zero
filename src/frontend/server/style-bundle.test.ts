import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { buildPlatformStyles, scanTailwindCandidates } from './style-bundle';

describe('platform style bundle', () => {
  test('scans platform/app sources and emits a hashed stylesheet', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'zero-styles-'));

    try {
      const result = await buildPlatformStyles(outDir, './app');
      const css = await readFile(result.cssPath, 'utf8');

      expect(result.publicPath).toMatch(/^\/_build\/platform\.[a-f0-9]{12}\.css$/);
      expect(css).toContain('--color-background');
      expect(css).toContain('.bg-background');
      expect(css).toContain('.text-foreground');
      expect(css).toContain('.dark\\:bg-bg-inset\\/45');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test('scans platform sources when the app directory is missing', () => {
    const candidates = scanTailwindCandidates('./does-not-exist');

    expect(candidates).toContain('bg-background');
    expect(candidates).toContain('text-foreground');
  });
});
