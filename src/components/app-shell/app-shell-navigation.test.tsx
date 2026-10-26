/** Additive link composition never requires a router for standalone shells. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from './app-shell';
import { AppShellAnchor } from './app-shell-utils';
import type { AppShellLinkProps } from './app-shell.types';

test('one shell adapter covers brand, sidebar, nested links, breadcrumbs and nested custom content', () => {
  const destinations: string[] = [];
  function Adapter(props: AppShellLinkProps) { destinations.push(props.href); return <a {...props} data-fixture-adapter="true" />; }
  const html = renderToStaticMarkup(<AppShell linkComponent={Adapter} brand={{ name: 'Fixture', href: '/home' }}
    header={{ themeToggle: false }} currentPath="/nested/child"
    breadcrumbs={[{ label: 'Home', href: '/home' }, { label: 'Child' }]}
    nav={[{ items: [{ label: 'First', href: '/first' }, { label: 'Nested', defaultOpen: true,
      children: [{ label: 'Child', href: '/nested/child' }] }] }]}>
    <AppShellAnchor href="/custom" target="_blank" rel="noopener" download="fixture.txt">Custom</AppShellAnchor>
    <AppShell preset="minimal"><AppShellAnchor href="/native">Nested native shell</AppShellAnchor></AppShell>
  </AppShell>);
  expect(destinations).toEqual(['/home', '/first', '/nested/child', '/home', '/custom']);
  expect(html).toContain('target="_blank"'); expect(html).toContain('download="fixture.txt"');
  expect(html).toContain('href="/native"');
  expect(html.match(/data-fixture-adapter="true"/g)).toHaveLength(5);
});

test('native fallback keeps link attributes, disabled state and real action buttons', () => {
  const html = renderToStaticMarkup(<>
    <AppShellAnchor href="/disabled" disabled>Unavailable</AppShellAnchor>
    <AppShellAnchor disabled>Disabled action</AppShellAnchor>
    <AppShellAnchor>Action</AppShellAnchor>
  </>);
  expect(html).toContain('<a href="/disabled" aria-disabled="true" tabindex="-1">');
  expect(html.match(/<button/g)).toHaveLength(2); expect(html).toContain('disabled=""');
});
