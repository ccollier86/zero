/** Canonical repository test CLI: deterministic inventory, four fresh Bun processes, structured evidence and owned cleanup. */
import { discoverTestSuiteFiles } from './test-suite-discovery';
import { parseTestSuiteOptions, TEST_SUITE_HELP } from './test-suite-options';
import { runTestSuite } from './test-suite-runner';
import { createTestSuiteConsoleWriter, type TestSuiteConsoleWriter } from './test-suite-console-writer';
import { createTestSuiteFailureReceipt, type TestSuiteFailureAccounting, type TestSuiteFailureReceipt } from './test-suite-failure-receipt';

async function main(consoleOutput: TestSuiteConsoleWriter, argv: readonly string[], receipt: TestSuiteFailureReceipt,
  accounting: TestSuiteFailureAccounting): Promise<number> {
  const options = parseTestSuiteOptions(argv);
  if (options.help) { await consoleOutput.write('stdout', TEST_SUITE_HELP); return 0; }
  const root = process.cwd(), allFiles = await discoverTestSuiteFiles(root);
  const files = options.patterns.length ? allFiles.filter(file => options.patterns.some(pattern => file.includes(pattern))) : allFiles;
  if (!files.length) throw new Error('No test files match the requested inventory; no pass-with-no-tests fallback is permitted.');
  const controller = new AbortController();
  const interrupt = (signal: 'SIGINT' | 'SIGTERM') => { if (!controller.signal.aborted) controller.abort(signal); };
  const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    await consoleOutput.write('stdout', `${JSON.stringify({ type: 'test-suite-inventory', count: files.length, files,
      failureReport: receipt.path, failureReportDirectory: receipt.directory })}\n`, controller.signal);
    if (options.list) return 0;
    const summary = await runTestSuite({ root, files, ...options, signal: controller.signal,
      event: event => {
        if (event.type === 'test-suite-start') accounting.total = event.total;
        if (event.type === 'test-file-start') accounting.started++;
        if (event.type === 'test-file-result') accounting.completed++;
        // Only the final summary runs after worker retirement; give it a fresh
        // retirement signal so an aborted root can still emit cancellation accounting.
        if (event.type !== 'test-suite-summary' && controller.signal.aborted) return;
        return consoleOutput.write('stdout', `${JSON.stringify(event)}\n`,
          event.type === 'test-suite-summary' ? AbortSignal.timeout(1000) : controller.signal);
      },
      output: (file, channel, text, signal) => consoleOutput.write('stderr', `[${file}:${channel}] ${text}${text.endsWith('\n') ? '' : '\n'}`, signal),
    });
    return summary.exitCode;
  } finally { accounting.workersSettled = true; process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); }
}

/** Internal CLI boundary shared with synthetic failure fixtures; no public framework facade or retry policy. */
export async function runTestSuiteCli(consoleOutput = createTestSuiteConsoleWriter(), argv: readonly string[] = Bun.argv.slice(2),
  makeReceipt = createTestSuiteFailureReceipt): Promise<number> {
  let receipt: TestSuiteFailureReceipt | undefined, exitCode = 2, retainedFailure = false;
  const accounting = { total: 0, started: 0, completed: 0, workersSettled: false };
  const record = async (stage: 'main' | 'close' | 'cleanup') => {
    retainedFailure = true;
    // A broken console cannot acknowledge this report; the independently owned artifact is the fallback.
    try { await receipt?.persist(stage, consoleOutput.diagnostics(), accounting); } catch { /* Exit remains a strict infrastructure failure. */ }
  };
  try { receipt = await makeReceipt(); exitCode = await main(consoleOutput, argv, receipt, accounting); }
  catch (error) {
    await record('main');
    try {
      await consoleOutput.write('stderr', `${JSON.stringify({ type: 'test-suite-error', message: error instanceof Error ? error.message : 'Test runner failed.' })}\n`,
        AbortSignal.timeout(1000));
    } catch { /* The already-failed output writer cannot safely emit another record. */ }
    exitCode = 2;
  }
  finally {
    try { await consoleOutput.close(); }
    catch { await record('close'); exitCode = 2; }
    if (!retainedFailure) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([receipt?.remove(), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Owned diagnostic-directory cleanup exceeded its retirement boundary.')), 1000);
        })]);
      } catch {
        // A late removal owns only the original directory, never this replacement.
        exitCode = 2;
        try { receipt = await makeReceipt(); await record('cleanup'); }
        catch { /* A failed fallback must not change the infrastructure exit. */ }
      } finally { clearTimeout(timer); }
    }
  }
  return exitCode;
}

if (import.meta.main) process.exitCode = await runTestSuiteCli();
