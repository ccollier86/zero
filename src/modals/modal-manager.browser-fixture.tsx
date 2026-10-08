import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Settings, User, Bell } from 'lucide-react';
import { ModalManager } from './modal-manager';
import { modals } from './modal-events';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectTrigger, SelectValue, SelectItem } from '../components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '../components/animate-ui/components/radix/popover';
import { DenseList, DenseListItem, DenseListChoice } from '../components/dense-list';
import { CommandDialog, CommandInput, CommandList, CommandItem } from '../components/ui/command';
import { PasswordInput } from '../components/auth/password-input';
import { SecretField } from '../components/secret-field';
import type { ModalContext } from './modal-system.types';

function SiblingDemo() {
  const [first, setFirst] = React.useState(true);
  const [outcome, setOutcome] = React.useState('idle');
  const mounts = React.useRef(0);
  function TrackedBody() {
    React.useEffect(() => { mounts.current += 1; document.querySelector('[data-testid="mounts"]')!.textContent = String(mounts.current); }, []);
    return <Input aria-label="Sibling draft" />;
  }
  return <>
    {first && <ModalManager><Button onClick={() => {
      const handle = modals.show({ title: 'First owner', body: <TrackedBody /> });
      void handle.result.then(result => setOutcome(result.kind));
    }}>Open first owner</Button></ModalManager>}
    <ModalManager><Button onClick={() => modals.show({ title: 'Next owner', body: 'Fresh owned body' })}>Open next owner</Button></ModalManager>
    <Button data-testid="retire-first-host" onClick={() => setFirst(false)}>Retire first host</Button>
    <output data-testid="sibling-outcome">{outcome}</output><output data-testid="mounts">0</output>
  </>;
}

function Fields({ context }: { context: ModalContext }) {
  const [commandOpen, setCommandOpen] = React.useState(false);
  return <form id={`fields-${context.id}`} onChange={() => context.setDirty(true)}>
    <label htmlFor={`name-${context.id}`}>Name</label><Input id={`name-${context.id}`} required />
    <Select defaultValue="member"><SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select>
    <Popover><PopoverTrigger asChild><Button type="button">Open picker</Button></PopoverTrigger>
      <PopoverContent><label>Picker search<Input aria-label="Picker search" /></label><Button type="button">Picker action</Button></PopoverContent></Popover>
    <Button type="button" onClick={event => context.show({ title: 'Child picker', trigger: event.currentTarget,
      body: child => <DenseList><DenseListChoice title="Task created" description="A new task arrives" onChoose={() => child.accept('created')} /></DenseList>,
      actions: [{ id: 'back', role: 'cancel', label: 'Back' }] })}>Open child</Button>
    <Button type="button" onClick={() => setCommandOpen(true)}>Open commands</Button>
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title="Scoped commands">
      <CommandInput placeholder="Search synthetic commands" /><CommandList><CommandItem>Fixture command</CommandItem></CommandList>
    </CommandDialog>
  </form>;
}

function Demo() {
  const [outcome, setOutcome] = React.useState('idle'), [saves, setSaves] = React.useState(0);
  const accept = async () => { setSaves(value => value + 1); return 'saved'; };
  const show = (kind: string, trigger?: Element) => {
    const common = { title: kind === 'tabs' ? 'Project settings' : kind === 'nav' ? 'Preferences' : 'Invite teammate',
      icon: <Settings />, meta: 'Acme workspace', description: 'Standardized header, body and footer.',
      trigger, actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel' as const },
        { id: 'save', label: 'Save changes', variant: 'primary' as const, submit: true, onClick: accept }] };
    const handle = kind === 'tabs' || kind === 'nav' ? modals.show({ ...common,
      size: kind === 'nav' ? 'xl' : 'lg', layout: kind,
      sections: [{ id: 'general', group: 'Account', label: 'General', icon: <User />, body: context => <Fields context={context} /> },
        { id: 'members', group: 'Workspace', label: 'Members', badge: 12, body: <DenseList>{Array.from({length:35}, (_,i) =>
          <DenseListItem key={i} title={`Member ${i + 1}`} description="People who can access this workspace." trailing={<Button size="sm">Manage</Button>} />)}</DenseList> },
        { id: 'notifications', group: 'Workspace', label: 'Notifications', icon: <Bell />, body: <DenseList><DenseListItem title="Mentions" description="When someone tags you" trailing={<input type="checkbox" aria-label="Mentions" />} /></DenseList> }] })
      : modals.show({ ...common, body: context => <Fields context={context} /> });
    void handle.result.then(result => setOutcome(result.kind));
  };
  return <ModalManager><main className="p-8 space-y-4"><h1>Modal system</h1>
    <div className="flex flex-wrap gap-2">{['content','tabs','nav'].map(kind => <Button key={kind} onClick={event => show(kind,event.currentTarget)}>Open {kind}</Button>)}
      <Button onClick={() => show('content')}>Programmatic</Button>
      <Button onClick={() => { void modals.confirm({ title: 'Delete project?', description: 'This is a synthetic decision.',
        confirmLabel: 'Delete', variant: 'destructive' }).then(value => setOutcome(value ? 'yes' : 'no')); }}>Destructive decision</Button>
      <Button onClick={() => document.documentElement.classList.toggle('dark')}>Toggle theme</Button>
      <Button onClick={event => modals.show({ title: 'Required review', trigger: event.currentTarget, dismissible: false,
        body: 'A synthetic required step.', actions: [{ id: 'accept', label: 'Accept', variant: 'primary', value: true }] })}>Required step</Button>
      <Button onClick={event => modals.show({ title: 'Sensitive paint', trigger: event.currentTarget, guard: false,
        body: <><PasswordInput aria-label="Synthetic password" defaultValue="synthetic-only-secret" />
          <Input aria-label="Synthetic OTP" autoComplete="one-time-code" defaultValue="123456" />
          <SecretField label="Synthetic key" value="synthetic-key-secret" defaultMasked={false} /></> })}>Sensitive paint</Button>
    </div><output data-testid="outcome">{outcome}</output><output data-testid="saves">{saves}</output>
  </main></ModalManager>;
}
const root = document.getElementById('root')!;
createRoot(root).render(<React.StrictMode>{root.dataset.siblings ? <SiblingDemo /> : <Demo />}</React.StrictMode>);
