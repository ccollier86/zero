/**
 * Explicit test-runner resource catalog for consumers which pack and install
 * this entire framework, then compile or run its installed graph. These share
 * the external package cache and cold-I/O budget; this is admission only, not
 * a test exclusion, timeout override, retry, or change to consumer cleanup.
 */
export const FRAMEWORK_INSTALLED_CONSUMER_FILES = [
  'packages/docs/package-installed.integration.test.ts',
  'src/components/button-group/button-group-context-menu.package.test.ts',
  'src/components/cascader/cascader.package.test.ts',
  'src/components/data-studio/data-studio-storage-editors.package.test.ts',
  'src/components/phone-input/phone-input.package.test.ts',
  'src/components/profile-settings-ui.package.test.ts',
  'src/components/signature-pad/signature-pad.package.test.ts',
  'src/frontend/server/database-automation-torrent.package.test.ts',
  'src/frontend/server/fabric-sync-metadata.package.test.ts',
  'src/frontend/server/resource-array-policy.package.test.ts',
] as const;

/** Match only the reviewed full-framework installed consumers, not arbitrary package tests. */
export function isFrameworkInstalledConsumer(file: string): boolean {
  return (FRAMEWORK_INSTALLED_CONSUMER_FILES as readonly string[]).includes(file);
}
