/** Pure private-import syntax inventory and map comparison; never executes source, resolves modules or reads configuration. */
import * as ts from 'typescript';

/** Collect actual literal import/re-export/type-import/import-equals and direct dynamic import/require targets. */
export function collectPrivateImportSpecifiers(filename: string, source: string): readonly string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false,
    /\.tsx$/u.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers = new Set<string>();
  const pending: ts.Node[] = [file];
  const include = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node) && node.text.startsWith('#zero/')) specifiers.add(node.text);
  };
  while (pending.length) {
    const node = pending.pop()!;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) include(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) include(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) include(node.argument.literal);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) include(node.arguments[0]);
    ts.forEachChild(node, child => { pending.push(child); });
  }
  return [...specifiers].sort();
}

/** Compare every exact own mapping without treating object-key presentation order as a stale alias. */
export function privateImportMapsMatch(declared: Readonly<Record<string, string>>, expected: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(declared);
  return keys.length === Object.keys(expected).length
    && keys.every(key => Object.hasOwn(expected, key) && declared[key] === expected[key]);
}
