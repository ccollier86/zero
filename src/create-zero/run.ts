#!/usr/bin/env bun
/**
 * run.ts
 *
 * Human-facing CLI for creating a Zero app. Console output is intentional here;
 * reusable scaffolding behavior lives in scaffold.ts.
 */

import { scaffoldZeroApp } from './scaffold';

/** Execute the create-zero CLI and return a process exit code. */
export async function runCreateZeroCli(args: string[] = Bun.argv.slice(2)): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return 0;
  }

  const targetDir = getTargetDir(args);
  if (!targetDir) {
    printUsage();
    return 1;
  }

  try {
    const result = await scaffoldZeroApp({
      targetDir,
      packageName: getArg(args, '--name') ?? undefined,
      zeroDependency: getArg(args, '--zero') ?? undefined,
      force: args.includes('--force'),
    });

    console.log('');
    console.log('Zero app created');
    console.log('----------------');
    console.log(`Directory: ${result.targetDir}`);
    console.log(`Package:   ${result.packageName}`);
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${targetDir}`);
    console.log('  bun install');
    console.log('  bun run dev');
    console.log('');
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

function getTargetDir(args: string[]): string | null {
  return args.find((arg) => !arg.startsWith('-')) ?? null;
}

function getArg(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function printUsage(): void {
  console.log('Usage: create-zero <target-dir> [--name <package-name>] [--zero <version>] [--force]');
  console.log('');
  console.log('Examples:');
  console.log('  create-zero my-app');
  console.log('  create-zero my-app --name acme-crm');
  console.log('  create-zero my-app --zero ^1.0.1');
}

if (import.meta.main) {
  process.exitCode = await runCreateZeroCli();
}
