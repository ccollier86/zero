/** Ordinary generated-route application composition; no alternate auth client or navigation callback. */
import type { ReactNode } from 'react';
import { AppProvider } from '@zero/framework/react/app-provider';
import { Link } from '@zero/framework/react';

export default function Layout({ children }: { children: ReactNode }) {
  return <AppProvider url={typeof window === 'undefined' ? '' : window.location.origin} tables={{ audit_items: { _pk: 'id', _sync: 'full', id: 'text', state: 'text', title: 'text' } }}><nav data-testid="persistent-audit-navigation"><Link href="/records">Records fixture</Link> · <Link href="/live-records">Live fixture</Link> · <Link href="/audit">Audit fixture</Link></nav>{children}</AppProvider>;
}
