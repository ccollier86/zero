#!/usr/bin/env bun
/**
 * run.ts
 *
 * Human-facing CLI for creating a Zero app. Console output is intentional here;
 * reusable scaffolding behavior lives in scaffold.ts.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCreateZeroArgs } from './cli-args';
import { printCreateZeroSuccess, printCreateZeroUsage } from './cli-output';
import {
  installLocalFrameworkArchive,
  LOCAL_FRAMEWORK_DEPENDENCY,
  packLocalFramework,
} from './local-framework-package';
import { scaffoldZeroApp } from './scaffold';

/** Execute the create-zero CLI and return a process exit code. */
export async function runCreateZeroCli(args: string[] = Bun.argv.slice(2)): Promise<number> {
  try {
    const options = parseCreateZeroArgs(args);
    if (options.help) {
      printCreateZeroUsage();
      return 0;
    }
    const result = await scaffoldZeroApp({
      targetDir: options.targetDir,
      packageName: options.packageName,
      zeroDependency: options.zeroDependency ?? (options.local ? LOCAL_FRAMEWORK_DEPENDENCY : undefined),
      force: options.force,
      templateDir: options.templateDir,
      async prepareStagedApp(stagingDir) {
        if (options.local) {
          const frameworkDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
          const localPackage = await packLocalFramework(frameworkDir);
          try {
            await installLocalFrameworkArchive(localPackage.archivePath, stagingDir);
          } finally {
            await localPackage.cleanup();
          }
        }
        if (options.install) {
          const exitCode = await runInstall(stagingDir);
          if (exitCode !== 0) throw new InstallFailedError(exitCode);
        }
      },
    });

    printCreateZeroSuccess(result, options);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return error instanceof InstallFailedError ? error.exitCode : 1;
  }
}

async function runInstall(targetDir: string): Promise<number> {
  console.log('Installing dependencies...');
  const child = Bun.spawn(['bun', 'install'], {
    cwd: targetDir,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: Bun.env,
  });

  const exitCode = await child.exited;
  return exitCode;
}

class InstallFailedError extends Error {
  constructor(readonly exitCode: number) {
    super(`[create-zero] bun install failed with exit code ${exitCode}`);
  }
}

if (import.meta.main) {
  process.exitCode = await runCreateZeroCli();
}
