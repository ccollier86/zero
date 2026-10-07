/** The generated runtime resolves only managed host-native payloads and uses Bun's N-API entry point. */
import { expect, test } from 'bun:test';
import { generatedSharpNativeLoader } from './sharp-native-build-plugin';

const payload = { platform: 'darwin-arm64', specifier: '@img/sharp-darwin-arm64/sharp.node', addonRelativePath: 'zero-native/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node' };

test('normal native payload resolution follows the relocated bundle, not cwd or source paths', () => {
  const source = generatedSharpNativeLoader(payload, false, false);
  expect(source).toContain('Bun.fileURLToPath(import.meta.url)');
  expect(source).toContain('process.dlopen(binding');
  expect(source).toContain(payload.addonRelativePath);
  expect(source).not.toContain('process.cwd');
  expect(source).not.toContain('node_modules');
  expect(source).not.toContain('Bun.dlopen');
});

test('compiled native payload resolution follows the executable and remains N-API, not an FFI or Node fallback', () => {
  const source = generatedSharpNativeLoader(payload, true, false);
  expect(source).toContain('zeroNativePath.dirname(process.execPath)');
  expect(source).toContain('process.dlopen(binding');
  expect(source).not.toContain('fileURLToPath(import.meta.url)');
  expect(source).not.toContain('spawn');
  expect(source).not.toContain('Bun.write');
});

test('CommonJS loader composition keeps bundled builtin imports without shadowing vendor require', () => {
  const source = generatedSharpNativeLoader(payload, false, true);
  expect(source).toContain('require("node:path")');
  expect(source).not.toContain('node:url');
  expect(source).not.toContain('const require');
  expect(source).toContain('function zeroLoadNativeSharp()');
});
