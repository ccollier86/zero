/** Human-facing normal build CLI; source/config errors stop the build with a nonzero result. */
import { buildZeroApp } from './build-app';
import { parseZeroBuildArgs } from './build-args';

/** Build using declared plugins/assets while retaining the app entry's own runtime behavior. */
export async function runZeroBuildCli(args: readonly string[]): Promise<number> {
  try {
    const options = parseZeroBuildArgs(args);
    if (options.help) { console.log('Usage: zero build [--config ./zero.config.ts] [--entry ./app/server.ts] [--outdir ./dist] [--compile --outfile server]'); return 0; }
    const result = await buildZeroApp(options);
    console.log(`Zero build ready: ${result.serverPath}`);
    console.log(`Declared plugins: ${result.pluginCount}; public assets: ${result.publicAssetCount}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Zero build failed.');
    return 1;
  }
}
