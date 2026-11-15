/** Narrow AST evidence for sequential source lanes. Never evaluates handlers/config or rewrites an application. */
import ts from 'typescript';
import { createUpgradeBindingGraph, unwrapUpgradeExpression } from './source-only-upgrade-bindings';
import type { SourceOnlyFile } from './source-only-types';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';

export function checkSourceOnlyBackground(input: SourceOnlyFile): PlatformDoctorFinding[] {
  const graph = createUpgradeBindingGraph([input], specifier => specifier === '@zero/framework/database-automations'), module = graph.modules[0];
  if (!module?.parsed) return [];
  const file = module.file, findings: PlatformDoctorFinding[] = [];
  const property = (object: ts.ObjectLiteralExpression, name: string) => object.properties.find(item =>
    (ts.isPropertyAssignment(item) || ts.isMethodDeclaration(item)) && item.name
      && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name);
  const add = (node: ts.Node, code: string, message: string, hint: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ code, path: `${input.path}:${line}`, line, severity: 'warning', category: 'recommended', confidence: 'high',
      message, hint, docs: './docs-next/backend/torrent/enqueue.md' });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const binding = graph.expression(module, node.expression);
      if (binding.kind === 'named' && binding.name === 'defineDatabaseFunction' && !binding.typeOnly) {
        const argument = node.arguments[0] && unwrapUpgradeExpression(node.arguments[0]);
        if (argument && ts.isObjectLiteralExpression(argument) && !argument.properties.some(ts.isSpreadAssignment)) {
          const mode = property(argument, 'mode'), handler = property(argument, 'handler');
          if (mode && ts.isPropertyAssignment(mode) && ts.isStringLiteralLike(mode.initializer) && mode.initializer.text === 'durable' && handler) {
            const fn = ts.isMethodDeclaration(handler) ? handler : ts.isPropertyAssignment(handler)
              && (ts.isArrowFunction(handler.initializer) || ts.isFunctionExpression(handler.initializer)) ? handler.initializer : null;
            if (fn?.body && fn.parameters[0] && !fn.parameters[0].initializer) inspect(fn, fn.body, fn.parameters[0]);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  const inspect = (handler: ts.FunctionLikeDeclaration, body: ts.Node, parameter: ts.ParameterDeclaration) => {
    let root: string | null = null, prefix: string[] = [];
    if (ts.isIdentifier(parameter.name)) { root = parameter.name.text; prefix = [root, 'zero', 'torrent']; }
    else if (ts.isObjectBindingPattern(parameter.name)) {
      const zero = parameter.name.elements.find(item => !item.dotDotDotToken && !item.initializer && ts.isIdentifier(item.name)
        && (item.propertyName ? (ts.isIdentifier(item.propertyName) || ts.isStringLiteral(item.propertyName)) && item.propertyName.text === 'zero' : item.name.text === 'zero'));
      if (zero && ts.isIdentifier(zero.name)) { root = zero.name.text; prefix = [root, 'torrent']; }
    }
    if (!root || rebound(body, handler, root, prefix)) return;
    const walk = (node: ts.Node) => {
      // Uninvoked nested callbacks are not proof of work on this delivery lane.
      if (node !== body && ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) {
        const path = memberPath(node.expression);
        if (path && path.length === prefix.length + 1 && prefix.every((part, i) => path[i] === part)) {
          let parent: ts.Node = node.parent;
          while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) parent = parent.parent;
          const method = path.at(-1)!;
          if (ts.isAwaitExpression(parent) && ['start', 'deliverEvent'].includes(method)) {
            add(node, 'usage.background.eager_torrent_handoff', 'An awaited eager Torrent handoff can hold this sequential durable database-function lane through its initial activity.',
              'Review the matching installed enqueue/enqueueEvent API and await its commit receipt. Keep the same admitted actor/scope and logical identity. A queued handoff is not CPU isolation or proof of final completion.');
          } else if (['enqueue', 'enqueueEvent'].includes(method) && (ts.isVoidExpression(parent) || ts.isExpressionStatement(parent))) {
            add(node, 'usage.background.unacknowledged_torrent_enqueue', 'This durable handler discards its Torrent enqueue acknowledgment.',
              'Await or return the commit-acknowledged enqueue so the source delivery cannot succeed before the durable handoff. Preserve stable receipt identity; do not use a fresh retry key or convert actor work to SYSTEM.');
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(body);
  };
  visit(file); return findings;
}
function memberPath(expression: ts.Expression): string[] | null {
  const node = unwrapUpgradeExpression(expression);
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node) && !node.questionDotToken) {
    const base = memberPath(node.expression); return base ? [...base, node.name.text] : null;
  }
  if (ts.isElementAccessExpression(node) && !node.questionDotToken && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    const base = memberPath(node.expression); return base ? [...base, node.argumentExpression.text] : null;
  }
  return null;
}
function binds(name: ts.BindingName, text: string): boolean {
  return ts.isIdentifier(name) ? name.text === text : name.elements.some(item => ts.isBindingElement(item) && binds(item.name, text));
}
/** Conservatively skip rebound/locally shadowed roots instead of guessing runtime provenance. */
function rebound(body: ts.Node, handler: ts.FunctionLikeDeclaration, root: string, protectedPrefix: string[]): boolean {
  let changed = false;
  const visit = (node: ts.Node) => {
    if (changed) return;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name?.text === root) { changed = true; return; }
    if (node !== body && node !== handler && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node) && binds(node.name, root)) { changed = true; return; }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const path = memberPath(node.left);
      if (path && path.length <= protectedPrefix.length + 1 && path.every((part, i) => i >= protectedPrefix.length || protectedPrefix[i] === part)) { changed = true; return; }
    }
    ts.forEachChild(node, visit);
  };
  visit(body); return changed;
}
