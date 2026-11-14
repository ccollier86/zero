import { CalendarPopover as Popover } from './calendar-surfaces';
import { Fragment, useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button, Group, Text, TextInput, UnstyledButton } from './calendar-ui';
import { IconCheck, IconChevronDown, IconLock, IconMapPin, IconSearch } from './calendar-icons';
import { useListChrome } from '../hooks/use-list-chrome';

export interface ScopeOption { id: string; name: string; hint?: string; group?: string; badge?: string }
interface Props { label: 'States' | 'Locations'; options: readonly ScopeOption[]; selected: readonly string[]; allLabel: string; onChange(ids: string[]): void }
export function ScopePicker({ label, options, selected, allLabel, onChange }: Props) {
  const [opened, setOpened] = useState(false), [query, setQuery] = useState('');
  const listId = useId();
  const filtered = options.filter(option => `${option.name} ${option.hint ?? ''} ${option.badge ?? ''} ${option.group ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const chrome = useListChrome(`${opened}/${query}/${filtered.map(option => option.id).join(',')}`, opened);
  const chosen = options.filter(option => selected.includes(option.id));
  const caption = chosen.length === 1 ? chosen[0]!.name : chosen.length ? `${chosen.length} ${label.toLowerCase()}` : allLabel;
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]); }
  function keyboard(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!rows.length) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const base = index < 0 && event.key === 'ArrowUp' ? 0 : index;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (base + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus();
  }
  if (options.length <= 1) return <div className="practice-scope-fixed" role="group" aria-label={`${label}: ${options[0]?.name ?? 'None available'}`}><IconMapPin size="var(--calendar-size-14)" aria-hidden="true" /><div><span className="practice-scope-eyebrow">{label}</span><span>{options[0]?.name ?? 'None available'}</span></div><IconLock size="var(--calendar-size-12)" aria-hidden="true" /></div>;
  return <Popover opened={opened} onChange={setOpened} position="bottom-start" width="var(--calendar-size-232)" offset={5} radius="md" shadow="lg" withinPortal trapFocus returnFocus onExitTransitionEnd={() => setQuery('')}>
    <Popover.Target>
      <UnstyledButton className={`practice-scope-trigger ${chosen.length ? 'has-filter' : ''}`} aria-label={`Filter ${label.toLowerCase()}`} aria-expanded={opened} aria-controls={opened ? listId : undefined} onClick={() => setOpened(value => !value)}>
        <IconMapPin size="var(--calendar-size-14)" aria-hidden="true" /><div><span className="practice-scope-eyebrow">{label}</span><span>{caption}</span></div><span className="practice-scope-count">{chosen.length || options.length}</span><IconChevronDown size="var(--calendar-size-12)" aria-hidden="true" />
      </UnstyledButton>
    </Popover.Target>
    <Popover.Dropdown className="practice-scope-popover practice-geography-menu" onKeyDown={keyboard}>
      <div className="practice-scope-menu-head"><Text size="var(--calendar-size-11)" fw="var(--calendar-weight-heading)">{label}</Text></div>
      <TextInput variant="unstyled" size="xs" aria-label={`Search ${label.toLowerCase()}`} placeholder={`Find ${label.toLowerCase()}…`} leftSection={<IconSearch size="var(--calendar-size-12)" />} value={query} onChange={event => setQuery(event.currentTarget.value)} className="practice-scope-search" data-autofocus />
      <div ref={chrome.ref} className="practice-scroll-list practice-scope-options practice-geography-options" id={listId} role="listbox" aria-label={`${label} options`} aria-multiselectable="true" {...chrome.handlers} style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-8)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
        {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
        {!query && <button type="button" role="option" aria-selected={!chosen.length} aria-label={allLabel} data-list-item className="practice-scope-option" tabIndex={-1} onClick={() => onChange([])}><span className="practice-option-symbol">All</span><span className="practice-option-copy"><b>{allLabel}</b><small>{options.length}</small></span><span className={`practice-option-check ${!chosen.length ? 'is-checked' : ''}`} aria-hidden="true">{!chosen.length && <IconCheck size="var(--calendar-size-11)" />}</span></button>}
        {filtered.map((option, index) => <Fragment key={option.id}>
          {option.group && option.group !== filtered[index - 1]?.group && <div className="practice-option-group">{option.group}</div>}
          <button type="button" role="option" aria-label={option.name} aria-selected={chosen.some(item => item.id === option.id)} data-list-item className="practice-scope-option" tabIndex={-1} onClick={() => toggle(option.id)}>
            <span className="practice-option-symbol">{option.badge ?? <IconMapPin size="var(--calendar-size-14)" />}</span><span className="practice-option-copy"><b>{option.name}</b>{option.hint && <small>{option.hint}</small>}</span><span className={`practice-option-check ${selected.includes(option.id) ? 'is-checked' : ''}`} aria-hidden="true">{selected.includes(option.id) && <IconCheck size="var(--calendar-size-12)" />}</span>
          </button>
        </Fragment>)}
        {!filtered.length && <div className="practice-search-empty"><Text size="xs" c="dimmed">No matching {label.toLowerCase()}.</Text><Button size="compact-xs" variant="subtle" onClick={() => setQuery('')}>Clear search</Button></div>}
      </div>
      <Group justify="space-between" className="practice-scope-menu-foot"><Button size="compact-xs" variant="subtle" color="gray" onClick={() => onChange([])} disabled={!selected.length}>Reset</Button><Button size="compact-xs" variant="light" onClick={() => setOpened(false)}>Done</Button></Group>
    </Popover.Dropdown>
  </Popover>;
}
