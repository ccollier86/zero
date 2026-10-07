/** Deterministic regressions for complete build-fixture markers; no compilation or application runtime is started. */
import { expect, test } from 'bun:test';
import { lstat, mkdtemp, rm } from 'node:fs/promises'; // Bun has no directory creation/removal/stat API.
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseBuildFixtureEntryTime, publishBuildFixtureMarker } from './build-fixture-readiness';

const started = 1_791_362_300_000, observed = started + 30_000;

test('empty, partial and noncanonical entry writes never switch to an expired app deadline', () => {
  for (const raw of ['', ' ', '\n', '179136', '1791362300', '0', '0001791362300000', '-1', '+1791362300000',
    '1.7913623e12', '1791362300000\n', 'NaN', 'Infinity', '-Infinity', '999999999999999999999999999999']) {
    expect(parseBuildFixtureEntryTime(raw, started, observed)).toBeUndefined();
  }
  // The old exists() + Number(text()) path converted an empty in-progress write
  // into epoch zero, causing immediate parent termination rather than admission.
  expect(Number('')).toBe(0);
  expect(parseBuildFixtureEntryTime('', started, observed)).toBeUndefined();
});

test('only safe timestamps inside the current startup window are admitted without changing timeout durations', () => {
  expect(parseBuildFixtureEntryTime(String(started), started, observed)).toBe(started);
  expect(parseBuildFixtureEntryTime(String(observed), started, observed)).toBe(observed);
  expect(parseBuildFixtureEntryTime(String(started + 25_000), started, observed)).toBe(started + 25_000);
  expect(parseBuildFixtureEntryTime(String(started - 1), started, observed)).toBeUndefined();
  expect(parseBuildFixtureEntryTime(String(observed + 1), started, observed)).toBeUndefined();
  for (const [begin, end] of [[NaN, observed], [started, Infinity], [started, started - 1], [0, observed],
    [started + 0.5, observed], [started, observed + 0.5]]) {
    expect(parseBuildFixtureEntryTime(String(started), begin!, end!)).toBeUndefined();
  }
});

test('marker publication replaces only the owned marker with complete contents and leaves no pending file', async () => {
  const scratch = resolve(tmpdir()), prefix = 'build-readiness-marker-';
  const root = await mkdtemp(join(scratch, prefix));
  try {
    const path = join(root, 'startup-entry.txt');
    await publishBuildFixtureMarker(path, String(started));
    expect(await Bun.file(path).text()).toBe(String(started));
    await publishBuildFixtureMarker(path, String(observed));
    expect(parseBuildFixtureEntryTime(await Bun.file(path).text(), started, observed)).toBe(observed);
    const files = await Array.fromAsync(new Bun.Glob('*').scan({ cwd: root, onlyFiles: true }));
    expect(files).toEqual(['startup-entry.txt']);
  } finally {
    const stat = await lstat(root);
    if (dirname(root) !== scratch || !basename(root).startsWith(prefix) || basename(root) === prefix
      || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Refusing cleanup outside the owned build-marker fixture.');
    await rm(root, { recursive: true, force: true });
  }
});
