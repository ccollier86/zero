import type { CreateZeroCliArgs } from './cli-args';
import type { ScaffoldZeroAppResult } from './scaffold';

/** Print the create-zero command reference. */
export function printCreateZeroUsage(): void {
  console.log(
    'Usage: create-zero <target-dir> [--name <name>] [--zero <specifier> | --local] [--template <dir>] [--install] [--force]'
  );
  console.log('');
  console.log('Examples:');
  console.log('  create-zero my-app');
  console.log('  create-zero my-app --name acme-crm');
  console.log('  create-zero my-app --zero ^1.2.1');
  console.log('  create-zero my-app --local');
  console.log('  create-zero my-app --local --install');
}

/** Print the successful scaffold summary only after its transactional commit. */
export function printCreateZeroSuccess(
  result: ScaffoldZeroAppResult,
  options: CreateZeroCliArgs
): void {
  console.log('');
  console.log('Zero app created');
  console.log('----------------');
  console.log(`Directory: ${result.targetDir}`);
  console.log(`Package:   ${result.packageName}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${result.targetDir}`);
  if (!options.install) console.log('  bun install');
  console.log('  bun run dev');
  console.log('');
}
