/** Parse documented build switches strictly; no ambiguous targets or shell interpolation. */
import type { ZeroBuildOptions } from './build-types';

/** Parsed normal app build arguments, with a conventional root config default. */
export interface ZeroBuildArgs extends ZeroBuildOptions { readonly help: boolean }

/** Parse the optional config, existing app entry and server output settings. */
export function parseZeroBuildArgs(args: readonly string[]): ZeroBuildArgs {
  const values: Record<string, string | boolean> = {};
  const flags = new Map([['--config', 'configPath'], ['--entry', 'entryPath'], ['--outdir', 'outDir'], ['--outfile', 'outfile']]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    const key = flags.get(flag) ?? (flag === '--compile' ? 'compile' : flag === '--help' || flag === '-h' ? 'help' : undefined);
    if (!key) throw new Error(`Unknown Zero build option: ${flag}`);
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate Zero build option: ${flag}`);
    if (key === 'compile' || key === 'help') { values[key] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('-')) throw new Error(`Missing value for ${flag}`);
    values[key] = value;
  }
  if (values.outfile && !values.compile) throw new Error('--outfile requires --compile.');
  return { configPath: String(values.configPath ?? './zero.config.ts'), entryPath: values.entryPath as string | undefined, outDir: values.outDir as string | undefined, outfile: values.outfile as string | undefined, compile: values.compile === true, help: values.help === true };
}
