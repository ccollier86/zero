/** Argument admission proves the runner cannot silently turn retry/worker/skip flags into a passing subset. */
import { expect, test } from 'bun:test';
import { parseTestSuiteOptions } from './test-suite-options';

test('defaults to four fresh processes with separate bounded test/file deadlines', () => {
  expect(parseTestSuiteOptions([])).toEqual({ concurrency: 4, testTimeoutMs: 120000, fileTimeoutMs: 900000,
    list: false, help: false, patterns: [] });
  expect(parseTestSuiteOptions(['--timeout', '120000', '--concurrency=2', '--file-timeout=3000', '--list', './src/presence']))
    .toMatchObject({ concurrency: 2, testTimeoutMs: 120000, fileTimeoutMs: 3000, list: true, patterns: ['src/presence'] });
});
test('unsupported, duplicated and unbounded flags fail explicitly', () => {
  for (const argument of ['--parallel=4', '--isolate', '--retry=1', '--rerun-each=2', '--path-ignore-patterns=**/actor*',
    '--only', '--pass-with-no-tests', '--coverage', '--timeout=120001', '--file-timeout=900001', '--concurrency=5',
    '--timeout=0', '--timeout=-1', '--timeout=2=3', '--timeout=NaN', '--concurrency=1.5', '--timeout=']) {
    expect(() => parseTestSuiteOptions([argument])).toThrow();
  }
  expect(() => parseTestSuiteOptions(['--timeout'])).toThrow();
  expect(() => parseTestSuiteOptions(['--timeout', '100', '--timeout=200'])).toThrow('Duplicate');
});
