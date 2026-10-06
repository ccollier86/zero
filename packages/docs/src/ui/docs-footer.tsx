import { ArrowLeft, ArrowRight, ExternalLink } from '@zero/framework/icons';
import type { DocsPageProps } from './types';

export function DocsFooter({ previous, next, presentation }: Pick<DocsPageProps, 'previous' | 'next' | 'presentation'>) {
  return <footer className="zero-docs-footer">
    {presentation.pageNavigation && (previous || next) && <nav className="zero-docs-page-navigation" aria-label="Previous and next pages">
      <div>{previous && <a href={previous.route} rel="prev"><small><ArrowLeft aria-hidden="true" />Previous page</small><span>{previous.title}</span></a>}</div>
      <div>{next && <a href={next.route} rel="next"><small>Next page<ArrowRight aria-hidden="true" /></small><span>{next.title}</span></a>}</div>
    </nav>}
    <div className="zero-docs-footer-meta">
      {presentation.editUrl && <a href={presentation.editUrl}><ExternalLink aria-hidden="true" />Edit this page</a>}
      <span>{presentation.title}</span>
    </div>
  </footer>;
}
