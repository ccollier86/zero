import { expect, test } from 'bun:test';

type SchedulerLock = {
  workspaces: { '': { dependencies: { croner?: string } } };
  packages: { croner: [string, ...unknown[]] };
};

test('native scheduling directly declares the same Croner engine as the frozen dependency graph', async () => {
  const manifest = await Bun.file(new URL('../../package.json', import.meta.url)).json();
  const lock = Bun.JSON5.parse(await Bun.file(new URL('../../bun.lock', import.meta.url)).text()) as SchedulerLock;
  const declared = manifest.dependencies.croner;

  // Zero imports Croner itself. A transitive Elysia plugin dependency must not
  // decide which engine native cron/DST semantics use in an installed app.
  expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
  expect(lock.workspaces[''].dependencies.croner).toBe(declared);
  expect(lock.packages.croner[0]).toBe(`croner@${declared}`);
});
