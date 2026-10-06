import { Fragment } from 'react';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@zero/framework/react';
import type { DocsPageProps } from './types';
import { findDocsNavigationPath } from './docs-navigation';

export function DocsBreadcrumbs({ navigation, page }: Pick<DocsPageProps, 'navigation' | 'page'>) {
  const path = findDocsNavigationPath(navigation, page.route);
  return <Breadcrumb className="zero-docs-breadcrumbs"><BreadcrumbList>{path.map((entry, index) => <Fragment key={entry.route}>
    {index > 0 && <BreadcrumbSeparator />}<BreadcrumbItem>{index === path.length - 1 ? <BreadcrumbPage>{page.title}</BreadcrumbPage> : <BreadcrumbLink href={entry.route}>{entry.label}</BreadcrumbLink>}</BreadcrumbItem>
  </Fragment>)}</BreadcrumbList></Breadcrumb>;
}
