/** Contracts for the normal app build; application runtime/listener ownership stays in its entry. */
export interface ZeroBuildOptions {
  readonly configPath: string;
  readonly entryPath?: string;
  readonly outDir?: string;
  readonly compile?: boolean;
  readonly outfile?: string;
}
export interface ZeroBuildResult {
  readonly serverPath: string;
  readonly privateManifestPath: string;
  readonly publicAssetCount: number;
  readonly pluginCount: number;
}
