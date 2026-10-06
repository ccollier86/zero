import { ThemeProvider, ThemeTogglerButton, SidebarProvider, SidebarTrigger, CodeBlockCopyButton } from '@zero/framework/react';
import { Compass } from '@zero/framework/icons';
import { useRef, type CSSProperties } from 'react';
import type { DocsPageProps } from './types';
import { DocsNavigation } from './docs-navigation';
import { DocsBreadcrumbs } from './docs-breadcrumbs';
import { DocsToc } from './docs-toc';
import { DocsSearch } from './docs-search';
import { DocsContent } from './docs-content';
import { DocsFooter } from './docs-footer';
import { serializeDocsProps } from './serialization';
import type { DocsNavigationEntry } from '../content/types';
import { docsNodeText } from '../content/markdown-text';
import { DocsNavigationScope } from './docs-navigation-scope';

/** A standalone public reader: no human session restoration or privileged application provider. */
export function DocsApp(props: DocsPageProps) {
  const { presentation, page } = props;
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const introduction = page.body.children?.find(node => node.type === 'paragraph');
  const separateDescription = page.description && page.description.trim() !== (introduction ? docsNodeText(introduction).replace(/\s+/gu, ' ').slice(0, 240).trim() : '');
  return <ThemeProvider nonce={props.nonce} storageKey={presentation.themeStorageKey}>
    <SidebarProvider className="zero-docs" style={{ '--sidebar-width': 'var(--zero-docs-navigation-width)' } as CSSProperties}>
      <DocsNavigationScope>
      <a className="zero-docs-skip" href="#zero-docs-content">Skip to content</a>
      <header className="zero-docs-header">
        <SidebarTrigger ref={navigationTrigger} className="zero-docs-mobile-nav-toggle" aria-label="Open documentation navigation" />
        <a className="zero-docs-brand" href={presentation.basePath}><Compass aria-hidden="true" /><span>{presentation.title}</span></a>
        <div className="zero-docs-header-search">{presentation.search && <DocsSearch presentation={presentation} />}</div>
        <nav className="zero-docs-header-links" aria-label="Site">{presentation.headerLinks.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}</nav>
        <ThemeTogglerButton modes={['light', 'dark', 'system']} variant="ghost" className="zero-docs-theme" />
      </header>
      <DocsNavigation navigation={props.navigation} page={page} presentation={presentation} onReturnFocus={() => navigationTrigger.current?.focus()} />
      <div className="zero-docs-body" data-toc={presentation.toc && page.headings.some(heading => heading.depth >= 2 && heading.depth <= 4)}>
        <main id="zero-docs-content" tabIndex={-1} className="zero-docs-main">
          <noscript><details className="zero-docs-nojs-navigation"><summary>Browse documentation</summary><nav aria-label="Documentation without JavaScript"><PlainNavigation entries={props.navigation} /></nav></details></noscript>
          {presentation.breadcrumbs && <DocsBreadcrumbs navigation={props.navigation} page={page} />}
          <div className="zero-docs-page-heading"><h1 id={page.titleHeadingId} data-docs-passage={page.body.children?.find(node => node.type === 'heading' && node.id === page.titleHeadingId)?.searchId}>{page.title}</h1>
            <CodeBlockCopyButton content={page.markdown} variant="icon" copyLabel="Copy page as Markdown" copiedLabel="Markdown copied" />
          </div>
          {separateDescription && <p className="zero-docs-description" data-docs-description>{page.description}</p>}
          <DocsContent page={page} highlights={props.highlights} basePath={presentation.basePath} />
          <DocsFooter presentation={presentation} previous={props.previous} next={props.next} />
        </main>
        {presentation.toc && <DocsToc headings={page.headings} />}
      </div>
      </DocsNavigationScope>
    </SidebarProvider>
    <script id="zero-docs-props" type="application/json" nonce={props.nonce} dangerouslySetInnerHTML={{ __html: serializeDocsProps(props) }} />
  </ThemeProvider>;
}

function PlainNavigation({ entries }: { readonly entries: readonly DocsNavigationEntry[] }) {
  return <ul>{entries.map(entry => <li key={entry.route}><a href={entry.route}>{entry.label}</a>{!!entry.children?.length && <PlainNavigation entries={entry.children} />}</li>)}</ul>;
}
