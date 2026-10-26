/** Escaped canonical inline text. No HTML parsing, HTML injection or remote URL lookup. */
import * as React from 'react';
import type { BlogInlineText } from '../../blog/content-types';
import { safeBlogHref } from './blog-utils';
import { BlogLink } from './blog-provider';

/** Render only the explicit formatting marks and a separately validated link target. */
export function BlogRichText({ content }: { content: readonly BlogInlineText[] }) {
  return <>{content.map((run, index) => {
    let node: React.ReactNode = run.text;
    if (run.code) node = <code>{node}</code>;
    if (run.bold) node = <strong>{node}</strong>;
    if (run.italic) node = <em>{node}</em>;
    if (run.underline) node = <u>{node}</u>;
    if (run.strike) node = <s>{node}</s>;
    const href = safeBlogHref(run.href);
    if (href) node = <BlogLink href={href}>{node}</BlogLink>;
    return <React.Fragment key={index}>{node}</React.Fragment>;
  })}</>;
}
