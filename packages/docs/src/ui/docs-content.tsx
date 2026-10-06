import { Fragment, createElement, useMemo, useRef, type ReactNode } from 'react';
import { CodeBlock, Button } from '@zero/framework/react';
import { Link } from '@zero/framework/icons';
import type { DocsNode } from '../content/types';
import type { DocsPageProps } from './types';
import { docsCodeOptions } from './code-options';
import { DocsCallout } from './docs-callout';
import { useDocsSearchLanding } from './use-docs-search-landing';

/** No MDX evaluation or authored HTML injection: only the compiler's admitted node vocabulary. */
export function DocsContent({ page, highlights, basePath = '/docs' }: Pick<DocsPageProps, 'page' | 'highlights'> & { readonly basePath?: string }) {
  const indices = useMemo(() => indexNodes(page.body), [page.body]);
  const root = useRef<HTMLDivElement>(null), landing = useDocsSearchLanding(root, basePath, page);
  function children(node: DocsNode): ReactNode {
    return node.children?.map((child, index) => <Fragment key={index}>{render(child)}</Fragment>);
  }
  function render(node: DocsNode): ReactNode {
    switch (node.type) {
      case 'root': return children(node);
      case 'text': return node.searchId ? <span data-docs-passage={node.searchId}>{node.value}</span> : node.value;
      case 'paragraph': return <p data-docs-passage={node.searchId}>{children(node)}</p>;
      case 'heading': {
        if (node.depth === 1 && node.id === page.titleHeadingId) return null;
        const level = Math.max(1, Math.min(6, node.depth ?? 2));
        return createElement(`h${level}`, { id: node.id, className: 'zero-docs-heading', 'data-docs-passage': node.searchId },
          children(node), <a className="zero-docs-heading-link" href={`#${encodeURIComponent(node.id ?? '')}`} aria-label={`Link to ${plainText(node)}`}><Link aria-hidden="true" /></a>);
      }
      case 'emphasis': return <em>{children(node)}</em>;
      case 'strong': return <strong>{children(node)}</strong>;
      case 'delete': return <del>{children(node)}</del>;
      // Inline prose is semantic phrasing content, not the copyable headerless block composition.
      case 'inlineCode': return <code className="zero-docs-inline-code">{node.value}</code>;
      case 'code': {
        const index = indices.code.get(node)!;
        return <div data-docs-passage={node.searchId}><CodeBlock {...docsCodeOptions(node, index)} highlighted={highlights[index] ?? undefined} /></div>;
      }
      case 'link': return <a href={node.url} title={node.title}>{children(node)}</a>;
      case 'image': return <img src={node.url} alt={node.alt ?? ''} title={node.title} loading="lazy" decoding="async" />;
      case 'blockquote': return <blockquote data-docs-passage={node.searchId}>{children(node)}</blockquote>;
      case 'list': return node.ordered ? <ol start={node.start}>{children(node)}</ol> : <ul>{children(node)}</ul>;
      case 'listItem': return <li data-docs-passage={node.searchId}>{node.checked !== null && node.checked !== undefined && <input type="checkbox" checked={node.checked} disabled aria-label={node.checked ? 'Completed item' : 'Incomplete item'} />}{children(node)}</li>;
      case 'thematicBreak': return <hr />;
      case 'break': return <br />;
      case 'callout': return <DocsCallout tone={node.tone} title={node.title} searchId={node.searchId}>{children(node)}</DocsCallout>;
      case 'table': {
        const rows = node.children ?? [];
        return <div className="zero-docs-table-scroll" tabIndex={0} role="region" aria-label="Documentation table"><table>
          <thead>{rows[0] && renderTableRow(rows[0], true, node.align)}</thead>
          <tbody>{rows.slice(1).map((row, index) => <Fragment key={index}>{renderTableRow(row, false, node.align)}</Fragment>)}</tbody>
        </table></div>;
      }
      case 'tableRow': return renderTableRow(node, false);
      case 'tableCell': return <td data-docs-passage={node.searchId}>{children(node)}</td>;
      case 'footnoteReference': {
        const reference = indices.references.get(node)!;
        return <sup id={reference.id}><a href={`#${encodeURIComponent(node.id ?? '')}`} aria-label={`Footnote ${reference.number}`}>{reference.number}</a></sup>;
      }
      case 'footnoteDefinition': return null;
    }
  }
  function renderTableRow(node: DocsNode, header: boolean, align?: DocsNode['align']) {
    return <tr data-docs-passage={node.searchId}>{node.children?.map((cell, index) => createElement(header ? 'th' : 'td', { key: index, scope: header ? 'col' : undefined, 'data-docs-passage': cell.searchId, style: { textAlign: align?.[index] ?? undefined } }, children(cell)))}</tr>;
  }
  return <><div className="zero-docs-search-landing" hidden={!landing.query} role="status">{landing.query && <><span>Showing matches for <strong>“{landing.query}”</strong></span><Button type="button" variant="ghost" size="sm" onClick={landing.clear}>Clear highlights</Button></>}</div>
    <div ref={root} className="zero-docs-prose">{render(page.body)}{indices.definitions.length > 0 &&
    <section className="zero-docs-footnotes" aria-label="Footnotes"><hr /><ol>{indices.definitions.map(node => <li key={node.id} id={node.id} data-docs-passage={node.searchId}>
      {children(node)}{indices.backlinks.get(node.id ?? '')?.map(reference => <a key={reference.id} href={`#${encodeURIComponent(reference.id)}`} aria-label={`Back to footnote ${reference.number}`}>↩</a>)}
    </li>)}</ol></section>}
  </div></>;
}

function plainText(node: DocsNode): string { return node.value ?? node.children?.map(plainText).join('') ?? ''; }
function indexNodes(root: DocsNode) {
  const code = new WeakMap<DocsNode, number>(), references = new WeakMap<DocsNode, { id: string; number: number }>();
  const backlinks = new Map<string, Array<{ id: string; number: number }>>(), numbers = new Map<string, number>(), definitions: DocsNode[] = [];
  let nextCode = 0;
  function visit(node: DocsNode) {
    if (node.type === 'code') code.set(node, nextCode++);
    if (node.type === 'footnoteDefinition') definitions.push(node);
    if (node.type === 'footnoteReference') {
      const key = node.id ?? ''; if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
      const entries = backlinks.get(key) ?? [], reference = { id: `${key}-ref-${entries.length + 1}`, number: numbers.get(key)! };
      entries.push(reference); backlinks.set(key, entries); references.set(node, reference);
    }
    node.children?.forEach(visit);
  }
  visit(root); definitions.sort((a, b) => (numbers.get(a.id ?? '') ?? Infinity) - (numbers.get(b.id ?? '') ?? Infinity));
  return { code, references, backlinks, definitions };
}
