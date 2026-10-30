/** Narrow source-only capture checks. Findings never certify coverage or infer semantics from arbitrary application code. */
import ts from 'typescript';
import type { SourceOnlyFile } from './source-only-types';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
export function checkSourceOnlyLogging(input: SourceOnlyFile): PlatformDoctorFinding[] {
  const file = ts.createSourceFile(input.path, input.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), views = new Set<string>(), tables = new Set<string>();
  if ((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) return [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !(statement.moduleSpecifier.text === '@zero/framework' || statement.moduleSpecifier.text.startsWith('@zero/framework/')) || statement.importClause?.isTypeOnly) continue;
    const imports = statement.importClause?.namedBindings;
    if (imports && ts.isNamedImports(imports)) for (const item of imports.elements) {
      if (item.isTypeOnly) continue;
      const imported = item.propertyName?.text ?? item.name.text;
      if (imported === 'useLoggingView') views.add(item.name.text);
      if (['DataTable', 'DataTableView', 'MasterDetailPage'].includes(imported)) tables.add(item.name.text);
    }
  }
  const findings: PlatformDoctorFinding[] = [];
  const add = (node: ts.Node, code: string, message: string, hint: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ code, path: `${input.path}:${line}`, line, severity: 'info', category: 'manual-review', confidence: 'high', message, hint, docs: './docs-next/backend/logging/events-and-coverage.md' });
  };
  const property = (object: ts.ObjectLiteralExpression, name: string) => object.properties.find(item => (ts.isPropertyAssignment(item) || ts.isMethodDeclaration(item) || ts.isShorthandPropertyAssignment(item)) && item.name && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name);
  const unshadowed = (name: string, node: ts.Node) => {
    for (let parent = node.parent; parent && parent !== file; parent = parent.parent) {
      if (ts.isFunctionLike(parent) && parent.parameters.some(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === name)) return false;
      if (ts.isBlock(parent) && parent.statements.some(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name))) return false;
    }
    return true;
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && views.has(node.expression.text) && unshadowed(node.expression.text, node)) {
      const target = node.arguments[0];
      if (target && ts.isObjectLiteralExpression(target)) add(node, 'usage.logging.identity_only_view', 'This browser view records an identity without an authorized historical result receipt.',
        'Keep this deliberately weaker binding when appropriate. For inspectable record/list results, use the intended package’s prepareResult and useLoggingResultView/useLoggingRows APIs. Do not requery current rows as historical evidence.');
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && tables.has(node.tagName.text) && unshadowed(node.tagName.text, node)) {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'source');
      const source = attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
      if (source && ts.isObjectLiteralExpression(source)) {
        const adapter = property(source, 'adapter');
        if (adapter && ts.isPropertyAssignment(adapter) && ts.isObjectLiteralExpression(adapter.initializer)) {
          const query = property(adapter.initializer, 'query');
          const body = query && ts.isMethodDeclaration(query) ? query.body : query && ts.isPropertyAssignment(query) && (ts.isArrowFunction(query.initializer) || ts.isFunctionExpression(query.initializer)) ? query.initializer.body : undefined;
          const result = body && ts.isBlock(body) ? body.statements.find(ts.isReturnStatement)?.expression : body;
          const object = result && ts.isParenthesizedExpression(result) ? result.expression : result;
          if (object && ts.isObjectLiteralExpression(object) && property(object, 'rows') && !property(object, 'auditReceipt') && !object.properties.some(ts.isSpreadAssignment))
            add(object, 'usage.logging.custom_result_receipt', 'This literal custom server-table result does not carry an audit receipt.',
              'If record/list auditing is enabled, prepare the already-authorized custom result through zero.logging.prepareResult and return its auditReceipt beside rows/page. Native table reads are wired automatically. This is a review finding, not proof that arbitrary helper code lacks capture.');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file); return findings;
}
