/** Pure opt-in declarations and ownership admission. No databases, dependency trees, actors or timers are allocated. */
import { expect, test } from 'bun:test';
import { resolveConfig } from '../frontend/server/types';
import { defineJob } from './definition';
const definition = defineJob({ name: 'synthetic.report', version: '1', workflow: { name: 'synthetic.report', version: 1 }, access: 'user', parseInput: value => value });
const base = { projectRoot: '/synthetic-zero-jobs', db: { mode: 'memory' as const }, tables: {}, ai: false as const, email: false as const };
test('jobs remain inert unless enabled and require Guardian plus Torrent without silently enabling explicitly disabled services', () => {
  expect(resolveConfig(base).jobs).toBe(false); expect(resolveConfig({ ...base, jobs: false }).jobs).toBe(false);
  expect(resolveConfig({ ...base, jobs: true })).toMatchObject({ jobs: { batchSize: 32, concurrency: 100 }, auth: {}, workflows: {} });
  expect(() => resolveConfig({ ...base, auth: false, jobs: true })).toThrow();
  expect(() => resolveConfig({ ...base, workflows: false, jobs: true })).toThrow();
  expect(resolveConfig({ ...base, jobs: { definitions: [definition], concurrency: 1 } }).jobs).toMatchObject({ concurrency: 1 });
});
test('private job roots cannot overlap control/build/assets/Storage/other feature roots', () => {
  for (const rootDirectory of ['/synthetic-zero-jobs/.build', '/synthetic-zero-jobs/app', '/synthetic-zero-jobs/.storage', '/synthetic-zero-jobs/.zero/generated']) {
    expect(() => resolveConfig({ ...base, storageDir: '/synthetic-zero-jobs/.storage', jobs: { rootDirectory } })).toThrow();
  }
  expect(() => resolveConfig({ ...base, auth: true, logging: { preset: 'activity', rootDirectory: '/synthetic-zero-jobs/shared-private' },
    jobs: { rootDirectory: '/synthetic-zero-jobs/shared-private' } })).toThrow();
});
