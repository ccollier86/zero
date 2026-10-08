/**
 * AST evidence for recognizable public modal calls, private imports and invalid
 * native control nesting. No typechecker/program, imports or app code execution.
 * Dynamic wrappers/spreads require human review; visual layout cannot be proven.
 */
import ts from 'typescript';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import { sourceOnlyExported, sourceOnlyOwnAlias, type SourceOnlyPackageInfo } from './source-only-package';
import type { SourceOnlyFile } from './source-only-types';

const docs = './docs-next/cli/doctor/source-audit.md#structured-modal-migration';
const modalKeys = new Set(['title', 'meta', 'description', 'icon', 'tone', 'size', 'customSize', 'placement', 'height', 'scrollbar', 'navScrollbar',
  'dismissible', 'allowEditingWhilePending', 'closeOnClickOutside', 'closeOnEscape', 'guard', 'beforeClose', 'footer', 'actions', 'headerActions',
  'motion', 'trigger', 'initialFocus', 'role', 'className', 'dataSlot', 'parentId', 'onClose', 'onCloseAutoFocus', 'layout', 'body', 'sections', 'initialSection']);
const motionKeys = new Set(['entrance', 'exit', 'backdrop', 'pageRecedes', 'durationMultiplier']);
const enumOptions: Record<string, readonly string[]> = {
  size: ['xs', 'sm', 'md', 'lg', 'xl', 'full'], placement: ['center', 'left', 'right', 'bottom'], height: ['auto', 'fixed'],
  scrollbar: ['auto', 'thin', 'hidden'], navScrollbar: ['auto', 'thin', 'hidden'], layout: ['content', 'tabs', 'nav'], tone: ['default', 'info', 'success', 'danger'],
};
const motionEnums: Record<string, readonly string[]> = { entrance: ['rise', 'grow', 'origin', 'spring', 'focus', 'drop'], exit: ['mirror', 'fade'], backdrop: ['dim', 'blur'] };

/** Analyze one source file. Findings contain locations and fixed messages, not source excerpts. */
export function checkSourceOnlyModals(input: SourceOnlyFile, installed: SourceOnlyPackageInfo): PlatformDoctorFinding[] {
  const kind = /\.(tsx|jsx)$/u.test(input.path) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/u.test(input.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(input.path, input.source, ts.ScriptTarget.Latest, true, kind);
  const findings: PlatformDoctorFinding[] = [];
  const add = (node: ts.Node, code: string, message: string, severity: PlatformDoctorFinding['severity'] = 'warning',
    category: PlatformDoctorFinding['category'] = 'recommended', confidence: PlatformDoctorFinding['confidence'] = 'high', hint?: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ code, severity, category, confidence, line, path: `${input.path}:${line}`, message, docs, ...(hint ? { hint } : {}) });
  };
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics?.length) {
    const diagnostic = diagnostics[0]!;
    const line = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    return [{ severity: 'error', code: 'usage.source.parse_failed', category: 'required', confidence: 'high', path: `${input.path}:${line}`, line,
      message: 'Source syntax could not be parsed reliably; this file was not audited.', hint: 'Correct syntax or explicitly exclude unsupported generated source before treating coverage as complete.', docs }];
  }
  const bindings = new Set<string>(); const namespaces = new Set<string>();
  const checkImport = (source: string, node: ts.Node) => {
    const zero = source === '@zero/framework' || source.startsWith('@zero/framework/');
    if ((source.startsWith('#zero/') || source === '#zero') && !sourceOnlyOwnAlias(source, installed.ownImports)) {
      add(node, 'usage.import.private_zero', 'This import uses a framework-private #zero alias.', 'error', 'required', 'high',
        'Use an inspected installed public package export; a copied framework imports map does not make internal modules public.');
    } else if (zero && (installed.publicExports.length || installed.deniedExports.length) && !sourceOnlyExported(source, installed.publicExports, installed.deniedExports)) {
      add(node, 'usage.import.missing_export', 'This framework subpath is not exported by the inspected installed package.', 'error', 'required', 'high',
        'Use that package version’s public exports, or upgrade deliberately before using a newer facade.');
    }
  };
  for (const node of file.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const source = node.moduleSpecifier.text;
    const zero = source === '@zero/framework' || source.startsWith('@zero/framework/');
    checkImport(source, node.moduleSpecifier);
    const importedNames = node.importClause?.namedBindings;
    const publicDialog = zero && importedNames && ts.isNamedImports(importedNames)
      && importedNames.elements.some(item => ['Dialog', 'DialogContent', 'AlertDialog', 'AlertDialogContent'].includes(item.propertyName?.text ?? item.name.text));
    const radixDialog = source === 'radix-ui' && importedNames && ts.isNamedImports(importedNames)
      && importedNames.elements.some(item => ['Dialog', 'AlertDialog'].includes(item.propertyName?.text ?? item.name.text));
    if (source === '@radix-ui/react-dialog' || source === '@radix-ui/react-alert-dialog' || radixDialog || publicDialog) {
      add(node.moduleSpecifier, 'usage.modal.direct_primitive', 'Direct dialog primitives need review for integration with the shared manager, shell and owned overlays.', 'warning', 'manual-review', 'medium',
        'Use the structured modal facade for ordinary dialogs; retain a deliberate manager-owned custom integration only where needed.');
    }
    if (!zero || node.importClause?.isTypeOnly) continue;
    const named = node.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
    if (named && ts.isNamedImports(named)) {
      for (const item of named.elements) if (!item.isTypeOnly && (item.propertyName?.text ?? item.name.text) === 'modals') bindings.add(item.name.text);
    }
  }

  const unshadowed = (name: string, node: ts.Node) => {
    let ancestor: ts.Node | undefined = node.parent;
    while (ancestor && ancestor !== file) {
      if (ts.isFunctionLike(ancestor) && ancestor.parameters.some(parameter => hasName(parameter.name, name))) return false;
      if (ts.isCatchClause(ancestor) && ancestor.variableDeclaration && hasName(ancestor.variableDeclaration.name, name)) return false;
      if (ts.isBlock(ancestor) && ancestor.statements.some(statement => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some(declaration => hasName(declaration.name, name)))) return false;
      ancestor = ancestor.parent;
    }
    return true;
  };

  function modalMethod(node: ts.CallExpression): string | null {
    const expression = unwrap(node.expression);
    if (!ts.isPropertyAccessExpression(expression)) return null;
    const receiver = unwrap(expression.expression);
    if (ts.isIdentifier(receiver) && bindings.has(receiver.text) && unshadowed(receiver.text, node)) return expression.name.text;
    if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'modals' && ts.isIdentifier(receiver.expression)
      && namespaces.has(receiver.expression.text) && unshadowed(receiver.expression.text, node)) return expression.name.text;
    return null;
  }

  function visit(node: ts.Node) {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkImport(node.moduleSpecifier.text, node.moduleSpecifier);
    if (ts.isCallExpression(node)) {
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) checkImport(node.arguments[0].text, node.arguments[0]);
      const method = modalMethod(node);
      if (method === 'open') {
        add(node, 'usage.modal.legacy_open', 'Legacy modals.open retains its string ID API but does not provide the structured shell contract.',
          installed.modalShow === true ? 'warning' : 'info', installed.modalShow === true ? 'recommended' : 'manual-review', 'high',
          installed.modalShow === true ? 'Migrate ordinary dialogs to the installed modals.show descriptor/handle API; do not simply rename a call whose return value or content frame differs.'
            : 'The inspected package does not establish modals.show support. Keep the compatible call and review an upgrade before migrating.');
      }
      if (method === 'show') {
        if (installed.modalShow === false) add(node, 'usage.modal.unavailable_show', 'The inspected installed modals facade does not export show.', 'error', 'required', 'high', 'Upgrade the installed package or use its supported facade.');
        const argument = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
        if (argument && ts.isObjectLiteralExpression(argument)) checkDescriptor(argument);
        else add(node, 'usage.modal.dynamic_descriptor', 'The structured descriptor is not a local literal; required fields and runtime layout need manual review.', 'info', 'manual-review', 'low');
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (jsxAttribute(opening, 'role') === 'dialog' || jsxAttribute(opening, 'role') === 'alertdialog') {
        add(opening, 'usage.modal.custom_frame', 'A manually authored dialog frame needs review for managed naming, close controls, scrolling, focus and portal ownership.', 'warning', 'manual-review', 'medium');
      }
      if (ts.isJsxElement(node) && interactive(opening)) {
        let child: ts.Node | null = null;
        const find = (candidate: ts.Node) => {
          if (child) return;
          if ((ts.isJsxElement(candidate) && interactive(candidate.openingElement)) || (ts.isJsxSelfClosingElement(candidate) && interactive(candidate))) { child = candidate; return; }
          ts.forEachChild(candidate, find);
        };
        node.children.forEach(find);
        if (child) add(child, 'usage.modal.nested_interactive', 'A native interactive control is nested inside another native button/link control.', 'warning', 'required', 'high', 'Use a semantic list row with separate trailing controls rather than an outer button containing controls.');
      }
    }
    ts.forEachChild(node, visit);
  }

  function checkDescriptor(object: ts.ObjectLiteralExpression) {
    const title = property(object, 'title');
    if (title.kind === 'absent' || (title.kind === 'known' && typeof literal(title.value) !== 'undefined'
      && (typeof literal(title.value) !== 'string' || !(literal(title.value) as string).trim()))) {
      add(object, 'usage.modal.title_required', 'A structured modal requires a nonempty visible title.', 'error', 'required', 'high');
    } else if (title.kind === 'unknown') add(object, 'usage.modal.dynamic_title', 'A spread may supply or override the title; static inspection cannot establish its accessible name.', 'info', 'manual-review', 'low');
    for (const item of object.properties) {
      if (!ts.isPropertyAssignment(item)) continue;
      const key = propertyName(item.name); if (!key) continue;
      if (!modalKeys.has(key)) add(item.name, 'usage.modal.unsupported_option', 'A literal structured descriptor option is not part of the current public modal contract.', 'error', 'required', 'high');
      const effective = property(object, key);
      if (effective.kind !== 'known' || effective.value !== unwrap(item.initializer)) {
        if (effective.kind === 'unknown' && (enumOptions[key] || key === 'motion')) add(item, 'usage.modal.dynamic_option', 'A spread may override this option; its effective value requires manual review.', 'info', 'manual-review', 'low');
        continue;
      }
      const value = literal(unwrap(item.initializer));
      if (enumOptions[key] && value !== undefined && !enumOptions[key]!.includes(value as string)) add(item.initializer, 'usage.modal.invalid_option', 'A literal modal option has an unsupported value.', 'error', 'required', 'high');
      if (key === 'motion' && ts.isObjectLiteralExpression(unwrap(item.initializer))) checkMotion(unwrap(item.initializer) as ts.ObjectLiteralExpression);
    }
    const layout = property(object, 'layout'); const body = property(object, 'body'); const sections = property(object, 'sections');
    if (layout.kind === 'known' && ['tabs', 'nav'].includes(literal(layout.value) as string) && body.kind === 'known') {
      add(object, 'usage.modal.mixed_layout', 'Tabs/navigation descriptors cannot also supply a content body.', 'error', 'required', 'high');
    }
    if (layout.kind === 'known' && ['tabs', 'nav'].includes(literal(layout.value) as string) && sections.kind === 'absent') {
      add(object, 'usage.modal.sections_required', 'Tabs/navigation descriptors require sections.', 'error', 'required', 'high');
    }
  }

  function checkMotion(object: ts.ObjectLiteralExpression) {
    for (const item of object.properties) {
      if (!ts.isPropertyAssignment(item)) continue;
      const key = propertyName(item.name); if (!key) continue;
      if (!motionKeys.has(key)) add(item.name, 'usage.modal.motion_option', 'This literal motion setting is not supported; pace is configured with durationMultiplier, not speed.', 'error', 'required', 'high');
      const effective = property(object, key);
      if (effective.kind !== 'known' || effective.value !== unwrap(item.initializer)) {
        if (effective.kind === 'unknown') add(item, 'usage.modal.dynamic_option', 'A spread may override this motion setting; its effective value requires manual review.', 'info', 'manual-review', 'low');
        continue;
      }
      const value = literal(unwrap(item.initializer));
      if (motionEnums[key] && value !== undefined && !motionEnums[key]!.includes(value as string)) add(item.initializer, 'usage.modal.motion_value', 'This literal modal motion choice is unsupported.', 'error', 'required', 'high');
      if (key === 'durationMultiplier' && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < .5 || value > 2.5)) add(item.initializer, 'usage.modal.motion_pace', 'The modal duration multiplier must be finite and between 0.5 and 2.5.', 'error', 'required', 'high');
      if (key === 'pageRecedes' && value !== undefined && typeof value !== 'boolean') add(item.initializer, 'usage.modal.motion_value', 'The pageRecedes setting must be boolean.', 'error', 'required', 'high');
    }
  }
  visit(file);
  return findings;
}

function hasName(name: ts.BindingName, text: string): boolean {
  return ts.isIdentifier(name) ? name.text === text : name.elements.some(element => ts.isBindingElement(element) && hasName(element.name, text));
}
function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}
function propertyName(node: ts.PropertyName): string | null { return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null; }
function literal(node: ts.Expression): string | number | boolean | null | undefined {
  node = unwrap(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node) && node.text === 'Infinity') return Infinity;
  if (ts.isIdentifier(node) && node.text === 'NaN') return Number.NaN;
  if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)) {
    const value = literal(node.operand); if (typeof value === 'number') return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  return undefined;
}
function property(object: ts.ObjectLiteralExpression, key: string): { kind: 'known'; value: ts.Expression } | { kind: 'unknown' | 'absent' } {
  for (const item of [...object.properties].reverse()) {
    if (ts.isSpreadAssignment(item)) return { kind: 'unknown' };
    if (item.name && propertyName(item.name) === key) {
      return ts.isPropertyAssignment(item) ? { kind: 'known', value: unwrap(item.initializer) } : { kind: 'unknown' };
    }
  }
  return { kind: 'absent' };
}
function jsxAttribute(node: ts.JsxOpeningLikeElement, name: string): string | null {
  for (const attribute of node.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.getText() === name && attribute.initializer && ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  }
  return null;
}
function interactive(node: ts.JsxOpeningLikeElement): boolean {
  const name = node.tagName.getText();
  return ['button', 'input', 'select', 'textarea'].includes(name) || (name === 'a' && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'href'));
}
