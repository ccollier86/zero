/** Strict release-runner arguments; unsupported Bun worker/retry/skip flags are never forwarded implicitly. */

export const DEFAULT_TEST_TIMEOUT_MS = 120_000;
export const MAX_FILE_TIMEOUT_MS = 900_000;
export const MAX_TEST_PROCESSES = 4;
export interface TestSuiteCliOptions {
  testTimeoutMs: number;
  fileTimeoutMs: number;
  concurrency: number;
  list: boolean;
  help: boolean;
  patterns: string[];
}

/** Parse supported flags and optional path-substring selectors; every invalid argument is an explicit error. */
export function parseTestSuiteOptions(args: readonly string[]): TestSuiteCliOptions {
  const options: TestSuiteCliOptions = { testTimeoutMs: DEFAULT_TEST_TIMEOUT_MS, fileTimeoutMs: MAX_FILE_TIMEOUT_MS,
    concurrency: MAX_TEST_PROCESSES, list: false, help: false, patterns: [] };
  const seen = new Set<string>();
  let pathsOnly = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--') { pathsOnly = true; continue; }
    if (!pathsOnly && (argument === '--list' || argument === '--help' || argument === '-h')) {
      options[argument === '--list' ? 'list' : 'help'] = true; continue;
    }
    if (!pathsOnly && argument.startsWith('-')) {
      const equal = argument.indexOf('=');
      const name = equal < 0 ? argument : argument.slice(0, equal);
      const inline = equal < 0 ? undefined : argument.slice(equal + 1);
      const limits: Record<string, [keyof Pick<TestSuiteCliOptions, 'testTimeoutMs' | 'fileTimeoutMs' | 'concurrency'>, number]> = {
        '--timeout': ['testTimeoutMs', DEFAULT_TEST_TIMEOUT_MS], '--file-timeout': ['fileTimeoutMs', MAX_FILE_TIMEOUT_MS],
        '--concurrency': ['concurrency', MAX_TEST_PROCESSES],
      };
      const specification = limits[name!];
      if (!specification) throw new Error(`Unsupported test-suite option: ${name}. Use --help for the explicit argument contract.`);
      if (seen.has(name!)) throw new Error(`Duplicate test-suite option: ${name}.`);
      seen.add(name!);
      const raw = inline ?? args[++index];
      const value = raw !== undefined && /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(value) || value < 1 || value > specification[1]) {
        throw new Error(`${name} requires an integer from 1 to ${specification[1]}.`);
      }
      options[specification[0]] = value; continue;
    }
    if (!argument || argument.startsWith('-')) throw new Error(`Invalid test-file selector: ${argument}.`);
    options.patterns.push(argument.replace(/^\.\//, ''));
  }
  return options;
}

export const TEST_SUITE_HELP = `Usage: bun run test [--timeout 120000] [--file-timeout 900000] [--concurrency 4] [--list] [paths...]
Runs each discovered Bun test/spec file once in a fresh Bun OS process, at most four at a time.
Reviewed full-framework pack/install/compile consumers share one admission slot; ordinary files remain parallel.
--timeout sets the default per-test deadline (1..120000 ms); explicit test deadlines remain authoritative.
--file-timeout caps each process lifetime (1..900000 ms); termination and descendant validation have separate finite grace.
--concurrency selects 1..4 child processes. --list prints the deterministic inventory without executing tests.
Paths are optional substring selectors; no paths means the full inventory, including actor-entry tests.
No worker/isolate, retry, rerun, skip, snapshot-update or coverage flags are accepted.
Status/inventory/final summary are JSON lines on stdout; tagged test output goes to stderr.\n`;
