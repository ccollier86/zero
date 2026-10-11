/**
 * Source-only upgrade applicability: known target exports and concrete native
 * scroll-owner assumptions. Consumes admitted AST text and static target evidence;
 * never executes consumers, rewrites source or makes optional compositions mandatory.
 */
import ts from 'typescript';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import type { SourceOnlyFile } from './source-only-types';
import { getSourceOnlyUpgradeCatalog } from './source-only-upgrade-catalog';
import type { SourceOnlyUpgradeTargetInspection, UpgradeExportKind } from './source-only-upgrade-types';
import { createUpgradeBindingGraph, isUpgradeLocalSpecifier, unwrapUpgradeExpression, upgradeLocalIdentifierIdentity,
  type UpgradePublicBinding, type UpgradeSourceModule } from './source-only-upgrade-bindings';

/** Coverage counts distinguish inspected public imports from unresolved admitted local graphs. */
export interface SourceOnlyUpgradeUsageStats {
  readonly inspectedFiles: number;
  readonly publicBindings: number;
  readonly checkedNamedExports: number;
  readonly unresolvedLocalBindings: number;
  readonly behaviorReviews: number;
}
export interface SourceOnlyUpgradeUsageInspection { readonly findings: PlatformDoctorFinding[]; readonly stats: SourceOnlyUpgradeUsageStats }
const ownScrollers = new Set(['PopoverViewport', 'TimePicker', 'Calendar', 'Command', 'CommandList', 'Cascader', 'Cascade']);
const catalog = getSourceOnlyUpgradeCatalog();
const dropdownRule = catalog.find(rule => rule.detector === 'dropdown-scroll-owner')!;
const popoverRule = catalog.find(rule => rule.detector === 'popover-scroll-body')!;
const exportRule = catalog.find(rule => rule.detector === 'named-export')!;

/** Compare literal public bindings and finite behavior evidence against the explicitly inspected target. */
export async function checkSourceOnlyUpgradeUsage(files: readonly SourceOnlyFile[], target: SourceOnlyUpgradeTargetInspection): Promise<SourceOnlyUpgradeUsageInspection> {
  const graph = createUpgradeBindingGraph(files), findings: PlatformDoctorFinding[] = [];
  let publicBindings = 0, unresolvedLocalBindings = 0, behaviorReviews = 0;
  const queries = new Map<string, ReturnType<SourceOnlyUpgradeTargetInspection['inspectNamedExport']>>();
  const checkedNames = new Set<string>();
  const failedImports = new Set<string>();
  const reported = new Set<string>();
  const add = (module: UpgradeSourceModule, node: ts.Node, code: string, message: string,
    severity: PlatformDoctorFinding['severity'], category: PlatformDoctorFinding['category'], hint: string, confidence: PlatformDoctorFinding['confidence'] = 'high', docs = exportRule.docs) => {
    const line = module.file.getLineAndCharacterOfPosition(node.getStart(module.file)).line + 1;
    const key = `${module.input.path}\0${node.getStart(module.file)}\0${code}`;
    if (reported.has(key)) return; reported.add(key);
    findings.push({ path: `${module.input.path}:${line}`, line, code, message, severity, category, confidence, hint, docs });
  };
  async function inspect(module: UpgradeSourceModule, node: ts.Node, binding: UpgradePublicBinding, kind: UpgradeExportKind) {
    const key = `${binding.specifier}\0${binding.name}\0${kind}`;
    checkedNames.add(`${binding.specifier}\0${binding.name}`);
    if (!queries.has(key)) queries.set(key, target.inspectNamedExport(binding.specifier, binding.name, kind));
    const evidence = await queries.get(key)!;
    const importKey = `${module.input.path}\0${binding.specifier}\0${binding.name}`;
    if (evidence.status === 'missing') {
      if (kind === 'value' && failedImports.has(importKey)) return;
      if (kind === 'any') failedImports.add(importKey);
      add(module, node, exportRule.code,
        'This named public binding is not provided by the inspected upgrade target.', exportRule.severity, exportRule.category, exportRule.hint);
    }
    else if (evidence.status === 'unknown') add(module, node, 'upgrade.export_unknown',
      'The inspected target cannot establish this public binding; availability remains unproven.', 'info', 'manual-review',
      'Review the intended public export graph before migrating. Unreadable, ambiguous or dynamic evidence is not a missing-export proof.');
  }
  for (const module of graph.modules) {
    if (!module.parsed) {
      if (module.incomplete) add(module, module.file, 'upgrade.binding_unknown',
        'Source nesting exceeds safe static parser or traversal limits; this file’s upgrade usage was not audited.', 'info', 'manual-review',
        'Simplify or explicitly exclude generated deeply nested source before treating upgrade coverage as complete. No missing-export or behavior claim is made from incomplete inspection.');
      continue; // The existing source checker owns ordinary syntax diagnostics.
    }
    const references = graph.references(module);
    publicBindings += references.length;
    for (const reference of references) await inspect(module, reference.node, reference.binding, reference.exportKind);
    const unresolved = new Set<ts.Node>();
    for (const statement of module.file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !isUpgradeLocalSpecifier(statement.moduleSpecifier.text)) continue;
      const named = statement.importClause?.namedBindings;
      const names = [...(statement.importClause?.name ? [statement.importClause.name] : []),
        ...(named && ts.isNamedImports(named) ? named.elements.map(item => item.name) : named && ts.isNamespaceImport(named) ? [named.name] : [])];
      for (const name of names) if (graph.local(module, name.text).kind === 'unknown') {
        unresolvedLocalBindings++;
        unresolved.add(upgradeLocalIdentifierIdentity(name) ?? name);
        add(module, name, 'upgrade.binding_unknown', 'An admitted local import graph could not establish this binding’s origin.', 'info', 'manual-review',
          'Include the required local source/re-export chain for inspection, or review this binding manually. No Zero migration requirement is inferred.');
      }
    }
    const scrollRefs = new Map<ts.Node, ts.JsxOpeningLikeElement[]>();
    const runtime: Array<{ node: ts.Node; binding: UpgradePublicBinding }> = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        if (!ts.isJsxNamespacedName(opening.tagName)) {
          const binding = graph.expression(module, opening.tagName);
          if (binding.kind === 'unknown' && ts.isIdentifier(opening.tagName)) {
            const identity = upgradeLocalIdentifierIdentity(opening.tagName) ?? opening.tagName;
            if (!unresolved.has(identity)) { unresolved.add(identity); unresolvedLocalBindings++;
              add(module, opening.tagName, 'upgrade.binding_unknown', 'This bounded immutable component alias could not establish its binding origin.', 'info', 'manual-review',
                'Review the admitted import/re-export and immutable alias chain. Cycles and incomplete resolution do not prove a Zero migration requirement.'); }
          }
          if (binding.kind === 'named' && !binding.typeOnly) {
            runtime.push({ node: opening.tagName, binding });
            if (binding.name === 'DropdownMenuContent' || binding.name === 'DropdownMenuSubContent') {
              const onScroll = attribute(opening, 'onScroll');
              if (onScroll?.initializer && !absentHandler(onScroll)) reviewDropdown(module, onScroll, uncertainAfter(opening, onScroll));
              const ref = attribute(opening, 'ref'), expression = ref && attributeExpression(ref);
              if (expression && ts.isIdentifier(expression) && !uncertainAfter(opening, ref!)) {
                const identity = upgradeLocalIdentifierIdentity(expression);
                if (identity) scrollRefs.set(identity, [...(scrollRefs.get(identity) ?? []), opening]);
              }
            }
            if (binding.name === 'PopoverContent' && ts.isJsxElement(node) && outerScroll(opening) && !containsOwnedScroller(node)) {
              const status = target.summary.capabilities.popoverViewport;
              if (status !== 'missing') {
                behaviorReviews++;
                add(module, opening, popoverRule.code, 'This authored popover makes the outer surface its scroll owner; review its bounded body composition.',
                  status === 'available' ? popoverRule.severity : 'info', status === 'available' ? popoverRule.category : 'manual-review',
                  status === 'available' ? popoverRule.hint : 'Target support for a dedicated popover viewport is unproven. Review the body and existing scroll ownership before changing it.', 'medium', popoverRule.docs);
              }
            }
          }
        }
      }
      // Proven runtime receivers/callees require value exports, unlike ordinary import syntax used only as a type.
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const binding = graph.expression(module, node.expression);
        if (binding.kind === 'named' && !binding.typeOnly) runtime.push({ node: node.expression, binding });
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !typePosition(node)) {
        const binding = graph.expression(module, node);
        if (binding.kind === 'named' && !binding.typeOnly) runtime.push({ node, binding });
      }
      if (ts.isIdentifier(node) && provenValueIdentifier(node) && !typePosition(node)) {
        const binding = graph.expression(module, node);
        if (binding.kind === 'named' && !binding.typeOnly) runtime.push({ node, binding });
      }
      ts.forEachChild(node, visit);
    };
    function containsOwnedScroller(container: ts.JsxElement): boolean {
      let owned = false;
      const find = (node: ts.Node) => {
        if (owned) return;
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node;
          if (!ts.isJsxNamespacedName(opening.tagName)) {
            const binding = graph.expression(module, opening.tagName);
            if (binding.kind === 'named' && !binding.typeOnly && ownScrollers.has(binding.name)) { owned = true; return; }
          }
        }
        ts.forEachChild(node, find);
      };
      container.children.forEach(find); return owned;
    }
    function reviewDropdown(module: UpgradeSourceModule, node: ts.Node, dynamic = false) {
      const status = target.summary.capabilities.dropdownInnerViewport;
      if (status === 'missing') return;
      behaviorReviews++;
      add(module, node, dropdownRule.code, 'This dropdown assumes Content itself owns native scrolling; the inspected contract needs review.',
        status === 'available' && !dynamic ? dropdownRule.severity : 'info', 'manual-review',
        status === 'available' ? dropdownRule.hint : 'The target’s dropdown viewport ownership could not be established. Keep compatible usage until the contract is verified.',
        dynamic ? 'low' : 'high', dropdownRule.docs);
    }
    visit(module.file);
    const scrollUse = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && ['scrollTop', 'scrollLeft', 'scrollTo', 'scrollBy'].includes(node.name.text)) {
        const receiver = unwrapUpgradeExpression(node.expression);
        const called = !['scrollTo', 'scrollBy'].includes(node.name.text) || ts.isCallExpression(node.parent) && node.parent.expression === node;
        if (called && ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'current') {
          const ref = unwrapUpgradeExpression(receiver.expression);
          if (ts.isIdentifier(ref)) { const identity = upgradeLocalIdentifierIdentity(ref); if (identity && scrollRefs.has(identity)) reviewDropdown(module, node); }
        }
      }
      ts.forEachChild(node, scrollUse);
    };
    scrollUse(module.file);
    for (const reference of runtime) await inspect(module, reference.node, reference.binding, 'value');
  }
  return { findings, stats: { inspectedFiles: graph.modules.filter(module => module.parsed).length, publicBindings,
    checkedNamedExports: checkedNames.size, unresolvedLocalBindings, behaviorReviews } };
}

function typePosition(node: ts.Node): boolean {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isTypeNode(parent)) return true;
    if (ts.isStatement(parent) || ts.isJsxExpression(parent)) return false;
    parent = parent.parent;
  }
  return false;
}

function provenValueIdentifier(node: ts.Identifier): boolean {
  let expression: ts.Node = node, parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)
    || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent)) && parent.expression === expression) { expression = parent; parent = parent.parent; }
  if (!parent) return false;
  return (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.initializer === expression
    || ts.isJsxExpression(parent) && parent.expression === expression
    || (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && (parent.expression === expression || parent.arguments?.includes(expression as ts.Expression))
    || ts.isShorthandPropertyAssignment(parent) && parent.name === expression
    || (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === expression
    || ts.isReturnStatement(parent) && parent.expression === expression
    || ts.isArrowFunction(parent) && parent.body === expression
    || ts.isArrayLiteralExpression(parent) && parent.elements.includes(expression as ts.Expression)
    || ts.isBinaryExpression(parent) && (parent.left === expression || parent.right === expression)
    || ts.isConditionalExpression(parent) && (parent.condition === expression || parent.whenTrue === expression || parent.whenFalse === expression)
    || (ts.isAwaitExpression(parent) || ts.isYieldExpression(parent) || ts.isSpreadElement(parent)
      || ts.isTypeOfExpression(parent) || ts.isVoidExpression(parent)) && parent.expression === expression
    || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && parent.operand === expression;
}

function absentHandler(item: ts.JsxAttribute): boolean {
  const expression = attributeExpression(item);
  return !!expression && (expression.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(expression) && expression.text === 'undefined'
    || ts.isVoidExpression(expression));
}

function attribute(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return [...opening.attributes.properties].reverse().find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name);
}
function attributeExpression(item: ts.JsxAttribute): ts.Expression | null {
  return item.initializer && ts.isJsxExpression(item.initializer) && item.initializer.expression ? unwrapUpgradeExpression(item.initializer.expression) : null;
}
function uncertainAfter(opening: ts.JsxOpeningLikeElement, item: ts.JsxAttribute): boolean {
  return opening.attributes.properties.slice(opening.attributes.properties.indexOf(item) + 1).some(ts.isJsxSpreadAttribute);
}
function outerScroll(opening: ts.JsxOpeningLikeElement): boolean {
  const className = attribute(opening, 'className');
  if (className && !uncertainAfter(opening, className)) {
    const expression = attributeExpression(className);
    const text = className.initializer && ts.isStringLiteral(className.initializer) ? className.initializer.text : expression && ts.isStringLiteralLike(expression) ? expression.text : '';
    if (text.split(/\s+/u).some(token => /^(?:overflow|overflow-[xy])-(?:auto|scroll)$/u.test(token))) return true;
  }
  const style = attribute(opening, 'style'), object = style && !uncertainAfter(opening, style) ? attributeExpression(style) : null;
  if (!object || !ts.isObjectLiteralExpression(object)) return false;
  for (const key of ['overflow', 'overflowY', 'overflowX']) for (const property of [...object.properties].reverse()) {
    if (ts.isSpreadAssignment(property)) break;
    if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === key) {
      if (ts.isPropertyAssignment(property)) { const value = unwrapUpgradeExpression(property.initializer); if (ts.isStringLiteralLike(value) && ['auto', 'scroll'].includes(value.text)) return true; }
      break;
    }
  }
  return false;
}
