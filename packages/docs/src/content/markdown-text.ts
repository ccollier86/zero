/** Visible plain-text projection of admitted AST, preserving block/cell but not inline boundaries. */
import type { DocsNode } from './types';

const BLOCKS = new Set(['root', 'list', 'listItem', 'table', 'blockquote', 'footnoteDefinition', 'callout']);

/** Shared plain-text projection from already admitted AST; never rescans source files. */
export function docsNodeText(node: DocsNode): string {
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break' || node.type === 'thematicBreak') return '\n';
  if (node.type === 'code') return [node.code?.title, node.value].filter(value => value !== undefined && value !== '').join('\n');
  if (node.value !== undefined) return node.value;
  const separator = node.type === 'tableRow' ? ' ' : BLOCKS.has(node.type) ? '\n' : '';
  const content = (node.children ?? []).map(docsNodeText).join(separator);
  return node.type === 'callout' ? (node.title ?? node.tone ?? 'note') + (content ? '\n' + content : '') : content;
}
