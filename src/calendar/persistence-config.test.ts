/** Pure trusted-launch admission only: no actor construction, fixture files or generated roots. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { databaseActorFactoryLaunch } from '../databases/subprocess-database-executor-factory';
import { resolveCalendarConfig, type ResolvedCalendarConfig } from './config';
import { assertCalendarDefaultActorRuntime, resolveCalendarPersistenceConfig, type CalendarActorOverride } from './persistence-config';

const project = '/synthetic-zero-calendar-config';
const config = resolveCalendarConfig({ timezone: 'UTC' }, project, resolveAuthBehaviorConfig()) as ResolvedCalendarConfig;

test('calendar launch is a fixed dedicated entry with no inherited environment or dotenv', () => {
  const persistence = resolveCalendarPersistenceConfig(config, project);
  const launch = databaseActorFactoryLaunch(persistence.createExecutor)!;
  expect(launch.env).toEqual({});
  expect(launch.prefix).toContain('--no-env-file');
  expect(launch.prefix.at(-1)).toEndWith('/calendar/actor-entry.ts');
  expect(persistence.defaultActorEntrypoint).toBe(launch.prefix.at(-1)!);
  expect(Object.isFrozen(persistence)).toBe(true);
  expect(config).not.toHaveProperty('createExecutor');
});

test('trusted actor override is detached and cannot replace the private actor flag', () => {
  const input = { launch: { kind: 'source' as const, entrypoint: '/synthetic-calendar-actor.ts' }, env: { SYNTHETIC_ALLOWED: 'explicit' } };
  const persistence = resolveCalendarPersistenceConfig(config, project, input);
  input.launch.entrypoint = '/different.ts'; input.env.SYNTHETIC_ALLOWED = 'changed';
  expect(databaseActorFactoryLaunch(persistence.createExecutor)).toMatchObject({ prefix: [process.execPath, '--no-env-file', '/synthetic-calendar-actor.ts'], env: { SYNTHETIC_ALLOWED: 'explicit' } });
  expect(persistence.defaultActorEntrypoint).toBeNull();
  for (const actors of [
    { ...input, actorFlag: '--different' }, { launch: { kind: 'source', entrypoint: 'relative.ts' } },
    { get launch() { throw new Error('private'); } }, { ...input, env: { PRIVATE: 1 } },
  ]) expect(() => resolveCalendarPersistenceConfig(config, project, actors as CalendarActorOverride)).toThrow(expect.objectContaining({ code: 'CALENDAR_CONFIG_INVALID' }));
});

test('compiled parents cannot silently launch themselves as the default source calendar interpreter', () => {
  expect(() => assertCalendarDefaultActorRuntime('file:///$bunfs/root/server')).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
  expect(() => assertCalendarDefaultActorRuntime('file:///synthetic/dist/server.js')).not.toThrow();
  expect(() => assertCalendarDefaultActorRuntime('file:///$bunfs/root/server', { launch: { kind: 'bundle', entrypoint: '/synthetic/calendar-actor' } })).not.toThrow();
  expect(() => assertCalendarDefaultActorRuntime('file:///$bunfs/root/server', { launch: { kind: 'source', entrypoint: '/synthetic/actor.ts' } })).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
  expect(() => assertCalendarDefaultActorRuntime('file:///$bunfs/root/server', { launch: { kind: 'source', entrypoint: '/synthetic/actor.ts', runtimeExecutable: process.execPath } })).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
  expect(() => assertCalendarDefaultActorRuntime('file:///$bunfs/root/server', { launch: { kind: 'source', entrypoint: '/synthetic/actor.ts', runtimeExecutable: '/synthetic/bin/bun' } })).not.toThrow();
});
