/** Canonical repository test CLI: deterministic inventory, four fresh Bun processes, structured evidence and owned cleanup. */
import { discoverTestSuiteFiles } from './test-suite-discovery';
import { parseTestSuiteOptions, TEST_SUITE_HELP } from './test-suite-options';
import { runTestSuite } from './test-suite-runner';

async function main(): Promise<number> {
  const options = parseTestSuiteOptions(Bun.argv.slice(2));
  if (options.help) { await Bun.write(Bun.stdout, TEST_SUITE_HELP); return 0; }
  const root = process.cwd(), allFiles = await discoverTestSuiteFiles(root);
  const files = options.patterns.length ? allFiles.filter(file => options.patterns.some(pattern => file.includes(pattern))) : allFiles;
  if (!files.length) throw new Error('No test files match the requested inventory; no pass-with-no-tests fallback is permitted.');
  await Bun.write(Bun.stdout, `${JSON.stringify({ type: 'test-suite-inventory', count: files.length, files })}\n`);
  if (options.list) return 0;
  const controller = new AbortController();
  const interrupt = (signal: 'SIGINT' | 'SIGTERM') => { if (!controller.signal.aborted) controller.abort(signal); };
  const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const summary = await runTestSuite({ root, files, ...options, signal: controller.signal,
      event: event => Bun.write(Bun.stdout, `${JSON.stringify(event)}\n`).then(() => {}),
      output: async (file, channel, text) => { await Bun.write(Bun.stderr, `[${file}:${channel}] ${text}${text.endsWith('\n') ? '' : '\n'}`); },
    });
    return summary.exitCode;
  } finally { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); }
}

if (import.meta.main) {
  try { process.exitCode = await main(); }
  catch (error) {
    await Bun.write(Bun.stderr, `${JSON.stringify({ type: 'test-suite-error', message: error instanceof Error ? error.message : 'Test runner failed.' })}\n`);
    process.exitCode = 2;
  }
}
