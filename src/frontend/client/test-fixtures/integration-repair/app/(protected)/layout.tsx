'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AppShell } from '@zero/framework/components/app-shell';
import { Link, usePathname } from '@zero/framework/react';

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname(), [identity, setIdentity] = useState('');
  useEffect(() => { setIdentity(crypto.randomUUID()); }, []);
  // The baseline package ignores the additive adapter, reproducing native navigation.
  const navigation = { linkComponent: Link };
  return <div data-testid="persistent-shell" data-identity={identity}>
    <AppShell {...navigation} brand={{ name: 'Synthetic Zero', href: '/workspace' }}
      user={{ name: 'Synthetic owner', accountHref: '/account' }}
      nav={[{ label: 'Workspace', items: [
        { label: 'Overview', href: '/workspace' }, { label: 'Account', href: '/account' }, { label: 'Audit', href: '/audit' },
      ] }]} currentPath={pathname} header={{ themeToggle: false }}
      breadcrumbs={[{ label: 'Home', href: '/workspace' }, { label: pathname.slice(1) }]}>
      {children}
    </AppShell>
  </div>;
}
