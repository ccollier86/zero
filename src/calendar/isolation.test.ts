/** Pure lexical checks; canonicalization only reads existing ancestors and creates no filesystem fixtures. */
import { expect, test } from 'bun:test';
import { assertCalendarDirectoryIsolation, type CalendarDirectoryIsolationInput } from './isolation';

const base: CalendarDirectoryIsolationInput = {
  rootDirectory: '/synthetic-managed/private/calendar', outDir: '/synthetic-managed/public-build',
  storageDir: '/synthetic-managed/storage', generatedDir: '/synthetic-managed/generated',
  appDir: '/synthetic-managed/app', controlDatabasePaths: ['/synthetic-managed/control.sqlite'],
  applicationFabricRoot: '/synthetic-managed/private/application',
  featureRoots: ['/synthetic-managed/private/jobs', '/synthetic-managed/private/logging',
    '/synthetic-managed/private/messaging', '/synthetic-managed/private/blog'],
};

test('calendar admits a dedicated private conflict domain without opening files', () => {
  assertCalendarDirectoryIsolation(base);
  assertCalendarDirectoryIsolation(base, true);
});

test('calendar rejects exact, ancestor and descendant aliases for every feature-owned root', () => {
  for (const root of [...base.featureRoots!, base.applicationFabricRoot!, base.outDir, base.generatedDir, base.appDir, base.storageDir]) {
    for (const rootDirectory of [root, root + '/calendar']) {
      expect(() => assertCalendarDirectoryIsolation({ ...base, rootDirectory }))
        .toThrow(expect.objectContaining({ code: 'CALENDAR_CONFIG_INVALID' }));
    }
    expect(() => assertCalendarDirectoryIsolation({ ...base, rootDirectory: '/synthetic-managed' }))
      .toThrow(expect.objectContaining({ code: 'CALENDAR_CONFIG_INVALID' }));
  }
  expect(() => assertCalendarDirectoryIsolation({ ...base, rootDirectory: '/synthetic-managed/control.sqlite' }))
    .toThrow(expect.objectContaining({ code: 'CALENDAR_CONFIG_INVALID' }));
});
