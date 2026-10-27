/** Qualifies the pre-split public re-export/type contract without importing application or browser runtime modules. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import ts from 'typescript';

const ROOT = resolve(import.meta.dir, '../..');
const ENTRY = resolve(import.meta.dir, 'index.ts');
const MAINTENANCE = resolve(import.meta.dir, 'exports');
const BASELINE = resolve(import.meta.dir, '.frontend-exports-baseline.ts');
// Recorded before this maintenance split, including all current dirty additions.
// The digest includes ordered declarations, original targets, aliases and type-only markers.
const CONTRACT_SHA256 = '52c175d1689f4e16dfc61ebd779709a0e8d7768f4e6ee167313a19ab845d56a5';

interface ExportRecord {
  target: string;
  type: boolean;
  clause: { name: string; local: string; type: boolean }[] | { namespace: string } | null;
}
interface MaintenanceSnapshot {
  records: ExportRecord[];
  files: string[];
  baselineSource: string;
}

function snapshot(): MaintenanceSnapshot {
  const records: ExportRecord[] = [], files: string[] = [], originalDeclarations: string[] = [];
  const printer = ts.createPrinter();
  const entry = parse(ENTRY);
  for (const forward of entry.statements) {
    if (!ts.isExportDeclaration(forward) || forward.exportClause || forward.isTypeOnly
      || !forward.moduleSpecifier || !ts.isStringLiteral(forward.moduleSpecifier)) throw new Error('The public facade must contain only curated local forwarding exports.');
    const target = forward.moduleSpecifier.text;
    if (!target.startsWith('./exports/')) throw new Error('A forwarding export bypasses curated maintenance ownership.');
    const path = resolve(dirname(ENTRY), `${target}.ts`);
    if (!path.startsWith(`${MAINTENANCE}/`) || files.includes(path)) throw new Error('Curated export paths must be distinct admitted maintenance modules.');
    files.push(path);
    const source = parse(path);
    if (source.text.trimEnd().split('\n').length > 400) throw new Error('A curated responsibility exceeds the source-size target.');
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) throw new Error('Maintenance modules may not introduce imports, runtime declarations or side effects.');
      const specifier = statement.moduleSpecifier.text;
      const canonical = specifier.startsWith('.') ? relative(ROOT, resolve(dirname(path), specifier)).replaceAll('\\', '/') : specifier;
      const clause = statement.exportClause;
      records.push({ target: canonical, type: statement.isTypeOnly,
        clause: clause ? ts.isNamedExports(clause) ? clause.elements.map(element => ({ name: element.name.text,
          local: element.propertyName?.text ?? element.name.text, type: element.isTypeOnly })) : { namespace: clause.name.text } : null });
      let baselineSpecifier = specifier.startsWith('.') ? relative(dirname(BASELINE), resolve(ROOT, canonical)).replaceAll('\\', '/') : specifier;
      if (specifier.startsWith('.') && !baselineSpecifier.startsWith('.')) baselineSpecifier = `./${baselineSpecifier}`;
      const declaration = ts.factory.updateExportDeclaration(statement, statement.modifiers, statement.isTypeOnly,
        statement.exportClause, ts.factory.createStringLiteral(baselineSpecifier), statement.attributes);
      originalDeclarations.push(printer.printNode(ts.EmitHint.Unspecified, declaration, source));
    }
  }
  return { records, files, baselineSource: originalDeclarations.join('\n') };
}

function parse(path: string): ts.SourceFile {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new Error(`Curated facade syntax is invalid: ${relative(ROOT, path)}`);
  return source;
}

test('curated facades preserve every original ordered named/type/star source contract', () => {
  const result = snapshot();
  // Approved additive parts; remove only their exact declarations before
  // comparing the frozen pre-organization contract, never rebaseline old owners.
  const additiveTarget = 'src/components/controls/floating-button-group';
  const additive = result.records.filter(record => record.target === additiveTarget);
  const menuPart = (record: ExportRecord) => record.target === 'src/components/context-menu' && Array.isArray(record.clause)
    && (record.type && record.clause.map(item => item.name).join(',') === 'ContextMenuViewportProps,ContextMenuScrollOptions'
      || !record.type && record.clause.map(item => item.name).join(',') === 'ContextMenuViewport');
  const menuAdditive = result.records.filter(menuPart);
  const documentPart = (record: ExportRecord) => record.target === 'src/components/json-editor' && Array.isArray(record.clause)
    && record.clause.every(item => item.name.startsWith('JsonDocument') || ['parseJsonDocument', 'diffJsonDocument', 'DocumentEditor', 'parseDocumentSource',
      'DocumentEditorProps', 'DocumentEditorHandle', 'DocumentFormat', 'DocumentSourceChange', 'DocumentParseResult'].includes(item.name));
  const documentAdditive = result.records.filter(documentPart);
  const loggingTargets = new Set(['src/logging/logging-api-contracts', 'src/logging/logging-contracts', 'src/logging/logging-evidence-contracts', 'src/logging/logging-export-contracts', 'src/logging/logging-admission-contracts',
    'src/frontend/client/logging-collector', 'src/frontend/client/logging-hooks', 'src/components/logging']);
  const loggingAdditive = result.records.filter(record => loggingTargets.has(record.target));
  const domainPart = (record: ExportRecord) => !record.type && record.clause === null && ['src/components/email-inbox', 'src/components/messaging'].includes(record.target);
  expect(result.records.filter(domainPart)).toHaveLength(2);
  const drawerPart = (record: ExportRecord) => record.target === 'src/drawers';
  expect(result.records.filter(drawerPart)).toHaveLength(2);
  expect(result.records.filter(drawerPart).flatMap(record => Array.isArray(record.clause) ? record.clause.map(item => item.name) : []).sort()).toEqual([
    'ControlledDrawer', 'ControlledDrawerProps', 'DrawerDescriptor', 'DrawerHandle', 'DrawerManager', 'DrawerOptions', 'DrawerResult', 'DrawerSide', 'DrawerWorkspace', 'drawers', 'useDrawers',
  ].sort());
  const blogPart = (record: ExportRecord) => record.target === 'src/components/blog';
  const palettePart = (record: ExportRecord) => record.target === 'src/components/command-palette';
  const blogAdditive = result.records.filter(blogPart), paletteAdditive = result.records.filter(palettePart);
  expect(blogAdditive).toHaveLength(2);
  expect(blogAdditive.flatMap(record => Array.isArray(record.clause) ? record.clause.map(item => item.name) : []).sort()).toEqual([
    'BlogAuthor', 'BlogCard', 'BlogCardGrid', 'BlogCardProps', 'BlogCategory', 'BlogContentBlock', 'BlogHero', 'BlogHeroCompact', 'BlogHeroContained',
    'BlogImageLightbox', 'BlogListPage', 'BlogListPageList', 'BlogListPageMinimal', 'BlogListPageProps', 'BlogListPageSidebar', 'BlogPagination', 'BlogPost',
    'BlogPostPage', 'BlogPostPageProps', 'BlogPostPageSplit', 'BlogPostPageWide', 'BlogPostPageWithSidebar', 'BlogProvider', 'BlogSearchPalette',
    'BlogSearchPaletteProps', 'BlogTag', 'BlogTocItem', 'RecentPostsHero', 'RelatedPosts',
  ].sort());
  expect(paletteAdditive).toHaveLength(3);
  expect(paletteAdditive.flatMap(record => Array.isArray(record.clause) ? record.clause.map(item => item.name) : []).sort()).toEqual([
    'CommandPalette', 'CommandPaletteController', 'CommandPaletteGroup', 'CommandPaletteItem', 'CommandPaletteProps', 'CommandPaletteProvider',
    'CommandPaletteProviderProps', 'CommandPaletteTrigger', 'filterCommandPaletteItems', 'useCommandPalette',
  ].sort());
  // The anchored palette adds these two names inside existing declarations.
  // Remove only those exact symbols, retaining the frozen popover contract.
  const anchorNames = new Set(['PopoverAnchor', 'PopoverAnchorProps']);
  const popoverTarget = 'src/components/popover';
  const appShellTarget = 'src/components/app-shell';
  expect(result.records.filter(record => record.target === appShellTarget && record.type).flatMap(record => Array.isArray(record.clause)
    ? record.clause.filter(item => item.name === 'AppShellLinkProps') : [])).toEqual([{ name: 'AppShellLinkProps', local: 'AppShellLinkProps', type: false }]);
  expect(result.records.filter(record => record.target === popoverTarget).flatMap(record => Array.isArray(record.clause)
    ? record.clause.filter(item => anchorNames.has(item.name)).map(item => ({ ...item, declarationType: record.type })) : [])).toEqual([
    { name: 'PopoverAnchor', local: 'PopoverAnchor', type: false, declarationType: false },
    { name: 'PopoverAnchorProps', local: 'PopoverAnchorProps', type: false, declarationType: true },
  ]);
  const preserved = result.records.filter(record => record.target !== additiveTarget && !menuPart(record) && !documentPart(record)
    && !loggingTargets.has(record.target) && !domainPart(record) && !drawerPart(record) && !blogPart(record) && !palettePart(record))
    .map(record => Array.isArray(record.clause) && (record.target === popoverTarget || record.target === appShellTarget)
      ? { ...record, clause: record.clause.filter(item => record.target === popoverTarget ? !anchorNames.has(item.name) : item.name !== 'AppShellLinkProps') } : record);
  expect(loggingAdditive).toHaveLength(9);
  expect(loggingAdditive.flatMap(record => Array.isArray(record.clause) ? record.clause.map(item => item.name) : []).sort()).toEqual([
    'LoggingActivityProvider', 'LoggingAdmissionReceipt', 'LoggingCheckpoint', 'LoggingClient', 'LoggingCollectionPolicy', 'LoggingCollector', 'LoggingEvent', 'LoggingEventDetail', 'LoggingEvidence', 'LoggingEvidenceCursor', 'LoggingEvidencePage', 'LoggingExport', 'LoggingExportJob', 'LoggingExportRequest', 'LoggingFamily', 'LoggingFilters', 'LoggingHealth', 'LoggingHold', 'LoggingObservation', 'LoggingOutcome', 'LoggingPage', 'LoggingQuery', 'LoggingReceipt', 'LoggingReview', 'LoggingStream', 'LoggingTableRow', 'LoggingVerification', 'LoggingWorkspace', 'LoggingWorkspaceProps', 'StoredLoggingEvent', 'createLoggingCollector', 'createLoggingTableSource', 'useLoggingActivity', 'useLoggingEvents', 'useLoggingView',
  ].sort());
  expect(additive).toHaveLength(2);
  expect(additive.flatMap(record => Array.isArray(record.clause) ? record.clause.map(item => item.name) : []).sort()).toEqual([
    'FloatingButtonGroup', 'FloatingButtonGroupAction', 'FloatingButtonGroupItem', 'FloatingButtonGroupOrientation',
    'FloatingButtonGroupProps', 'FloatingButtonGroupSeparator', 'FloatingButtonGroupSize', 'FloatingButtonGroupVariant',
  ]);
  expect(menuAdditive).toHaveLength(2);
  expect(menuAdditive.flatMap(record => Array.isArray(record.clause) ? record.clause.map(item => item.name) : []).sort()).toEqual([
    'ContextMenuScrollOptions', 'ContextMenuViewport', 'ContextMenuViewportProps',
  ]);
  expect(documentAdditive).toHaveLength(4);
  expect(documentAdditive.flatMap(record => Array.isArray(record.clause) ? record.clause.map(item => item.name) : []).sort()).toEqual([
    'DocumentEditor', 'DocumentEditorHandle', 'DocumentEditorProps', 'DocumentFormat', 'DocumentParseResult', 'DocumentSourceChange',
    'JsonDocumentEdit', 'JsonDocumentEditor', 'JsonDocumentEditorHandle', 'JsonDocumentEditorProps', 'JsonDocumentMode',
    'JsonDocumentParseResult', 'JsonDocumentPatch', 'JsonDocumentPath', 'JsonDocumentSaveContext', 'JsonDocumentValue', 'diffJsonDocument', 'parseDocumentSource', 'parseJsonDocument',
  ]);
  expect(result.files).toHaveLength(41);
  expect(preserved).toHaveLength(296);
  expect(preserved.reduce((count, record) => count + (Array.isArray(record.clause) ? record.clause.length : 0), 0)).toBe(1455);
  expect(preserved.filter(record => record.clause === null)).toHaveLength(14);
  expect(createHash('sha256').update(JSON.stringify(preserved)).digest('hex')).toBe(CONTRACT_SHA256);
  expect([...new Bun.Glob('**/*.ts').scanSync({ cwd: MAINTENANCE, onlyFiles: true })]
    .map(path => resolve(MAINTENANCE, path)).sort()).toEqual([...result.files].sort());
});

test('the forwarding facade keeps the original public type and implementation symbol identities', () => {
  const result = snapshot();
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, esModuleInterop: true, noEmit: true, types: ['bun'] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host), readFile = host.readFile.bind(host), fileExists = host.fileExists.bind(host);
  host.fileExists = path => resolve(path) === BASELINE || fileExists(path);
  host.readFile = path => resolve(path) === BASELINE ? result.baselineSource : readFile(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => resolve(path) === BASELINE
    ? ts.createSourceFile(BASELINE, result.baselineSource, languageVersion, true)
    : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([ENTRY, BASELINE], options, host);
  const checker = program.getTypeChecker();
  const exportsOf = (path: string) => checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(path)!)!);
  const current = exportsOf(ENTRY), baseline = exportsOf(BASELINE);
  expect(current.map(symbol => symbol.name).sort()).toEqual(baseline.map(symbol => symbol.name).sort());
  const baselineByName = new Map(baseline.map(symbol => [symbol.name, symbol]));
  const canonical = (symbol: ts.Symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const changed = current.filter(symbol => canonical(symbol) !== canonical(baselineByName.get(symbol.name)!)).map(symbol => symbol.name);
  expect(changed).toEqual([]);
  const facadeDiagnostics = program.getSemanticDiagnostics().filter(diagnostic => diagnostic.file
    && (diagnostic.file.fileName === ENTRY || diagnostic.file.fileName === BASELINE || result.files.includes(diagnostic.file.fileName)));
  expect(facadeDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
}, 60_000);
