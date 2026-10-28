'use client';
/** Search the authorized server directory, not merely the people on the loaded log page. */
import { useEffect, useRef, useState } from 'react';
import { User } from '../animate-ui/icons/user';
import { Check } from '../animate-ui/icons/check';
import { ChevronDown } from '../animate-ui/icons/chevron-down';
import { Button } from '../ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { LoggingPeoplePage, LoggingPerson } from '../../logging/logging-directory-contracts';
import { LoggingPersonAvatar } from './logging-person-avatar';

export function LoggingPersonPicker({ value, selected, onChange }: { value?: string; selected?: LoggingPerson | null; onChange(id?: string, person?: LoggingPerson): void }) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client), [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const [page, setPage] = useState<{ key: string; value: LoggingPeoplePage } | null>(null), [after, setAfter] = useState<string | undefined>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [retry, setRetry] = useState(0);
  const key = JSON.stringify([boundary.key, search]), latest = useRef(key); latest.current = key;
  useEffect(() => { setAfter(undefined); }, [search, boundary.key]);
  useEffect(() => {
    if (!open || !client || !boundary.ready) return;
    const abort = new AbortController(), captured = key; setStatus('loading');
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => client.logging.people({ search, ...(after ? { after } : {}), limit: 25 }, { signal: abort.signal })).then(next => {
        if (abort.signal.aborted || latest.current !== captured) return;
        setPage(old => ({ key: captured, value: { ...next, items: after && old?.key === captured ? [...old.value.items, ...next.items].filter((person, i, items) => items.findIndex(other => other.id === person.id) === i) : next.items } })); setStatus('ready');
      }).catch(() => { if (!abort.signal.aborted && latest.current === captured) setStatus('error'); });
    }, search ? 180 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [open, client, boundary.ready, key, search, after, retry]);
  const people = page?.key === key ? page.value.items : [];
  const choose = (person?: LoggingPerson) => { onChange(person?.id, person); setOpen(false); };
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <Button type="button" variant="outline" size="sm" aria-label="Filter by user" className="min-w-36 justify-between"><User className="size-3.5" />
      <span className="max-w-40 truncate">{value ? selected?.id === value ? selected.name : 'Selected user' : 'All users'}</span><ChevronDown className="size-3.5 opacity-60" /></Button>
  </PopoverTrigger><PopoverContent align="start" className="w-80 p-0"><Command shouldFilter={false} label="Search users">
    <CommandInput aria-label="Search users" placeholder="Search by name or username…" value={search} onValueChange={setSearch} maxLength={100} />
    <CommandList aria-label="Users"><CommandGroup><CommandItem value="__zero_all_users__" onSelect={() => choose()}><User className="size-4" /><span className="flex-1">All users</span>{!value && <Check className="size-4" />}</CommandItem>
      {people.map(person => <CommandItem key={person.id} value={person.id} onSelect={() => choose(person)}><LoggingPersonAvatar userId={person.id} name={person.name} revision={person.revision} className="size-7" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{person.username}</span></span>{value === person.id && <Check className="size-4" />}</CommandItem>)}
    </CommandGroup>
    </CommandList>
    {!people.length && status === 'ready' && <p role="status" className="px-3 py-4 text-center text-xs text-muted-foreground">No matching users in this scope.</p>}
    {status === 'loading' && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Finding users…</p>}
    {status === 'error' && <div role="alert" className="border-t p-3 text-xs"><p>Users could not be loaded.</p><Button variant="ghost" size="sm" onClick={() => setRetry(n => n + 1)}>Retry user search</Button></div>}
    {status === 'ready' && page?.key === key && page.value.hasMore && <Button variant="ghost" size="sm" className="m-1" onClick={() => setAfter(page.value.nextCursor ?? undefined)}>Load more users</Button>}
  </Command></PopoverContent></Popover>;
}
