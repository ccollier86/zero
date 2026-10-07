/** Resolve and copy Sharp's host-native vendor payload while preserving its relative library layout. No app data or provider is opened. */
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

export interface SharpNativeBuildPayload {
  readonly platform: string;
  readonly specifier: string;
  readonly addonRelativePath: string;
}

/** Admit the installed host-native packages, then emit only native binaries and their vendor notices outside public assets. */
export async function prepareSharpNativeBuildPayload(loaderPath: string, outDir: string): Promise<SharpNativeBuildPayload> {
  const loaderDir = dirname(loaderPath);
  const libvips = (await import(Bun.pathToFileURL(join(loaderDir, 'libvips.mjs')).href)).default;
  const platform: unknown = libvips?.runtimePlatformArch?.();
  if (typeof platform !== 'string' || !/^(?:darwin|linux|linuxmusl|win32)-(?:arm|arm64|ia32|x64|ppc64|riscv64|s390x)$/.test(platform)) {
    throw new Error('Zero native avatar builds require a supported host-native Sharp package; cross-target and WebAssembly native payloads are not supported.');
  }
  const specifier = `@img/sharp-${platform}/sharp.node`;
  let entry: string;
  try { entry = Bun.resolveSync(specifier, loaderDir); }
  catch { throw new Error('The host-native Sharp addon is missing. Install Sharp optional dependencies before building the app.'); }
  const nativeRoot = extname(entry) === '.node' ? dirname(dirname(entry)) : dirname(entry);
  let addon = entry;
  if (extname(entry) !== '.node') {
    const source = await Bun.file(entry).text();
    const local = /module\.exports\s*=\s*require\(['"](\.\/lib\/[a-zA-Z0-9_.-]+\.node)['"]\)/.exec(source)?.[1];
    if (!local) throw new Error('The installed Sharp addon entry does not have the supported native package layout.');
    addon = resolve(nativeRoot, local);
  }
  const addonRelativePath = join('zero-native', `sharp-${platform}`, relative(nativeRoot, addon));
  const copied = await copyNativeLibraryDirectory(join(nativeRoot, 'lib'), join(outDir, 'zero-native', `sharp-${platform}`, 'lib'));
  if (!copied.includes(basename(addon))) throw new Error('The installed Sharp addon binary is missing from its vendor payload.');
  await copyNotice(nativeRoot, join(outDir, 'zero-native', `sharp-${platform}`), 'LICENSE');
  await copyNotice(nativeRoot, join(outDir, 'zero-native', `sharp-${platform}`), 'README.md');
  // Windows ships its dependent DLLs in the addon package. Other native packages
  // refer to a sibling sharp-libvips package through vendor-defined rpaths.
  if (!platform.startsWith('win32-')) {
    let binary: string;
    try { binary = Bun.resolveSync(`@img/sharp-libvips-${platform}/binary`, loaderDir); }
    catch { throw new Error('The host-native Sharp libvips payload is missing. Install Sharp optional dependencies before building the app.'); }
    const libraryRoot = dirname(dirname(binary));
    const libraries = await copyNativeLibraryDirectory(dirname(binary), join(outDir, 'zero-native', `sharp-libvips-${platform}`, 'lib'));
    if (!libraries.includes(basename(binary))) throw new Error('The installed Sharp libvips binary is missing from its vendor payload.');
    await copyNotice(libraryRoot, join(outDir, 'zero-native', `sharp-libvips-${platform}`), 'LICENSE');
    await copyNotice(libraryRoot, join(outDir, 'zero-native', `sharp-libvips-${platform}`), 'README.md');
  }
  await copyNotice(dirname(loaderDir), join(outDir, 'zero-native'), 'LICENSE', 'LICENSE-sharp');
  return Object.freeze({ platform, specifier, addonRelativePath });
}

async function copyNativeLibraryDirectory(source: string, target: string): Promise<readonly string[]> {
  const copied: string[] = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!/\.(?:node|dylib|dll|so(?:\.\d+)*)$/.test(entry.name)) continue;
    if (!entry.isFile() || !/^[a-zA-Z0-9_.+-]+$/.test(entry.name)) throw new Error('Sharp native payload must contain ordinary vendor binary files, not links or source directories.');
    const file = Bun.file(join(source, entry.name));
    if (!await file.exists() || file.size < 1 || file.size > 128 * 1024 * 1024) throw new Error('Sharp native payload contains an invalid binary file.');
    await Bun.write(join(target, entry.name), file);
    copied.push(entry.name);
    if (copied.length > 64) throw new Error('Sharp native payload exceeds the supported vendor binary budget.');
  }
  return Object.freeze(copied);
}

async function copyNotice(source: string, target: string, name: string, outputName = name): Promise<void> {
  const file = Bun.file(join(source, name));
  if (await file.exists()) await Bun.write(join(target, outputName), file);
}
