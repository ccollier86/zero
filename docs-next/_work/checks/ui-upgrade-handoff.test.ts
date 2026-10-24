/** Checks the handoff's real entry points and navigation without loading app/service owners. */
import { expect, test } from 'bun:test';
import { parseDocumentationPage } from './markdown';

const documentation = new URL('../../', import.meta.url);
const repository = new URL('../../../', import.meta.url);
const handoffPath = 'guides/ui-upgrade.md';
const read = (path: string) => Bun.file(new URL(path, documentation)).text();
const routesTo = (links: readonly string[], from: string, target: string) => links.some(link =>
  new URL(link, new URL(from, documentation)).pathname === new URL(target, documentation).pathname);

test('UI upgrade handoff is reachable and routes the implemented system manuals', async () => {
  const handoff = parseDocumentationPage(await read(handoffPath));
  expect(handoff.metadata.id).toBe('zero.guides.ui-upgrade');
  expect(handoff.metadata.audience).toContain('agent');
  for (const parent of ['guides/index.md', 'frontend/ui-reference.md']) {
    const page = parseDocumentationPage(await read(parent));
    expect(routesTo(page.links, parent, handoffPath), parent).toBe(true);
  }
  for (const target of [
    'frontend/ui-reference.md', 'guides/application-ui-development.md', 'guides/public-ui-development.md',
    'frontend/design-system/foundation-next.md', 'frontend/design-system/typography.md',
    'frontend/modals/migration.md', 'frontend/modals/configuration.md',
    'frontend/components/overlays/tooltip.md', 'frontend/components/controls/select.md',
    'frontend/components/overlays/popover.md', 'frontend/components/surfaces/card.md',
    'frontend/components/primitives/scroll-area.md', 'frontend/components/controls/floating-button-group.md',
    'frontend/charts/index.md', 'frontend/charts/sankey.md', 'frontend/charts/race-bar.md',
    'frontend/charts/funnel.md', 'frontend/charts/arc.md', 'frontend/charts/native.md',
    'frontend/components/vector-visualization.md', 'backend/vector/visualizations.md',
    'frontend/components/json-editor.md', 'frontend/data-controls/data-table/controls.md',
    'frontend/email/index.md', 'frontend/messaging/index.md', 'backend/messaging/index.md',
    'cli/doctor/source-audit.md', 'cli/tooling/update.md', 'cli/tooling/source-copy.md',
  ]) expect(routesTo(handoff.links, handoffPath, target), target).toBe(true);
});

test('handoff import entries and source locations resolve in the current distribution', async () => {
  const text = await read(handoffPath);
  const handoff = parseDocumentationPage(text);
  const manifest = await Bun.file(new URL('package.json', repository)).json();
  for (const entry of [
    'design-system', 'components/typography', 'components/app-shell', 'modals', 'components/tooltip',
    'components/popover', 'components/dropdown-menu', 'components/context-menu',
    'components/floating-button-group', 'components/json-editor', 'components/charts',
    'components/charts/arc', 'components/charts/native', 'charts', 'charts/react',
    'components/vector-visualization', 'vector/visualization', 'components/data-table',
    'messaging', 'components/messaging', 'email-inbox',
  ]) {
    expect(text.includes(`@zero/framework/${entry}`), entry).toBe(true);
    expect(manifest.exports[`./${entry}`], entry).toBeDefined();
  }
  for (const link of handoff.links) {
    const resolved = new URL(link, new URL(handoffPath, documentation));
    if (resolved.protocol !== 'file:' || !resolved.pathname.startsWith(new URL('src/', repository).pathname)) continue;
    expect(await Bun.file(resolved).exists(), link).toBe(true);
  }
});

test('handoff retains planned-work boundaries, installation ownership and compiled examples', async () => {
  const text = await read(handoffPath);
  const handoff = parseDocumentationPage(text);
  for (const target of [
    '_work/drawer-bottom-sheet-system-plan.md', '_work/arc-input-modernization-plan.md',
    '_work/number-field-rolling-number-plan.md', '_work/frontend-component-organization-plan.md',
  ]) expect(routesTo(handoff.links, handoffPath, target), target).toBe(true);
  for (const anchor of [
    'obtain-and-pin-the-framework-branch', 'create-the-application-feature-branch-and-baseline',
    'run-doctor-before-and-after-installation', 'planned-work-is-not-an-upgrade-prerequisite',
    'application-acceptance-and-rollback', 'prompt-for-the-application-migration-window',
  ]) expect(handoff.anchors.has(anchor), anchor).toBe(true);
  expect(text).toContain('git fetch --no-tags origin main');
  expect(text).not.toContain('origin/feature/ui-next-upgrade');
  expect(text).toContain('feature/ui-next-adoption');
  expect(text).toContain('Do not merge the Zero framework branch into the Pantheon application repo.');
  expect(text).toContain('--source-only');
  expect(text).toContain('--upgrade-target-root');
  expect(text).toContain('--local');
  expect(text).toContain('--dry-run');
  const compiler = await read('_work/checks/frontend-ui-examples.test.ts');
  expect(compiler).toContain("'guides/ui-upgrade.md': [0, 1]");
});
