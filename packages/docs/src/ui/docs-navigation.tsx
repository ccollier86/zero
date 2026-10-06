import { Collapsible, CollapsibleContent, CollapsibleTrigger, Sidebar, SidebarContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, Button, useSidebar } from '@zero/framework/react';
import { ChevronDown, Layers, X } from '@zero/framework/icons';
import type { DocsNavigationEntry } from '../content/types';
import type { DocsPageProps } from './types';
import { useRef, type MouseEvent } from 'react';
import { useDocsMotionDuration } from './use-docs-motion';
import { isDocsCurrentWindowNavigation } from './docs-navigation-intent';
import { useDocsNavigationLifecycle } from './docs-navigation-scope';

export function DocsNavigation({ navigation, page, presentation, onReturnFocus }: Pick<DocsPageProps, 'navigation' | 'page' | 'presentation'> & { readonly onReturnFocus?: () => void }) {
  const { setOpenMobile } = useSidebar();
  const duration = useDocsMotionDuration();
  const navigating = useRef(false);
  const lifecycle = useDocsNavigationLifecycle();
  const onNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isDocsCurrentWindowNavigation(event)) return;
    navigating.current = true;
    setOpenMobile(false);
  };
  return <Sidebar className="zero-docs-sidebar" animateOnHover={false} mobileTransition={{ duration, ease: 'easeOut' }} mobileOverlayTransition={{ duration }} onMobileCloseAutoFocus={event => {
    if (lifecycle?.release(event)) return;
    if (navigating.current) { navigating.current = false; return; }
    if (onReturnFocus) { event.preventDefault(); onReturnFocus(); }
  }}>
    <div className="zero-docs-mobile-nav-heading"><span>Documentation</span><Button type="button" variant="ghost" size="icon" onClick={() => setOpenMobile(false)} aria-label="Close documentation navigation"><X aria-hidden="true" /></Button></div>
    <SidebarContent className="zero-docs-nav-scroll"><nav aria-label="Documentation">
      <SidebarMenu className="zero-docs-nav-root">{navigation.map(entry => <Entry key={entry.route} entry={entry} current={page.route} duration={duration} onNavigate={onNavigate} />)}</SidebarMenu>
      {presentation.headerLinks.length > 0 && <nav className="zero-docs-nav-site-links" aria-label="Site links">{presentation.headerLinks.map(link => <a key={link.href} href={link.href} onClick={onNavigate}>{link.label}</a>)}</nav>}
    </nav></SidebarContent>
  </Sidebar>;
}
function Entry({ entry, current, duration, onNavigate }: { readonly entry: DocsNavigationEntry; readonly current: string; readonly duration: number; readonly onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const active = entry.route === current;
  if (entry.type === 'page') return <SidebarMenuItem>
    <SidebarMenuButton asChild isActive={active} className="zero-docs-nav-link"><a href={entry.route} aria-current={active ? 'page' : undefined} onClick={onNavigate}><span>{entry.label}</span></a></SidebarMenuButton>
  </SidebarMenuItem>;
  return <SidebarMenuItem><Collapsible defaultOpen className="zero-docs-nav-group">
    <div className="zero-docs-nav-group-row"><a href={entry.route} onClick={onNavigate} aria-current={active ? 'page' : undefined} className="zero-docs-nav-group-link">
      <span className="zero-docs-nav-group-icon"><Layers aria-hidden="true" /></span><span>{entry.label}</span>
    </a>{!!entry.children?.length && <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="icon" className="zero-docs-nav-disclosure" aria-label={`Expand or collapse ${entry.label}`}><ChevronDown aria-hidden="true" /></Button></CollapsibleTrigger>}</div>
    {!!entry.children?.length && <CollapsibleContent initial={false} transition={{ duration, ease: 'easeOut' }}>
      <SidebarMenu className="zero-docs-nav-children">{entry.children.map(child => <Entry key={child.route} entry={child} current={current} duration={duration} onNavigate={onNavigate} />)}</SidebarMenu>
    </CollapsibleContent>}
  </Collapsible></SidebarMenuItem>;
}

/** Navigation, breadcrumbs and sequential page links share authored navigation order. */
export function findDocsNavigationPath(entries: readonly DocsNavigationEntry[], route: string): readonly DocsNavigationEntry[] {
  for (const entry of entries) {
    if (entry.route === route) return [entry];
    const children = findDocsNavigationPath(entry.children ?? [], route);
    if (children.length) return [entry, ...children];
  }
  return [];
}
