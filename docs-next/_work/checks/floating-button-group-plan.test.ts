/** Reference and working-source contracts only; pure theme data/read-only files, no TS program, upstream component or application. */
import { expect, test } from 'bun:test';
import { parseDocumentationPage } from './markdown';
import { getThemeTokenCatalog } from '../../../src/design-system/theme-tokens';

const docs = new URL('../../', import.meta.url);
const project = new URL('../../../', import.meta.url);
const read = (path: string) => Bun.file(new URL(path, docs)).text();
const readSource = (path: string) => Bun.file(new URL(path, project)).text();
const planPath = '_work/floating-button-group-plan.md';
const supplementPath = '_work/floating-button-group-token-inventory.json';
const manualPath = 'frontend/components/controls/floating-button-group.md';
const hasRoute = (links: readonly string[], from: string, to: string) =>
  links.some(link => new URL(link, new URL(from, docs)).pathname === new URL(to, docs).pathname);

test('floating tray preserves pinned evidence and covers every token and motion reference', async () => {
  const broad = await Bun.file(new URL('_work/arc-design-token-inventory.json', docs)).json();
  const supplement = await Bun.file(new URL(supplementPath, docs)).json();
  const entry = broad.components.find((component: { id: string }) => component.id === supplement.component);
  expect(entry).toBeDefined();
  expect(supplement.source.repositoryRevision).toBe(broad.source.revision);
  expect(broad.counts.components).toBe(109);
  expect(supplement.observedAt).toBe('2026-10-11');
  const css = entry.files.find((file: { path: string }) => file.path.endsWith('.css'));
  const tsx = entry.files.find((file: { path: string }) => file.path.endsWith('.tsx'));
  expect(Object.keys(supplement.tokenDispositions).sort()).toEqual([...css.tokens].sort());
  expect(Object.keys(supplement.motionDispositions).sort()).toEqual([...tsx.motion].sort());
  expect(supplement.counts).toEqual({ cssReferences: css.tokens.length, cssDeclarations: css.declarations.length, motionReferences: tsx.motion.length });
  expect(supplement.counts).toEqual({ cssReferences: 35, cssDeclarations: 26, motionReferences: 8 });
  for (const declaration of css.declarations) {
    expect(supplement.tokenDispositions[declaration[2]] ?? supplement.declarationOnlyDispositions[declaration[2]], declaration[2]).toBeDefined();
  }
  const declarationOnly = [...new Set<string>(css.declarations.map((row: string[]) => row[2]!))].filter(token => !css.tokens.includes(token));
  expect(Object.keys(supplement.declarationOnlyDispositions).sort()).toEqual(declarationOnly.sort());
  for (const file of supplement.source.files) {
    const recorded = entry.files.find((item: { path: string }) => item.path === file.path);
    expect(file.repositorySha256).toBe(recorded.sha256);
    expect(file.registrySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(file.lines).toBe(recorded.lines);
  }
  expect(supplement.source.files[1].registrySha256).toBe(css.sha256);
  expect(supplement.source.files[0].registrySha256).not.toBe(tsx.sha256);
  expect(supplement.source.motionSha256).toBe(broad.motion.sha256);
  for (const item of Object.values(supplement.tokenDispositions) as { kind: string }[]) {
    expect(['existing-role', 'existing-recipe', 'candidate-local-role', 'owned-by-existing-tooltip', 'not-promoted']).toContain(item.kind);
  }
  expect(supplement.referenceCalibration.motion.highlightMove).toEqual({ visualDurationMs: broad.motion.springs.morph.visualDuration * 1000, bounce: broad.motion.springs.morph.bounce });
  expect(supplement.referenceCalibration.motion.firstEntryAndPress).toEqual({ visualDurationMs: broad.motion.springs.snappy.visualDuration * 1000, bounce: broad.motion.springs.snappy.bounce });
});

test('floating tray documents every reference option in the implemented additive working-source facade', async () => {
  const text = await read(planPath), page = parseDocumentationPage(text);
  const supplement = await Bun.file(new URL(supplementPath, docs)).json();
  expect(page.metadata.id).toBe('zero.floating-button-group-plan');
  expect(page.metadata.type).toBe('roadmap');
  expect(page.metadata.maturity).toBe('supported');
  expect(page.metadata.reviewed_against).toMatchObject({ version: '2.6.0', snapshot: 'dirty', date: '2026-10-11' });
  for (const name of [...supplement.referenceContract.groupProps, ...supplement.referenceContract.actionProps, ...supplement.referenceContract.separatorProps]) {
    expect(text).toContain(`\`${name}\``);
  }
  expect(supplement.referenceContract.tooltipSides).toEqual(['top', 'bottom', 'left', 'right']);
  expect(supplement.referenceContract.defaults).toEqual({ variant: 'muted', size: 'md', orientation: 'horizontal', iconOnly: false, rowTooltipSide: 'top', columnTooltipSide: 'right' });
  expect(supplement.referenceContract.shortcutBindsKeys).toBe(false);
  expect(supplement.referenceContract.positionsOrPortalsTray).toBe(false);
  expect(supplement.referenceContract.callbacksAwaitAcceptedWrites).toBe(false);
  expect(text).toContain('implemented as an additive');
  expect(text).toContain('not a published package upgrade');
  expect(text).not.toContain('not available imports');
  expect(text).toContain('Grow/400ms');
  expect(text).toContain('forced colors');
  expect(text).toContain('ownerDocument/defaultView');
  expect(text).toContain('negative inner radius');
  expect(text).toContain('touch/coarse-pointer 44px');
  expect(text).toContain('current `src/components/button-group/` exports untouched');
  expect(text).toContain('icons stay mounted outside departing label phases');
  expect(text).toContain('Target and composed ancestors are guarded');
  expect(hasRoute(page.links, planPath, manualPath)).toBe(true);
});

test('floating tray evidence and canonical manual remain discoverable through the documentation hierarchy', async () => {
  for (const path of ['_work/index.md', '_work/arc-interaction-follow-up-plan.md', '_work/arc-design-language-audit.md',
    '_work/design-token-theme-evolution-plan.md', '_work/frontend-component-organization-plan.md',
    'frontend/components/roadmap.md']) {
    const page = parseDocumentationPage(await read(path));
    expect(hasRoute(page.links, path, planPath), path).toBe(true);
  }
  for (const path of ['frontend/ui-reference.md', 'frontend/components/index.md', 'frontend/components/controls/index.md',
    'frontend/components/primitives/button-group.md', 'frontend/components/roadmap.md']) {
    expect(hasRoute(parseDocumentationPage(await read(path)).links, path, manualPath), path).toBe(true);
  }
  const page = parseDocumentationPage(await read(planPath));
  expect(hasRoute(page.links, planPath, '_work/index.md')).toBe(true);
  expect(hasRoute(page.links, planPath, supplementPath)).toBe(true);
  const checksPath = '_work/checks/index.md';
  expect(hasRoute(parseDocumentationPage(await read(checksPath)).links, checksPath, '_work/checks/floating-button-group-plan.test.ts')).toBe(true);
});

test('working implementation records the complete public facade and promoted role graph separately from reference history', async () => {
  const supplement = await Bun.file(new URL(supplementPath, docs)).json();
  const implementation = supplement.implementation;
  expect(implementation.status).toBe('implemented-working-source-unreleased');
  expect(implementation).toMatchObject({ package: '@zero/framework', version: '2.6.0', snapshot: 'dirty',
    canonicalOwner: 'src/components/controls/floating-button-group', manual: manualPath,
    focusedEntry: 'src/components/controls/floating-button-group/index.ts', sourceCopyTarget: 'components/floating-button-group' });
  expect(implementation.routes).toEqual(['@zero/framework', '@zero/framework/react', '@zero/framework/components/floating-button-group']);
  expect(implementation.publicValues).toEqual(['FloatingButtonGroup']);
  expect(implementation.publicTypes).toEqual(['FloatingButtonGroupProps', 'FloatingButtonGroupAction', 'FloatingButtonGroupSeparator',
    'FloatingButtonGroupItem', 'FloatingButtonGroupVariant', 'FloatingButtonGroupSize', 'FloatingButtonGroupOrientation']);
  const barrel = await readSource(implementation.focusedEntry);
  const declarations = await readSource(`${implementation.canonicalOwner}/floating-button-group.types.ts`);
  const facade = await readSource(`${implementation.canonicalOwner}/floating-button-group.tsx`);
  const labels = await readSource(`${implementation.canonicalOwner}/floating-button-group-label.tsx`);
  const highlight = await readSource(`${implementation.canonicalOwner}/use-floating-button-group-highlight.ts`);
  const exports = await readSource('src/frontend/exports/controls/primitives.ts');
  const pkg = await Bun.file(new URL('package.json', project)).json();
  expect(pkg.exports['./components/floating-button-group']).toEqual({
    types: './src/components/controls/floating-button-group/index.ts', import: './src/components/controls/floating-button-group/index.ts',
  });
  for (const name of [...implementation.publicValues, ...implementation.publicTypes]) {
    expect(barrel).toContain(name); expect(exports).toContain(name);
  }
  for (const name of implementation.publicTypes) expect(declarations).toContain(`export ${name.endsWith('Variant') || name.endsWith('Size') || name.endsWith('Orientation') || name.endsWith('Item') ? 'type' : 'interface'} ${name}`);
  expect(declarations).toContain("React.Ref<HTMLButtonElement>");
  expect(declarations).toContain("readonly dir?: 'ltr' | 'rtl'");
  expect(facade).toContain('useOverlayScope'); expect(facade).toContain('aria-disabled={disabled || undefined}');
  expect(facade).toContain('item.onSelect?.(); state.onAction?.(item.id)');
  expect(facade).toContain('<TooltipGroup>'); expect(facade).toContain('type="button"');
  expect(labels.indexOf('zero-floating-button-group-icon')).toBeLessThan(labels.indexOf('<AnimatePresence'));
  expect(labels).toContain('>{label}</motion.span>');
  for (const guard of ['target ?? root', 'inspectTransform(ancestor)', 'ancestor.assignedSlot', "'host' in scope", 'computed.rotate', 'computed.scale', 'computed.perspective']) expect(highlight).toContain(guard);
  expect(implementation.tooltipPolicy).toMatchObject({ motion: 'grow', enterMs: 400, arrow: true, allFourSides: true, newPrivateProvider: false });
  expect(implementation.density.minimumTargetPx).toEqual({ compact: 32, comfortable: 36, touch: 44, coarsePointer: 44 });
  const tokens = implementation.tokens, catalog = getThemeTokenCatalog();
  expect(tokens.roleCount).toBe(57); expect(tokens.completeCatalogRoleCount).toBe(462);
  expect(tokens.suffixes).toHaveLength(57); expect(new Set(tokens.suffixes).size).toBe(57);
  expect(catalog).toHaveLength(462);
  expect(catalog.filter(role => role.name.startsWith(tokens.canonicalPrefix)).map(role => role.name).sort())
    .toEqual(tokens.suffixes.map((suffix: string) => `${tokens.canonicalPrefix}${suffix}`).sort());
  const css = await readSource('src/frontend/styles/theme-next.css');
  for (const suffix of tokens.suffixes) expect(css).toContain(`${tokens.consumerPrefix}${suffix}: var(${tokens.canonicalPrefix}${suffix});`);
  const manual = parseDocumentationPage(await read(manualPath));
  expect(manual.metadata.maturity).toBe('supported'); expect(manual.metadata.reviewed_against).toMatchObject({ version: '2.6.0', snapshot: 'dirty' });
  for (const name of [...implementation.publicValues, ...implementation.publicTypes]) expect(manual.body).toContain(name);
  expect(manual.body.match(/^```tsx$/gmu)).toHaveLength(3);
  for (const requirement of ['aria-disabled', 'not awaited', '44px minimum', 'icon stays mounted', 'composed ancestors', 'onSelect', 'onAction']) expect(manual.body).toContain(requirement);
  expect(manual.body).toContain('not a published 2.6.0 upgrade');
  for (const path of Object.values(implementation.checks) as string[]) expect(await Bun.file(new URL(path, project)).exists(), path).toBe(true);
  expect(implementation.qualification.finalBrowserSsr).toBe('qualified-isolated-family');
  expect(implementation.qualification.familyRun).toMatchObject({ failures: 0, skips: 0, screenshotsInspected: true });
  expect(implementation.qualification.installedArchive).toBe('qualified-bounded-dirty-archive');
  expect(implementation.qualification.archiveRun).toMatchObject({ failures: 0, snapshot: 'dirty', published: false,
    publicValueAndSevenTypeIdentity: true, strictConsumerTypes: true, environmentNotLoaded: true, databaseFiles: 0 });
  expect(implementation.qualification.archiveRun.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(implementation.qualification.documentationExamples).toBe('qualified-actual-manual-fences');
  expect(implementation.qualification.documentationExampleRun).toMatchObject({ newManualFences: 3, failures: 0 });
  expect(implementation.qualification.distributionManualRun).toMatchObject({ failures: 0, oldPublicDigestPreserved: true, additivePublicSymbols: 8 });
  expect(implementation.qualification.originalTheme).toBe('retained');
});
