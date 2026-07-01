#!/usr/bin/env bun
/**
 * run.ts
 *
 * Human-facing CLI for `zero add`. Console output is intentional here; reusable
 * source-copy behavior lives in copy.ts.
 */

import { addZeroSource } from './copy';
import { listStaticAddableTargets } from './registry';

interface ParsedAddArgs {
  items: string[];
  targetDir: string;
  force: boolean;
  dryRun: boolean;
  list: boolean;
  help: boolean;
}

/** Execute the `zero add` CLI and return a process exit code. */
export async function runZeroAddCli(args: string[] = Bun.argv.slice(2)): Promise<number> {
  let parsed: ParsedAddArgs;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  if (parsed.help) {
    printUsage();
    return 0;
  }

  if (parsed.list) {
    printAddableTargets();
    return 0;
  }

  if (parsed.items.length === 0) {
    printUsage();
    return 1;
  }

  try {
    const result = await addZeroSource({
      targetDir: parsed.targetDir,
      items: parsed.items,
      force: parsed.force,
      dryRun: parsed.dryRun,
    });

    console.log('');
    console.log(parsed.dryRun ? 'Zero add plan' : 'Zero add complete');
    console.log('-----------------');
    console.log(`Target:    ${result.targetDir}`);
    console.log(`Requested: ${result.requested.join(', ')}`);
    console.log(`Planned:   ${result.filesPlanned.length} file(s)`);
    if (!parsed.dryRun) console.log(`Written:   ${result.filesWritten.length} file(s)`);
    if (result.filesSkipped.length > 0) console.log(`Skipped:   ${result.filesSkipped.length} existing file(s)`);
    if (result.rewrites.length > 0) console.log(`Rewrites:  ${result.rewrites.length} import(s)`);
    console.log('');

    if (result.filesSkipped.length > 0 && !parsed.force) {
      console.log('Use --force to overwrite skipped files.');
      console.log('');
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

function parseArgs(args: string[]): ParsedAddArgs {
  const items: string[] = [];
  let targetDir = process.cwd();
  let force = false;
  let dryRun = false;
  let list = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--target':
        if (!args[index + 1] || args[index + 1].startsWith('-')) {
          throw new Error('[zero add] --target requires a directory path');
        }
        targetDir = args[index + 1];
        index += 1;
        break;
      case '--force':
        force = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--list':
        list = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`[zero add] Unknown option: ${arg}`);
        items.push(arg);
    }
  }

  return {
    items,
    targetDir,
    force,
    dryRun,
    list,
    help,
  };
}

function printUsage(): void {
  console.log('Usage: zero add <item...> [--target <dir>] [--force] [--dry-run]');
  console.log('');
  console.log('Examples:');
  console.log('  zero add components/ui/button');
  console.log('  zero add components/data-table --target ./my-app');
  console.log('  zero add components/hero');
  console.log('  zero add components/kanban');
  console.log('  zero add components/navbar');
  console.log('  zero add hooks modals --dry-run');
  console.log('');
  console.log('Run `zero add --list` to see supported items.');
}

function printAddableTargets(): void {
  console.log('Supported zero add items:');
  for (const target of listStaticAddableTargets()) {
    console.log(`  ${target.id.padEnd(26)} ${target.description}`);
  }
  console.log('  components/ui/<name>       One UI primitive from src/components/ui.');
}

if (import.meta.main) {
  process.exitCode = await runZeroAddCli();
}
