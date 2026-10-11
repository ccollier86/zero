/** YAML AST admission and edits preserve comments, scalar styles and anchors. No unsafe tags, execution or serialization fallback. */
import { Document, Scalar, isAlias, isMap, isScalar, isSeq, parseAllDocuments, type Node } from 'yaml';
import { cloneJsonDocument, diffJsonDocument, equalJsonDocument, JSON_DOCUMENT_LIMITS, jsonPointer } from './json-document-model';
import { DocumentSourceError, pointerPath, sourceComment, type SourceDocument } from './document-source-contract';
import type { JsonDocumentPath, JsonDocumentValue } from './json-document.types';
import { losesDocumentNumberPrecision } from './document-number-precision';

export function readYamlDocument(text: string): SourceDocument {
  // Mapping keys are strings in this facade. A linear Set check below rejects
  // duplicates without the parser's per-key scan becoming quadratic on wide maps.
  const documents = parseAllDocuments(text, { prettyErrors: false, strict: true, uniqueKeys: false, version: '1.2' });
  if (documents.length > 1) throw new DocumentSourceError('Edit one YAML document at a time.', documents[1]?.range?.[0] ?? 0);
  const document = documents[0] ?? new Document(null);
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem) throw new DocumentSourceError(problem.message, problem.pos[0], Math.max(1, problem.pos[1] - problem.pos[0]));
  let count = 0; const comments = new Map<string, string>(), native = new Map<string, string>();
  function walk(node: unknown, path: JsonDocumentPath, depth: number) {
    if (++count > JSON_DOCUMENT_LIMITS.nodes || depth > JSON_DOCUMENT_LIMITS.depth) throw new DocumentSourceError('YAML document exceeds the supported structural limit.');
    if (!node || typeof node !== 'object') return;
    const item = node as Node;
    sourceComment(comments, path, [item.comment, item.commentBefore].filter(Boolean).join('\n'));
    if (isAlias(node)) { native.set(jsonPointer(path), 'YAML alias'); return; }
    if (isScalar(node) && typeof node.value === 'number' && node.source) {
      const decimal = node.source.replace(/^\+/u, '').replace(/^(-?)\./u, (_match, sign: string) => `${sign}0.`).replace(/\.(?=[eE]|$)/u, '.0');
      const exact = /^0[ox]/u.test(node.source) ? Number.isSafeInteger(node.value) : !losesDocumentNumberPrecision(decimal, node.value);
      if (!exact) native.set('', 'Exact YAML numbers · use Code');
    }
    if (isMap(node)) {
      const keys = new Set<string>();
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new DocumentSourceError('YAML mapping keys must be strings for this document editor.', isScalar(pair.key) ? pair.key.range?.[0] : 0);
        const key = pair.key.value;
        if (keys.has(key)) throw new DocumentSourceError('Duplicate YAML mapping key.', pair.key.range?.[0]);
        keys.add(key); walk(pair.value, [...path, key], depth + 1);
        if (pair.key.commentBefore || pair.key.comment) sourceComment(comments, [...path, key], [pair.key.comment, comments.get(jsonPointer([...path, key])), pair.key.commentBefore].filter(Boolean).join('\n'));
      }
    } else if (isSeq(node)) node.items.forEach((child, index) => walk(child, [...path, index], depth + 1));
  }
  walk(document.contents, [], 0); sourceComment(comments, [], [document.commentBefore, comments.get('')].filter(Boolean).join('\n'));
  let value: JsonDocumentValue;
  try { value = cloneJsonDocument(document.toJS({ maxAliasCount: 50, mapAsMap: false })); }
  catch { throw new DocumentSourceError('YAML must contain bounded, finite JSON-compatible values; cyclic or excessive aliases are not editable.'); }
  return { format: 'yaml', text, value, comments, native, model: document };
}

/** Patch a cloned AST, then reparse and prove the projection still matches; never stringify away failed preservation. */
export function writeYamlDocument(value: JsonDocumentValue, previous?: SourceDocument) {
  if (!previous) return new Document(value).toString({ indent: 2 });
  const document = (previous.model as Document).clone();
  const at = (path: JsonDocumentPath) => path.length ? document.getIn([...path], true) : document.contents;
  const operations = diffJsonDocument(previous.value, value);
  if (operations.length > 1_000) throw new DocumentSourceError('Apply this bulk YAML rewrite in Code; the source-preserving tree edit limit was reached.');
  for (const operation of operations) {
    const path = pointerPath(operation.path, value), parentPath = path.slice(0, -1), key = path.at(-1);
    if (operation.op === 'move') {
      const from = pointerPath(operation.from, previous.value), parent = at(from.slice(0, -1));
      if (!isMap(parent) || jsonPointer(from.slice(0, -1)) !== jsonPointer(parentPath)) throw new DocumentSourceError('Rename this YAML structure in Code to preserve its anchors.');
      const pair = parent.items.find(pair => isScalar(pair.key) && pair.key.value === from.at(-1));
      if (!pair || !isScalar(pair.key)) throw new DocumentSourceError('The YAML key no longer exists.');
      pair.key.value = String(key); pair.key.type = Scalar.PLAIN; continue;
    }
    if (operation.op === 'remove') { document.deleteIn([...pointerPath(operation.path, previous.value)]); continue; }
    const old = at(path);
    if (isAlias(old)) throw new DocumentSourceError('Edit this alias or its anchor in Code; tree edits will not detach YAML aliases.');
    if (isScalar(old) && (operation.value === null || typeof operation.value !== 'object')) {
      if (typeof old.value !== typeof operation.value) { old.type = undefined; old.format = undefined; }
      old.value = operation.value;
    } else {
      const replacement = document.createNode(operation.value);
      if (old && typeof old === 'object') {
        replacement.commentBefore = (old as Node).commentBefore; replacement.comment = (old as Node).comment;
        if ('anchor' in old && old.anchor) (replacement as Scalar).anchor = old.anchor as string;
      }
      if (!path.length) document.contents = replacement;
      else document.setIn([...path], replacement);
    }
  }
  const indent = /\n( {2,8})\S/u.exec(previous.text)?.[1]?.length ?? 2;
  const text = document.toString({ indent }), admitted = readYamlDocument(text);
  if (!equalJsonDocument(value, admitted.value)) throw new DocumentSourceError('This edit changes a shared YAML anchor. Edit the anchor and its aliases together in Code.');
  return text;
}
