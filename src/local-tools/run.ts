#!/usr/bin/env bun
/** Installed launchers consume saved packages, never source from a live checkout. */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { archivePath, command, publishMain, readStableRelease, withStablePackage, writeJsonAtomic } from './stable-release';
import type { StableRelease, ToolsConfig } from './stable-release';

const DEPENDENCY = 'file:./.zero/framework/zero-framework.tgz';

function report(config: ToolsConfig, release: StableRelease): void {
  console.log(`Zero ${release.version} · main ${release.commit.slice(0, 12)}`);
  console.log(`Archive: ${archivePath(config, release)}`);
  console.log(`SHA-256: ${release.sha256}`);
}

async function runChild(argv: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(argv, { cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${argv[0]} failed with exit code ${code}`);
}

function help(action: string): void {
  const usage: Record<string, string> = {
    new: 'zero-new [target-dir] [--skip-install] [--name <name>] [--force]',
    update: 'zero-update [project-dir] [--dry-run] [--check]',
    release: 'zero-release [--status]',
    doctor: 'zero-doctor [doctor options] (run inside an installed app)',
  };
  console.log(`Usage: ${usage[action] ?? 'zero-release --status'}`);
  console.log('zero-new and zero-update use the saved committed-main package. No working-tree fallback.');
  console.log('zero-release packages local main; --status shows the saved version without refreshing it.');
}

export async function runStableTool(config: ToolsConfig, action: string, args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { help(action); return 0; }
  if (action === 'auto-release') {
    if (args.length) throw new Error('auto-release does not accept arguments');
    const branch = await command(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], config.repo);
    if (branch !== 'main') return 0;
    report(config, await publishMain(config));
    return 0;
  }
  if (action === 'release') {
    if (args.length && (args.length !== 1 || args[0] !== '--status')) throw new Error('Usage: zero-release [--status]');
    report(config, args[0] === '--status' ? await readStableRelease(config) : await publishMain(config));
    return 0;
  }
  if (action === 'doctor') {
    const entry = resolve('node_modules/@zero/framework/src/doctor/run.ts');
    if (!await Bun.file(entry).exists()) throw new Error('Run zero-doctor inside an app after bun install.');
    await runChild(['bun', entry, ...args], process.cwd());
    return 0;
  }
  if (action !== 'new' && action !== 'update') throw new Error(`Unknown Zero tool: ${action}`);
  return withStablePackage(config, async (directory, release, archive) => {
    console.log(`Using saved Zero ${release.version} from main ${release.commit.slice(0, 12)}`);
    const module = (path: string) => import(pathToFileURL(join(directory, path)).href);
    if (action === 'new') {
      // Keep the strict committed parser; add only the wrapper's default target/install behavior.
      const normalized: string[] = [];
      let target = false;
      let install = true;
      for (let index = 0; index < args.length; index++) {
        const argument = args[index]!;
        if (argument === '--skip-install' || argument === '--no-install') { install = false; continue; }
        if (argument === '--install') continue;
        if (/^--(?:local|zero|template)(?:=|$)/.test(argument)) {
          throw new Error(`${argument} cannot override the stable package or template. Use create-zero directly for development.`);
        }
        normalized.push(argument);
        if (argument === '--name') {
          if (args[index + 1]) normalized.push(args[++index]!);
        } else if (!argument.startsWith('-')) target = true;
      }
      if (!target) normalized.push('.');
      const { parseCreateZeroArgs } = await module('src/create-zero/cli-args.ts');
      const options = parseCreateZeroArgs(normalized);
      const { scaffoldZeroApp } = await module('src/create-zero/scaffold.ts');
      const result = await scaffoldZeroApp({
        targetDir: options.targetDir, packageName: options.packageName, force: options.force,
        zeroDependency: DEPENDENCY,
        async prepareStagedApp(staging: string) {
          await mkdir(join(staging, '.zero/framework'), { recursive: true });
          await copyFile(archive, join(staging, '.zero/framework/zero-framework.tgz'));
          await writeJsonAtomic(join(staging, 'zero-release.json'), release);
          if (install) await runChild(['bun', 'install'], staging);
        },
      });
      const { printCreateZeroSuccess } = await module('src/create-zero/cli-output.ts');
      printCreateZeroSuccess(result, { ...options, install });
      return 0;
    }
    for (const argument of args) {
      if (/^--(?:local|latest)(?:=|$)/.test(argument)) throw new Error(`${argument} cannot override the saved stable package.`);
    }
    const normalized = [...args];
    if (normalized[0] && !normalized[0].startsWith('-')) normalized.splice(0, 1, '--project', normalized[0]);
    normalized.push('--local', directory);
    const { runZeroUpdateCli, parseZeroUpdateArgs } = await module('src/update/run.ts');
    const options = parseZeroUpdateArgs(normalized);
    const code = await runZeroUpdateCli(normalized, {
      packLocalFramework: async () => ({ archivePath: archive, cleanup: async () => {} }),
    });
    if (code === 0 && !options.dryRun) await writeJsonAtomic(join(resolve(options.projectDir), 'zero-release.json'), release);
    return code;
  });
}

if (import.meta.main) {
  try {
    const config: ToolsConfig = JSON.parse(await readFile(join(import.meta.dir, 'config.json'), 'utf8'));
    process.exitCode = await runStableTool(config, Bun.argv[2] ?? '', Bun.argv.slice(3));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
