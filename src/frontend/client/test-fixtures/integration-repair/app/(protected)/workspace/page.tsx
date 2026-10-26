'use client';
import { useAuth, Link } from '@zero/framework/react';

export const config = { auth: 'admin' };
export const meta = { title: 'Synthetic overview' };
export default function Workspace() {
  const auth = useAuth();
  return <section data-testid="protected-overview">
    <h1>Synthetic overview</h1>
    <Link href="/account">Open profile with Zero Link</Link>
    <button type="button" onClick={() => { void auth.logout(); }}>Sign out fixture</button>
  </section>;
}
