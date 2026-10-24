/** Synthetic UI proof. No production accounts, services or delivery. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Mail, LayoutDashboard, Users, Settings } from 'lucide-react';
import { AppShell } from '../app-shell';
import { Button } from '../ui/button';
import { EmailInbox } from './email-inbox';
import { createEmailInboxFixture } from './email-inbox.test-support';

const fixture = createEmailInboxFixture();
Object.assign(window, { __emailInboxFixture: fixture });
function Demo() {
  const [scope, setScope] = React.useState('synthetic-owner'), [dark, setDark] = React.useState(false);
  React.useEffect(() => { document.documentElement.setAttribute('data-zero-theme', 'next'); document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return <AppShell brand={{ name: 'Northstar', subtitle: 'Studio workspace' }} nav={[{ label: 'Workspace', items: [
    { label: 'Overview', href: '/overview', icon: LayoutDashboard }, { label: 'Inbox', href: '/', icon: Mail }, { label: 'People', href: '/people', icon: Users },
    { label: 'Settings', href: '/settings', icon: Settings } ] }]} header={{ title: 'Inbox' }} contentMode="workspace">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"><div className="flex shrink-0 items-center gap-2"><span className="mr-auto text-[11px] text-muted-foreground">Synthetic email workspace preview</span>
      <Button type="button" size="xs" variant="outline" onClick={() => fixture.arrive()}>Incoming mail</Button><Button type="button" size="xs" variant="outline" onClick={() => setDark(!dark)}>Toggle theme</Button><Button type="button" size="xs" variant="outline" onClick={() => setScope(scope === 'synthetic-owner' ? 'other-owner' : 'synthetic-owner')}>Change scope</Button></div>
      <EmailInbox source={fixture.source} scopeKey={scope} />
    </div>
  </AppShell>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Demo /></React.StrictMode>);
