/** Compile the shipped desktop/mobile/broker recipes through the public package map. */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, test } from 'bun:test';

const outputDir = join(process.cwd(), '.zero/native-recipe-smoke');

describe('native auth package recipes', () => {
  beforeAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  test('desktop loopback factory builds for Bun shells', async () => {
    await buildRecipe('desktop.ts', 'bun');
  });

  test('mobile browser-session factory builds for app runtimes', async () => {
    await buildRecipe('mobile.ts', 'browser');
  });

  test('broker IPC recipe builds for app runtimes', async () => {
    await buildRecipe('broker.ts', 'browser');
  });
});

async function buildRecipe(name: string, target: 'bun' | 'browser'): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(process.cwd(), 'examples/native-auth', name)],
    outdir: join(outputDir, target),
    target,
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join('\n'));
  }
}
