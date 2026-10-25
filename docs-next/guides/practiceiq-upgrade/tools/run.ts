/** run.ts: explicit preparation/verification commands only; never installs Zero, starts an app, migrates data or restores backups. */
import { captureSource, compareSource, sourceBaseline } from './source-guard';
import { compareTables, inspectOfflineSQLite, tableNames } from './offline-sqlite';
import { directory, fail, initializeRehearsal, readReport, rehearsal, writeReport } from './safety';
import { checkTableMap } from './table-map';

/** Parse a closed command/option surface; duplicate or unknown options fail. */
export async function run(args: readonly string[]): Promise<void> {
  const command = args[0];
  const options = new Map<string, string>();
  const allowed: Record<string, readonly string[]> = {
    init: ['project', 'rehearsal'],
    'source-baseline': ['project', 'rehearsal', 'out'],
    'check-package': ['project', 'rehearsal', 'before', 'expect-commit', 'expect-sha256'],
    'check-protected': ['project', 'rehearsal', 'before', 'expect-commit', 'expect-sha256'],
    'sqlite-snapshot': ['project', 'rehearsal', 'database', 'tables', 'out'],
    'compare-tables': ['project', 'rehearsal', 'before', 'after', 'tables'],
    'check-table-map': ['project', 'rehearsal', 'before', 'plan'],
  };
  if (!command || !Object.hasOwn(allowed, command)) fail('UPGRADE_COMMAND_INVALID');
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--') || !allowed[command]!.includes(flag.slice(2)) || options.has(flag.slice(2))) fail('UPGRADE_OPTION_INVALID');
    options.set(flag.slice(2), value);
  }
  const required = (name: string): string => options.get(name) ?? fail('UPGRADE_OPTION_REQUIRED');
  const project = directory(required('project'));
  const target = required('rehearsal');
  if (command === 'init') { initializeRehearsal(project, target); return; }
  const root = rehearsal(project, target);
  if (command === 'source-baseline') {
    writeReport(root, required('out'), await captureSource(project));
  } else if (command === 'check-package' || command === 'check-protected') {
    const before = sourceBaseline(readReport(root, required('before')));
    compareSource(before, await captureSource(project, false), command === 'check-package' ? 'package' : 'protected',
      { commit: required('expect-commit'), sha256: required('expect-sha256') });
  } else if (command === 'sqlite-snapshot') {
    const selected = options.has('tables') ? tableNames(required('tables').split(',')) : undefined;
    writeReport(root, required('out'), inspectOfflineSQLite(root, required('database'), selected));
  } else if (command === 'check-table-map') {
    checkTableMap(readReport(root, required('before')), readReport(root, required('plan')));
  } else {
    compareTables(readReport(root, required('before')), readReport(root, required('after')), required('tables').split(','));
  }
}

if (import.meta.main) {
  try { await run(Bun.argv.slice(2)); process.stdout.write('Upgrade verification completed; no migration was executed.\n'); }
  catch (error) {
    const code = error instanceof Error && /^UPGRADE_[A-Z_]+$/.test(error.message) ? error.message : 'UPGRADE_CHECK_FAILED';
    process.stderr.write(`${code}\n`); process.exitCode = 1;
  }
}
