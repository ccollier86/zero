import { CalendarPopover as Popover } from './calendar-surfaces';
import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ActionIcon, Avatar, Text, TextInput, UnstyledButton } from './calendar-ui';
import { IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconSearch } from './calendar-icons';
import type { CalendarResource } from '../types';
import { useListChrome } from '../hooks/use-list-chrome';

interface Props { providers: readonly CalendarResource[]; active?: CalendarResource; onChange(id: string): void; describe(id: string): string }
export function ProviderSwitcher({ providers, active, onChange, describe }: Props) {
  const [opened, setOpened] = useState(false), [query, setQuery] = useState('');
  const found = providers.filter(provider => provider.name.toLowerCase().includes(query.trim().toLowerCase()));
  const chrome = useListChrome(`${opened}/${query}/${providers.map(provider => provider.id).join(',')}`, opened);
  function step(direction: number) { const index = providers.findIndex(provider => provider.id === active?.id); const next = providers[(index + direction + providers.length) % providers.length]; if (next) onChange(next.id); }
  function keyboard(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!rows.length) return;
    event.preventDefault(); const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const base = index < 0 && event.key === 'ArrowUp' ? 0 : index;
    rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (base + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]!.focus();
  }
  return <div className="practice-provider-switcher" data-focused-provider={active?.id}>
    <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Previous provider" disabled={providers.length < 2} onClick={() => step(-1)}><IconChevronLeft size="var(--calendar-size-14)" /></ActionIcon>
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width="var(--calendar-size-290)" radius="lg" shadow="lg" withinPortal trapFocus returnFocus onExitTransitionEnd={() => setQuery('')}>
      <Popover.Target><UnstyledButton className="practice-provider-picker" data-provider-picker aria-label={`Choose provider, ${active?.name ?? 'none'}`} aria-expanded={opened} disabled={!providers.length} onClick={() => setOpened(value => !value)}><Avatar size="var(--calendar-size-22)" radius="xl" color={active?.color} src={active?.avatar} aria-hidden="true">{active?.initials}</Avatar><span>{active?.name ?? 'No providers'}</span><IconChevronDown size="var(--calendar-size-12)" /></UnstyledButton></Popover.Target>
      <Popover.Dropdown className="practice-scope-popover" onKeyDown={keyboard}>
        <div className="practice-scope-menu-head"><Text size="sm" fw="var(--calendar-weight-heading)">Provider calendar</Text><Text size="xs" c="dimmed">One provider at a time</Text></div>
        <TextInput size="xs" variant="unstyled" aria-label="Find weekly or monthly provider" placeholder="Find a provider…" leftSection={<IconSearch size="var(--calendar-size-13)" />} value={query} onChange={event => setQuery(event.currentTarget.value)} className="practice-scope-search" data-autofocus />
        <div ref={chrome.ref} role="listbox" aria-label="Provider options" className="practice-scroll-list practice-scope-options" {...chrome.handlers} style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-10)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-10)' : '0px' } as CSSProperties}>
          {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
          {found.map(provider => <button key={provider.id} type="button" role="option" aria-label={provider.name} aria-selected={provider.id === active?.id} tabIndex={-1} data-list-item className="practice-scope-option" onClick={() => { onChange(provider.id); setOpened(false); }}><Avatar size="var(--calendar-size-27)" radius="xl" color={provider.color} src={provider.avatar} aria-hidden="true">{provider.initials}</Avatar><span className="practice-option-copy"><b>{provider.name}</b><small>{describe(provider.id)}</small></span>{provider.id === active?.id && <IconCheck size="var(--calendar-size-14)" color="var(--calendar-color-blue-6)" />}</button>)}
          {!found.length && <div className="practice-search-empty"><Text size="xs" c="dimmed">No matching providers.</Text></div>}
        </div>
      </Popover.Dropdown>
    </Popover>
    <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Next provider" disabled={providers.length < 2} onClick={() => step(1)}><IconChevronRight size="var(--calendar-size-14)" /></ActionIcon>
  </div>;
}
