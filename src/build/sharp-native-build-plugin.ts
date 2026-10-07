/** Adapt only Sharp's native loader during normal server builds; retain its API and CPU checks without bundling node_modules sources. */
import { dirname } from 'node:path';
import { prepareSharpNativeBuildPayload, type SharpNativeBuildPayload } from './sharp-native-assets';

/** Preserve vendor binary names/rpaths in a private build payload and resolve them from the relocated server or executable. */
export function createSharpNativeBuildPlugin(outDir: string, compile: boolean): Bun.BunPlugin {
  const payloads = new Map<string, Promise<SharpNativeBuildPayload>>();
  return {
    name: 'zero-sharp-native-payload',
    setup(build) {
      build.onLoad({ filter: /(?:^|[/\\])sharp[/\\]dist[/\\]sharp\.[cm]js$/ }, async ({ path }) => {
        const key = dirname(path);
        let prepared = payloads.get(key);
        if (!prepared) { prepared = prepareSharpNativeBuildPayload(path, outDir); payloads.set(key, prepared); }
        const payload = await prepared;
        const source = await Bun.file(path).text();
        const call = `sharp = require(${JSON.stringify(payload.specifier)});`;
        if (source.split(call).length !== 2) throw new Error('The installed Sharp native loader does not match the supported build adapter.');
        return { contents: generatedSharpNativeLoader(payload, compile, path.endsWith('.cjs')) + '\n' + source.replace(call, 'sharp = zeroLoadNativeSharp();'), loader: 'js', resolveDir: dirname(path) };
      });
    },
  };
}

/** Generate a Bun N-API loader; no Node subprocess, binary rewriting, runtime extraction or credential state is introduced. */
export function generatedSharpNativeLoader(payload: SharpNativeBuildPayload, compile: boolean, commonJs: boolean): string {
  const imports = commonJs
    ? 'const zeroNativePath = require("node:path");'
    : 'import * as zeroNativePath from "node:path";';
  return `${imports}
function zeroLoadNativeSharp() {
  const root = zeroNativePath.dirname(${compile ? 'process.execPath' : 'Bun.fileURLToPath(import.meta.url)'});
  const binding = { exports: {} };
  process.dlopen(binding, zeroNativePath.join(root, ${JSON.stringify(payload.addonRelativePath)}));
  return binding.exports;
}`;
}
