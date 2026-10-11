/** Syntax decorations from admitted parser ranges, keeping hashes/keys inside literal strings out of comment paint. No HTML or mutation. */
import { isAlias, isMap, isScalar, isSeq, type Document } from 'yaml';
import type { AST } from 'toml-eslint-parser';
import type { SourceDocument } from './document-source-contract';

export interface SourceDecoration { readonly start: number; readonly end: number; readonly kind: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'comment' | 'anchor' }
export function documentSourceRanges(document: SourceDocument): SourceDecoration[] {
  const result: SourceDecoration[] = [];
  if (document.format === 'yaml') {
    const walk = (node: unknown, key = false) => {
      if (isMap(node)) node.items.forEach(pair => { walk(pair.key, true); walk(pair.value); });
      else if (isSeq(node)) node.items.forEach(item => walk(item));
      else if ((isAlias(node) || isScalar(node)) && node.range) {
        let [start, end] = node.range;
        const kind = key ? 'key' : isAlias(node) ? 'anchor' : node.value === null ? 'null' : typeof node.value === 'boolean' ? 'boolean' : typeof node.value === 'number' ? 'number' : 'string';
        // A block's indicator/header stays in the punctuation/comment scanner;
        // its actual content is one literal, including hashes and colons.
        if (isScalar(node) && (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED')) {
          const newline = document.text.indexOf('\n', start); start = newline < 0 ? end : newline + 1;
        }
        if (end > start) result.push({ start, end, kind });
      }
    };
    walk((document.model as Document).contents);
  } else if (document.format === 'toml') {
    const model = document.model as { ast: AST.TOMLProgram; pairs: ReadonlyMap<string, AST.TOMLKeyValue>; tables: ReadonlyMap<string, AST.TOMLTable> };
    const keys = [...model.pairs.values(), ...model.tables.values()].map(item => item.key.range).sort((a, b) => a[0] - b[0]);
    for (const token of model.ast.tokens) {
      let low = 0, high = keys.length;
      while (low < high) { const mid = (low + high) >>> 1; if (keys[mid]![0] <= token.range[0]) low = mid + 1; else high = mid; }
      const key = low > 0 && keys[low - 1]![1] >= token.range[1];
      const kind = token.type === 'Punctuator' ? 'punctuation' : key ? 'key' : token.type === 'Integer' || token.type === 'Float' ? 'number' : token.type === 'Boolean' ? 'boolean' : 'string';
      result.push({ start: token.range[0], end: token.range[1], kind });
    }
    result.push(...model.ast.comments.map(comment => ({ start: comment.range[0], end: comment.range[1], kind: 'comment' as const })));
  } else if (document.format === 'env') {
    const lines = document.model as readonly { keyStart: number; keyEnd: number; valueStart: number; valueEnd: number }[];
    for (const line of lines) {
      result.push({ start: line.keyStart, end: line.keyEnd, kind: 'key' });
      if (line.valueEnd > line.valueStart) result.push({ start: line.valueStart, end: line.valueEnd, kind: 'string' });
    }
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}
