/** Pure composition admission only: no app startup, generated output, files, actors or providers. */
import { expect, test } from 'bun:test';
import { resolveConfig, type AppConfig } from './types';
import { assertManagedAppLoggingIsolation } from './app-logging-isolation';

const projectRoot = '/synthetic-calendar-managed-project';
const base: AppConfig = { projectRoot, db: { mode: 'memory' }, tables: {},
  storageDir: projectRoot + '/private/storage', outDir: './public-build', appDir: './app', generatedDir: './generated' };
const invalid = expect.objectContaining({ code: 'CALENDAR_CONFIG_INVALID' });

test('calendar is absent by default and does not enable Guardian or any calendar placement', () => {
  const omitted = resolveConfig(base, {}), disabled = resolveConfig({ ...base, calendar: false }, {});
  expect(omitted.calendar).toBe(false);
  expect(disabled.calendar).toBe(false);
  expect(omitted.auth).toBe(false);
  expect(disabled.auth).toBe(false);
  assertManagedAppLoggingIsolation(omitted);
});

test('opt-in calendar uses the normal Guardian default without overriding explicit auth:false', () => {
  const enabled = resolveConfig({ ...base, calendar: true, workflows: false }, {});
  expect(enabled.auth).not.toBe(false);
  expect(enabled.workflows).toBe(false);
  expect(enabled.jobs).toBe(false);
  expect(enabled.calendar).toMatchObject({ rootDirectory: projectRoot + '/data/zero.calendar',
    readiness: 'setup-required', timezone: null, recurrence: false, reminders: false, selfBooking: false });
  expect(() => resolveConfig({ ...base, calendar: true, auth: false }, {})).toThrow(invalid);
});

test('one-off calendar can be configured without Torrent, Jobs, Workers or outbound providers', () => {
  const enabled = resolveConfig({ ...base, calendar: { timezone: 'UTC' }, workflows: false,
    jobs: false, workers: false, messaging: false, ai: false, email: false }, {});
  expect(enabled.calendar).toMatchObject({ readiness: 'configured', timezone: 'UTC' });
  expect(enabled.jobs).toBe(false);
  expect(enabled.workers).toBe(false);
  expect(enabled.workflows).toBe(false);
  for (const capability of ['recurrence', 'reminders', 'selfBooking']) {
    expect(() => resolveConfig({ ...base, calendar: { [capability]: true } as never }, {}))
      .toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
  }
});

test('calendar placement cannot overlap assets, Storage or retained application/control paths', () => {
  for (const rootDirectory of [projectRoot + '/public-build/private', projectRoot + '/generated/calendar',
    projectRoot + '/app/private', projectRoot + '/private/storage/calendar', projectRoot + '/private/storage']) {
    expect(() => resolveConfig({ ...base, calendar: { rootDirectory } }, {})).toThrow(invalid);
  }
  for (const path of [projectRoot + '/private/calendar/app.sqlite', projectRoot + '/private/calendar']) {
    expect(() => resolveConfig({ ...base, db: { mode: 'file', path },
      calendar: { rootDirectory: projectRoot + '/private/calendar' } }, {})).toThrow(invalid);
    expect(() => resolveConfig({ ...base, systemDb: { mode: 'file', path },
      calendar: { rootDirectory: projectRoot + '/private/calendar' } }, {})).toThrow(invalid);
  }
});

test('calendar placement rejects every known feature-owned private root in lexical composition', () => {
  const rootDirectory = projectRoot + '/private/calendar';
  for (const config of [
    { jobs: { rootDirectory } },
    { messaging: { rootDirectory } },
    { logging: { rootDirectory } },
    { blog: { content: { rootDirectory } } },
  ]) {
    expect(() => resolveConfig({ ...base, ...config, calendar: { rootDirectory } }, {})).toThrow(invalid);
  }
  // Disabled services retain their well-known private namespaces; calendar must not take them over.
  for (const directory of ['zero.logs', 'zero.blog', 'zero.messaging', 'zero.jobs']) {
    expect(() => resolveConfig({ ...base, calendar: { rootDirectory: 'data/' + directory },
      logging: false, blog: false, messaging: false, jobs: false }, {})).toThrow(invalid);
  }
});
