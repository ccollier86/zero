/** Pure format-aware textarea operations. No DOM mutation or parsing authority; the session must admit the resulting source. */
import type { DocumentFormat } from './document.types';

export interface SourceInputEdit { readonly start: number; readonly end: number; readonly text: string; readonly anchor: number; readonly focus: number }
export function sourceInputEdit(source: string, start: number, end: number, key: string, shift: boolean, format: DocumentFormat): SourceInputEdit | null {
  const lineStart = source.slice(0, start).lastIndexOf('\n') + 1, before = source.slice(lineStart, start), indent = /^[ \t]*/u.exec(before)?.[0] ?? '';
  const previous = source[start - 1], next = source[end], pairs: Record<string, string> = { '{': '}', '[': ']', '"': '"' };
  const edit = (text: string, a = start, b = end, anchor = a + text.length, focus = anchor): SourceInputEdit => ({ start: a, end: b, text, anchor, focus });
  if (key === 'Tab') {
    if (!shift && !source.slice(start, end).includes('\n')) return edit('  ');
    const lineEnd = source.indexOf('\n', Math.max(start, end - (end > start && source[end - 1] === '\n' ? 1 : 0))), last = lineEnd < 0 ? source.length : lineEnd;
    const lines = source.slice(lineStart, last).split('\n'), out = lines.map(line => shift ? line.replace(/^ {1,2}/u, '') : '  ' + line).join('\n');
    const delta = shift ? -(lines[0]!.length - lines[0]!.replace(/^ {1,2}/u, '').length) : 2;
    return edit(out, lineStart, last, start === end ? Math.max(lineStart, start + delta) : lineStart, start === end ? Math.max(lineStart, start + delta) : lineStart + out.length);
  }
  if (key === 'Enter' && !shift) {
    if (format === 'yaml' && start === end) {
      const lead = /^( *)((?:-[ \t]+)*)/u.exec(before)!, base = lead[1]!.length + lead[2]!.length;
      const body = before.slice(base).replace(/\s+#.*$/u, '').trimEnd();
      if (lead[2] && !body) return edit(' '.repeat(Math.max(0, lead[1]!.length - 2)), lineStart, start);
      const opens = /:$/u.test(body) || /:\s+[|>][-+0-9]*$/u.test(body) || /^[|>][-+0-9]*$/u.test(body);
      const nextIndent = opens ? ' '.repeat(base + 2) : lead[2] && !/^[^#]*?:(\s|$)/u.test(body) && body ? lead[1] + '- ' : ' '.repeat(base);
      return edit('\n' + nextIndent);
    }
    if (format !== 'env' && (previous === '{' || previous === '[')) {
      const inner = indent + '  ';
      return previous && pairs[previous] === next && start === end ? edit('\n' + inner + '\n' + indent, start, end, start + 1 + inner.length) : edit('\n' + inner);
    }
    return edit('\n' + indent);
  }
  if (format !== 'env' && (key === '{' || key === '[')) {
    if (start !== end) return edit(key + source.slice(start, end) + pairs[key], start, end, start + 1, end + 1);
    return !next || /[\s}\],:]/u.test(next) ? edit(key + pairs[key], start, end, start + 1) : edit(key);
  }
  if (key === '"') {
    if (start === end && next === key && previous !== '\\') return edit('', start, end, start + 1);
    if (start !== end) return edit('"' + source.slice(start, end) + '"', start, end, start + 1, end + 1);
    return previous === '\\' || /[\w]/u.test(previous ?? '') || next && !/[\s}\],:=]/u.test(next) ? edit('"') : edit('""', start, end, start + 1);
  }
  if (format !== 'env' && (key === '}' || key === ']') && start === end && next === key) return edit('', start, end, start + 1);
  if (key === 'Backspace' && start === end) {
    if (start > lineStart && /^ +$/u.test(before)) return edit('', start - ((start - lineStart) % 2 || 2), start);
    if (previous && pairs[previous] === next) return edit('', start - 1, start + 1);
  }
  return null;
}
