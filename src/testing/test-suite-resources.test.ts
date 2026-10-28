/** Qualifies the narrow installed-consumer catalog without executing package installs or changing test inventory. */
import { expect, test } from 'bun:test';
import { FRAMEWORK_INSTALLED_CONSUMER_FILES, EXCLUSIVE_TEST_FILES, isFrameworkInstalledConsumer, isExclusiveTestFile } from './test-suite-resources';

test('only the reviewed cold-I/O and explicit hot-auth performance gates reserve an exclusive execution window', () => {
  expect(EXCLUSIVE_TEST_FILES).toEqual(['packages/payments/src/package.test.ts', 'src/frontend/server/auth-hot-admission.integration.test.ts', 'src/frontend/server/auth-hot-mutations.integration.test.ts',
    'src/frontend/server/vector-visualization-app.integration.test.ts', 'src/vector/zvec-adapter-lexical-native.test.ts', 'src/build/build-app.test.ts',
    'src/frontend/client/session-audit-recovery.browser.test.ts', 'packages/docs/package-installed.integration.test.ts',
    'src/components/json-editor/document-editor.package.test.ts', 'src/presence/presence-fabric.integration.test.ts',
    'src/resources/resource-array-overlap-fabric.integration.test.ts']);
  expect(isExclusiveTestFile('packages/payments/src/package.test.ts')).toBe(true);
  expect(isExclusiveTestFile('src/blog/blog-publishing.package.test.ts')).toBe(false);
});

test('the resource catalog contains only reviewed existing full-framework pack/install consumers', async () => {
  expect(FRAMEWORK_INSTALLED_CONSUMER_FILES).toHaveLength(28);
  expect(new Set(FRAMEWORK_INSTALLED_CONSUMER_FILES).size).toBe(28);
  // Keep the original admission list/order; qualify the reviewed additive consumers independently.
  expect(FRAMEWORK_INSTALLED_CONSUMER_FILES.slice(0, 10)).toEqual([
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
  ]);
  expect(FRAMEWORK_INSTALLED_CONSUMER_FILES.slice(10, 17)).toEqual([
    'src/components/controls/floating-button-group/floating-button-group.package.test.ts',
    'src/modals/modal-scroll.package.test.ts',
    'src/components/_internal/scroll-viewport/ordinary-scroll.package.test.ts',
    'src/modals/modal-system.package.test.ts',
    'src/components/tooltip/tooltip-system.package.test.ts',
    'src/frontend/server/style-foundation.package.test.ts',
    'src/migrations/legacy-state/legacy-state.package.test.ts',
  ]);
  expect(FRAMEWORK_INSTALLED_CONSUMER_FILES.slice(17, 21)).toEqual([
    'src/blog/blog.package.test.ts',
    'src/blog/blog-publishing.package.test.ts',
    'src/components/blog/blog.package.test.ts',
    'packages/payments/src/package.test.ts',
  ]);
  expect(FRAMEWORK_INSTALLED_CONSUMER_FILES.slice(21)).toEqual([
    'src/components/data-table/data-table-refresh.package.test.ts', 'src/components/json-editor/document-editor.package.test.ts',
    'src/components/messaging/messaging.package.test.ts', 'src/email/mail.package.test.ts',
    'src/frontend/server/application-data.package.test.ts', 'src/workflows/workflow-contracts.package.test.ts', 'src/package-distribution.test.ts',
  ]);
  for (const file of FRAMEWORK_INSTALLED_CONSUMER_FILES) {
    const source = await Bun.file(new URL(`../../${file}`, import.meta.url)).text();
    if (file === 'src/package-distribution.test.ts') { expect(source).toContain('runCreateZeroCli([localAppDir'); expect(source).toContain('LOCAL_FRAMEWORK_DEPENDENCY'); }
    else expect(source).toMatch(/['"]pm['"],\s*['"]pack['"]/);
    expect(source).toMatch(/['"]install['"]/);
    expect(source).toContain('@zero/framework');
    expect(isFrameworkInstalledConsumer(file)).toBe(true);
  }
});

test('tiny updater archives, source builds, metadata and browser qualifications remain ordinary', () => {
  for (const file of [
    'src/update/local-archive-workspace.integration.test.ts',
    'src/update/local-archive-resolution.integration.test.ts',
    'src/frontend/server/package-mode-fixture.test.ts',
    'src/package-exports.test.ts',
    'src/create-zero/scaffold.test.ts',
    'packages/docs/package-browser.integration.test.ts',
    'src/components/profile-settings-ui.browser.test.ts',
  ]) expect(isFrameworkInstalledConsumer(file)).toBe(false);
});
