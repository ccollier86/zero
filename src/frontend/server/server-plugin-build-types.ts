/**
 * server-plugin-build-types.ts
 *
 * Defines optional declared frontend/content contributions for native plugins.
 * Build contexts have no live service access; setup consumes resolved artifacts.
 */
import type { MaybePromise } from 'elysia';
import type { emitPlatformCode } from '../../observability';
import type { AppIdentityConfig } from '../../email/types';

/** Serializable immutable plugin content; executable callbacks stay in code. */
export type ZeroPluginJsonValue = null | boolean | number | string |
  readonly ZeroPluginJsonValue[] | { readonly [key: string]: ZeroPluginJsonValue };

/** Named file source. Relative sources resolve against the captured project root. */
export interface ZeroPluginBuildFile {
  readonly name: string;
  readonly path: string | URL;
  readonly contentType?: string;
  /** Optional full SHA-256 checked against copied bytes to preserve a compiler snapshot. */
  readonly contentHash?: string;
  /** Optional admitted filesystem boundary, rechecked against final real paths before reading. */
  readonly sourceRoot?: string | URL;
}

/** Immutable paths and app-local diagnostics supplied before any runtime setup. */
export interface ZeroPluginBuildContext {
  readonly projectRoot: string;
  readonly appDir: string;
  /** Existing app name/public origin; no plugin-specific identity setting is required. */
  readonly appIdentity: Readonly<AppIdentityConfig>;
  readonly generatedDir: string;
  /** Isolated public asset directory; private compiled data belongs in generatedDir. */
  readonly assetOutDir: string;
  readonly publicBasePath: string;
  readonly mode: 'development' | 'production';
  readonly emitCode: typeof emitPlatformCode;
}

/** Contributions returned by trusted plugin compilation; data is not a public asset. */
export interface ZeroPluginBuildOutput {
  readonly browserEntries?: readonly ZeroPluginBuildFile[];
  /** Prebuilt, scoped CSS using Zero tokens; copied as standalone style assets. */
  readonly styles?: readonly ZeroPluginBuildFile[];
  /** Extra component source directories/files scanned by shared Tailwind compilation. */
  readonly styleSources?: readonly (string | URL)[];
  readonly assets?: readonly ZeroPluginBuildFile[];
  /** Content attachments served only by a plugin's live admission routes, never /_build. */
  readonly privateAssets?: readonly ZeroPluginBuildFile[];
  readonly data?: ZeroPluginJsonValue;
}

/** Declarative build phase. Required failures reject startup/build rather than rendering broken pages. */
export interface ZeroPluginBuildContribution {
  readonly required?: boolean;
  /** Optional stable configuration identity checked when loading a production artifact. */
  readonly identity?: string;
  /** Page/content prefix ownership validated against other plugins and app file routes. */
  readonly mountPaths?: readonly string[];
  readonly prepare: (context: ZeroPluginBuildContext) => MaybePromise<ZeroPluginBuildOutput>;
}

/** One content-addressed public asset in a plugin-owned namespace. */
export interface ResolvedZeroPluginFrontendAsset {
  readonly publicPath: string;
  readonly kind: 'script' | 'style' | 'asset';
  readonly contentType?: string;
}

/** Resolved plugin assets and private compiled data, read-only during runtime setup. */
export interface ResolvedZeroPluginFrontendAssets {
  readonly publicBasePath: string;
  readonly assets: Readonly<Record<string, ResolvedZeroPluginFrontendAsset>>;
  /** Portable private artifact paths, resolved to files only in trusted server setup. */
  readonly privateAssets?: Readonly<Record<string, { readonly artifactPath: string; readonly contentType?: string }>>;
  readonly data?: ZeroPluginJsonValue;
}

/** Actual shared/platform and plugin URLs; callers never guess build filenames. */
export interface ResolvedAppFrontendAssets {
  readonly clientEntry?: string;
  readonly cssPath?: string;
  /** Normal server builds bind bundled plugin components to their bundled React SSR identity. */
  readonly pluginSsrRuntime?: 'app' | 'bundled';
  readonly plugins: Readonly<Record<string, ResolvedZeroPluginFrontendAssets>>;
}

/** Portable private artifact embedded by a production build, never served through /_build. */
export interface AppFrontendBuildManifest {
  readonly version: 1;
  readonly frontend: ResolvedAppFrontendAssets;
  readonly pluginIdentities: Readonly<Record<string, string | null>>;
}
