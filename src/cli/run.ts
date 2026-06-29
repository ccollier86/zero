#!/usr/bin/env bun
/**
 * run.ts
 *
 * Main Zero CLI dispatcher. This file owns subcommand routing only; each
 * command keeps its own parsing, output, and domain behavior in its subsystem.
 */

import { fileURLToPath } from 'node:url';

const args = Bun.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

switch (command) {
  case 'add': {
    const { runZeroAddCli } = await import('../add/run');
    process.exitCode = await runZeroAddCli(commandArgs);
    break;
  }
  case 'create': {
    const { runCreateZeroCli } = await import('../create-zero/run');
    process.exitCode = await runCreateZeroCli(commandArgs);
    break;
  }
  case 'doctor':
    process.exitCode = await runBunScript('../doctor/run.ts', commandArgs);
    break;
  case 'migrate':
    process.exitCode = await runBunScript('../migrations/run.ts', commandArgs);
    break;
  case '--help':
  case '-h':
  case undefined:
    printUsage();
    process.exitCode = command ? 0 : 1;
    break;
  default:
    console.error(`Unknown Zero command: ${command}`);
    printUsage();
    process.exitCode = 1;
}

async function runBunScript(relativeScript: string, scriptArgs: string[]): Promise<number> {
  const scriptPath = fileURLToPath(new URL(relativeScript, import.meta.url));
  const child = Bun.spawn([process.execPath, scriptPath, ...scriptArgs], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: Bun.env,
  });

  return child.exited;
}

function printUsage(): void {
  console.log('Usage: zero <command> [...args]');
  console.log('');
  console.log('Commands:');
  console.log('  add      Copy selected components/hooks into an app');
  console.log('  create   Create a new Zero app');
  console.log('  doctor   Run platform doctor');
  console.log('  migrate  Run migrations');
}
