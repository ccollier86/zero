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
  'src/components/controls/floating-button-group/floating-button-group.package.test.ts',
  'src/modals/modal-scroll.package.test.ts',
  'src/components/_internal/scroll-viewport/ordinary-scroll.package.test.ts',
  'src/modals/modal-system.package.test.ts',
  'src/components/tooltip/tooltip-system.package.test.ts',
  'src/frontend/server/style-foundation.package.test.ts',
  'src/migrations/legacy-state/legacy-state.package.test.ts',
  'src/blog/blog.package.test.ts',
  'src/blog/blog-publishing.package.test.ts',
  'src/components/blog/blog.package.test.ts',
  'packages/payments/src/package.test.ts',
  'src/components/data-table/data-table-refresh.package.test.ts',
  'src/components/json-editor/document-editor.package.test.ts',
  'src/components/messaging/messaging.package.test.ts',
  'src/email/mail.package.test.ts',
  'src/frontend/server/application-data.package.test.ts',
  'src/workflows/workflow-contracts.package.test.ts',
  'src/package-distribution.test.ts',
] as const;

/** Match only the reviewed full-framework installed consumers, not arbitrary package tests. */
export function isFrameworkInstalledConsumer(file: string): boolean {
  return (FRAMEWORK_INSTALLED_CONSUMER_FILES as readonly string[]).includes(file);
}

/** Preserve exact performance/deadline assertions under their own synthetic load, without unrelated cold-install I/O. */
export const EXCLUSIVE_TEST_FILES = ['packages/payments/src/package.test.ts', 'src/frontend/server/auth-hot-admission.integration.test.ts', 'src/frontend/server/auth-hot-mutations.integration.test.ts',
  'src/frontend/server/vector-visualization-app.integration.test.ts', 'src/vector/zvec-adapter-lexical-native.test.ts'] as const;
export function isExclusiveTestFile(file: string): boolean { return (EXCLUSIVE_TEST_FILES as readonly string[]).includes(file); }
