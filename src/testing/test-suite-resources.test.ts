/** Qualifies the narrow installed-consumer catalog without executing package installs or changing test inventory. */
import { expect, test } from 'bun:test';
import { FRAMEWORK_INSTALLED_CONSUMER_FILES, isFrameworkInstalledConsumer } from './test-suite-resources';

test('the resource catalog contains only reviewed existing full-framework pack/install consumers', async () => {
  expect(FRAMEWORK_INSTALLED_CONSUMER_FILES).toHaveLength(10);
  expect(new Set(FRAMEWORK_INSTALLED_CONSUMER_FILES).size).toBe(10);
  for (const file of FRAMEWORK_INSTALLED_CONSUMER_FILES) {
    const source = await Bun.file(new URL(`../../${file}`, import.meta.url)).text();
    expect(source).toMatch(/['"]pm['"],\s*['"]pack['"]/);
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
