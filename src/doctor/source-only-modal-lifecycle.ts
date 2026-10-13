/**
 * Bounded AST evidence for managed close versus controlled retirement. This
 * source-only check follows local callbacks, never executes code, and does not
 * mistake effect cleanup or identity changes for ordinary dismissal handlers.
 */
import ts from 'typescript';
import { dirname, posix } from 'node:path';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import type { SourceOnlyPackageInfo } from './source-only-package';
import type { SourceOnlyFile } from './source-only-types';
import { createUpgradeBindingGraph, isUpgradePublicSpecifier, upgradeLocalIdentifierIdentity, unwrapUpgradeExpression } from './source-only-upgrade-bindings';

const docs = './docs-next/cli/doctor/source-audit.md#managed-close-lifecycle';
type Callback = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration;

/** Report proven local close shortcuts and explicitly uncertain delegated guards. */
export function checkSourceOnlyModalLifecycle(input: SourceOnlyFile, installed: SourceOnlyPackageInfo): PlatformDoctorFinding[] {
  if (installed.modalShow !== true) return [];
  const ownControlled = (specifier: string) => installed.status === 'workspace' && specifier.startsWith('.')
    && posix.normalize(posix.join(dirname(input.resolutionPath ?? input.path), specifier)).replace(/\.(?:tsx?|jsx?)$/u, '') === 'src/modals/modal-controlled';
  const graph = createUpgradeBindingGraph([input], specifier => isUpgradePublicSpecifier(specifier) || specifier === 'react' || ownControlled(specifier));
  const module = graph.modules[0];
  if (!module?.parsed) return [];
  const file = module.file, findings: PlatformDoctorFinding[] = [], emitted = new Set<string>();
  const bindingIs = (expression: ts.Expression, name: string, react = false) => {
    const binding = graph.expression(module, expression);
    return binding.kind === 'named' && !binding.typeOnly && binding.name === name
      && (react ? binding.specifier === 'react' : isUpgradePublicSpecifier(binding.specifier) || ownControlled(binding.specifier));
  };
  const add = (node: ts.Node, code: string, message: string, confidence: 'high' | 'medium' | 'low', hint: string) => {
    const key = `${code}:${node.pos}`; if (emitted.has(key)) return; emitted.add(key);
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ code, message, confidence, hint, docs, line, path: `${input.path}:${line}`,
      severity: confidence === 'low' ? 'info' : 'warning', category: confidence === 'high' ? 'recommended' : 'manual-review' });
  };
  const declaration = (node: ts.Identifier): ts.Node | null => {
    const local = upgradeLocalIdentifierIdentity(node);
    let localScope = local?.parent;
    while (localScope && !ts.isFunctionLike(localScope) && !ts.isBlock(localScope) && !ts.isSourceFile(localScope)
      && !ts.isModuleBlock(localScope) && !ts.isCatchClause(localScope) && !ts.isForStatement(localScope)
      && !ts.isForInStatement(localScope) && !ts.isForOfStatement(localScope)) localScope = localScope.parent;
    // The shared identity helper handles parameters/imports/variables. Include
    // locally declared functions without equating same-spelling outer handlers.
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (parent === localScope) return local;
      if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent)) {
        const declared = parent.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === node.text);
        if (declared) return declared;
      }
    }
    return local;
  };
  function value(expression: ts.Expression, seen = new Set<ts.Node>()): ts.Expression {
    expression = unwrapUpgradeExpression(expression);
    if (!ts.isIdentifier(expression)) return expression;
    const d = declaration(expression);
    if (!d || seen.has(d) || seen.size >= 24 || !ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || !d.initializer
      || !ts.isVariableDeclarationList(d.parent) || !(d.parent.flags & ts.NodeFlags.Const)) return expression;
    const initial = unwrapUpgradeExpression(d.initializer);
    if (ts.isCallExpression(initial) && bindingIs(initial.expression, 'useCallback', true)) return initial;
    // A state/transport call is not an immutable alias, even in a const binding.
    if (!ts.isIdentifier(initial) && !ts.isPropertyAccessExpression(initial) && !ts.isObjectLiteralExpression(initial)
      && !ts.isArrowFunction(initial) && !ts.isFunctionExpression(initial)) return expression;
    return value(initial, new Set(seen).add(d));
  }
  function same(left: ts.Expression, right: ts.Expression, depth = 0): boolean {
    if (depth >= 24) return false;
    left = value(left); right = value(right);
    if (ts.isIdentifier(left) && ts.isIdentifier(right)) {
      const a = declaration(left), b = declaration(right);
      return !!a && a === b && left.text === right.text;
    }
    return ts.isPropertyAccessExpression(left) && ts.isPropertyAccessExpression(right)
      && left.name.text === right.name.text && same(left.expression, right.expression, depth + 1);
  }
  function callback(expression: ts.Expression, seen = new Set<ts.Node>()): Callback | null {
    expression = value(expression);
    if (seen.has(expression) || seen.size >= 24) return null;
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
    if (ts.isIdentifier(expression)) { const d = declaration(expression); if (d && ts.isFunctionDeclaration(d) && d.body) return d; }
    if (ts.isCallExpression(expression) && bindingIs(expression.expression, 'useCallback', true) && expression.arguments[0])
      return callback(expression.arguments[0], new Set(seen).add(expression));
    return null;
  }
  function field(object: ts.ObjectLiteralExpression, name: string): ts.Expression | ts.MethodDeclaration | null {
    for (const item of [...object.properties].reverse()) {
      if (ts.isSpreadAssignment(item)) return null;
      if (item.name && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name) {
        if (ts.isPropertyAssignment(item)) return item.initializer;
        if (ts.isShorthandPropertyAssignment(item)) return item.name;
        if (ts.isMethodDeclaration(item) && item.body) return item;
        return null;
      }
    }
    return null;
  }
  function attr(node: ts.JsxOpeningLikeElement, name: string): ts.Expression | null {
    for (const item of [...node.attributes.properties].reverse()) {
      if (ts.isJsxSpreadAttribute(item)) return null;
      if (item.name.getText(file) !== name) continue;
      return item.initializer && ts.isJsxExpression(item.initializer) ? item.initializer.expression ?? null : null;
    }
    return null;
  }
  function method(call: ts.CallExpression): string | null {
    const expression = unwrapUpgradeExpression(call.expression);
    return ts.isPropertyAccessExpression(expression) && bindingIs(expression.expression, 'modals') ? expression.name.text : null;
  }
  function handlers(fn: Callback): ts.CallExpression[] {
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (node !== fn && ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    if (fn.body) visit(fn.body);
    return calls;
  }
  function targets(expression: ts.Expression | null): ts.Expression[] {
    if (!expression) return [];
    const fn = callback(expression);
    if (!fn) return [expression];
    const name = fn.parameters[0]?.name;
    if (!name || !ts.isIdentifier(name)) return [];
    return handlers(fn).filter(call => call.arguments[0] && ts.isIdentifier(unwrapUpgradeExpression(call.arguments[0]))
      && declaration(unwrapUpgradeExpression(call.arguments[0]) as ts.Identifier) === fn.parameters[0]).map(call => call.expression);
  }
  function inspect(start: Callback, closeTargets: readonly ts.Expression[]): { unknown: boolean; managed: boolean } {
    const pending = [start], seen = new Set<Callback>(); let unknown = false, managed = false;
    while (pending.length) {
      const fn = pending.shift()!;
      if (seen.has(fn)) continue;
      if (seen.size >= 64) { unknown = true; break; }
      seen.add(fn);
      for (const call of handlers(fn)) {
        const m = method(call);
        if (m && ['disposeHost', 'discardAll', 'closeAll'].includes(m)) add(call, 'usage.modal.close_retirement',
          'A modal interaction callback invokes immediate retirement or bulk removal instead of exact-instance managed closing.', 'medium',
          'Use the modal context/handle for ordinary dismissal or accepted completion. Reserve disposal for deliberate owner/scope teardown; document and narrowly allow intentional retirement.');
        else if (m && ['requestClose', 'close', 'closeLast'].includes(m)) managed = true;
        if (call.arguments.length === 1 && unwrapUpgradeExpression(call.arguments[0]!).kind === ts.SyntaxKind.FalseKeyword
          && closeTargets.some(target => same(target, call.expression))) add(call, 'usage.modal.controlled_close_bypass',
          'A controlled modal interaction directly calls its open-state callback with false, bypassing the manager’s normal exit lifecycle.', 'high',
          'Keep the controlled opening alive while the manager admits/closes the exact modal. Reflect onOpenChange only from its settled result; direct open=false/unmount remains appropriate for scope or identity retirement.');
        const next = callback(call.expression);
        if (next) pending.push(next); else if (!m) unknown = true;
        // Follow callback arguments, not arbitrary uncalled nested declarations.
        for (const argument of call.arguments) { const nested = callback(argument); if (nested) pending.push(nested); }
      }
    }
    return { unknown, managed };
  }
  function descriptor(object: ts.ObjectLiteralExpression, closeTargets: readonly ts.Expression[]) {
    const guard = field(object, 'beforeClose');
    const guardFn = guard && (ts.isMethodDeclaration(guard) ? guard : callback(guard));
    if (guardFn) {
      const result = inspect(guardFn, closeTargets);
      const body = guardFn.body;
      // Explicit refusal plus delegation is evidence of a review seam, not proof
      // that another controller closes incorrectly or that its guard is invalid.
      if (closeTargets.length && body && ts.isBlock(body) && result.unknown && !result.managed
        && body.statements.length === 2 && ts.isExpressionStatement(body.statements[0]!)
        && ts.isReturnStatement(body.statements[1]!) && body.statements[1]!.expression?.kind === ts.SyntaxKind.FalseKeyword) {
        add(guardFn, 'usage.modal.close_flow_review',
          'A controlled guard delegates closing to another callback while refusing manager dismissal; the delegated lifecycle needs review.', 'low',
          'Trace the delegated controller: normal cancel/discard/accepted-save must close through the manager, not directly set open=false. External helpers are not qualified by this bounded static check.');
      }
    }
    const actions = field(object, 'actions');
    if (actions && ts.isArrayLiteralExpression(actions)) for (const item of actions.elements) {
      const action = value(item); if (!ts.isObjectLiteralExpression(action)) continue;
      const onClick = field(action, 'onClick'); const fn = onClick && (ts.isMethodDeclaration(onClick) ? onClick : callback(onClick));
      if (fn) inspect(fn, closeTargets);
    }
    const body = field(object, 'body');
    if (body && !ts.isMethodDeclaration(body)) {
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && /^(?:onClick|onSubmit|onCancel|onClose)$/u.test(node.name.getText(file))
          && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const fn = callback(node.initializer.expression); if (fn) inspect(fn, closeTargets);
        }
        ts.forEachChild(node, visit);
      }; visit(body);
    }
  }
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (!ts.isJsxNamespacedName(node.tagName) && bindingIs(node.tagName, 'ControlledModal')) {
        const supplied = attr(node, 'descriptor'); const object = supplied && value(supplied);
        if (object && ts.isObjectLiteralExpression(object)) descriptor(object, targets(attr(node, 'onOpenChange')));
      }
    }
    if (ts.isCallExpression(node) && method(node) === 'show' && node.arguments[0]) {
      const object = value(node.arguments[0]); if (ts.isObjectLiteralExpression(object)) descriptor(object, []);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}
