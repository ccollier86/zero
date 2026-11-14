import { useId, useState, type CSSProperties } from 'react';
import { ActionIcon, Button, Collapse, Group, Paper, Text, TextInput, UnstyledButton } from './calendar-ui';
import { IconCheck, IconChevronDown, IconMapPin, IconSearch, IconUsers, IconX } from './calendar-icons';
import { MiniCalendar } from '../recovered/calendar/components/mini-calendar/index';
import { UserListItem } from '../recovered/calendar/components/user-list/UserListItem';
import { ScopePicker } from './scope-picker';
import { useListChrome } from '../hooks/use-list-chrome';
import type { CalendarSidebarScope } from '../models/practice-filter-model';

interface Props {
  scope: CalendarSidebarScope;
  selectedDate: Date;
  selectedIds: readonly string[];
  onDateSelect(date: Date): void;
  onToggle(id: string): void;
  onSelection(scope: readonly string[], chosen: readonly string[]): void;
  focusedProviderId?: string;
}
export function PracticeCalendarSidebar({ scope, selectedDate, selectedIds, onDateSelect, onToggle, onSelection, focusedProviderId }: Props) {
  const [locationsOpen, setLocationsOpen] = useState(true), [providersOpen, setProvidersOpen] = useState(true);
  const locationsId = useId(), providersId = useId();
  const chrome = useListChrome(`${scope.foundProviders.map(provider => provider.id).join(',')}/${providersOpen}`, providersOpen);
  const foundIds = scope.foundProviders.map(provider => provider.id);
  const selectedCount = focusedProviderId ? Number(foundIds.includes(focusedProviderId)) : foundIds.filter(id => selectedIds.includes(id)).length;
  const visibleCount = focusedProviderId ? 1 : scope.providers.filter(provider => selectedIds.includes(provider.id)).length;
  return <Paper withBorder radius="md" p="sm" className="practice-sidebar">
    <div className="practice-mini-calendar"><MiniCalendar selectedDate={selectedDate} onDateSelect={onDateSelect} /></div>
    <section className="practice-sidebar-section">
      <UnstyledButton className="practice-section-heading" aria-label="Locations" aria-expanded={locationsOpen} aria-controls={locationsId} onClick={() => setLocationsOpen(open => !open)}>
        <IconMapPin size="var(--calendar-size-14)" aria-hidden="true" /><span>Locations</span><span className="practice-section-count">{scope.locations.length}</span><IconChevronDown size="var(--calendar-size-12)" className={locationsOpen ? '' : 'is-collapsed'} aria-hidden="true" />
      </UnstyledButton>
      {!locationsOpen && <Text size="xs" c="dimmed" className="practice-collapsed-summary" title={scope.summary} truncate>{scope.summary}</Text>}
      <Collapse in={locationsOpen}>
        <div id={locationsId} className="practice-location-filters">
          <ScopePicker label="States" allLabel="All states" options={scope.states.map(state => ({ id: state.id, name: state.name, badge: state.id, hint: `${scope.allowed.filter(location => location.state === state.id).length} ${scope.allowed.filter(location => location.state === state.id).length === 1 ? 'location' : 'locations'}` }))} selected={scope.selectedStates} onChange={scope.setStates} />
          <ScopePicker label="Locations" allLabel="All locations" options={scope.locationOptions.map(location => ({ id: location.id, name: location.name, hint: location.state, group: scope.states.find(state => state.id === location.state)?.name }))} selected={scope.selectedLocations} onChange={scope.setLocations} />
          {(scope.selectedStates.length > 0 || scope.selectedLocations.length > 0) && <div className="practice-filter-chips" aria-label="Active location filters">
            {scope.selectedStates.map(id => <span className="practice-filter-chip" key={id}><span>{scope.states.find(state => state.id === id)?.name}</span><button type="button" aria-label={`Remove ${id} state filter`} onClick={() => scope.setStates(scope.selectedStates.filter(item => item !== id))}><IconX size="var(--calendar-size-11)" /></button></span>)}
            {scope.selectedLocations.map(id => <span className="practice-filter-chip" key={id}><span>{scope.locationOptions.find(location => location.id === id)?.name}</span><button type="button" aria-label={`Remove ${scope.locationOptions.find(location => location.id === id)?.name} location filter`} onClick={() => scope.setLocations(scope.selectedLocations.filter(item => item !== id))}><IconX size="var(--calendar-size-11)" /></button></span>)}
          </div>}
        </div>
      </Collapse>
    </section>
    <section className={`practice-sidebar-section practice-provider-section ${providersOpen ? 'is-open' : ''}`}>
      <Group gap="var(--calendar-size-4)" wrap="nowrap" className="practice-providers-heading">
        <UnstyledButton className="practice-section-heading" aria-label="Calendars" aria-expanded={providersOpen} aria-controls={providersId} onClick={() => setProvidersOpen(open => !open)}>
          <IconUsers size="var(--calendar-size-14)" aria-hidden="true" /><span>Calendars</span><span className="practice-section-count">{visibleCount}</span>
        </UnstyledButton>
        {providersOpen && !focusedProviderId && <Group gap="var(--calendar-size-2)" wrap="nowrap"><ActionIcon size="xs" variant="subtle" aria-label="Select all calendars" title="Select matching calendars" disabled={!foundIds.length || selectedCount === foundIds.length} onClick={() => onSelection(foundIds, foundIds)}><IconCheck size="var(--calendar-size-12)" /></ActionIcon><ActionIcon size="xs" variant="subtle" aria-label="Deselect all calendars" title="Deselect matching calendars" disabled={!selectedCount} onClick={() => onSelection(foundIds, [])}><IconX size="var(--calendar-size-12)" /></ActionIcon></Group>}
        <ActionIcon size="xs" variant="subtle" color="gray" className="practice-section-caret" aria-label={providersOpen ? 'Collapse calendars' : 'Expand calendars'} aria-expanded={providersOpen} aria-controls={providersId} onClick={() => setProvidersOpen(open => !open)}><IconChevronDown size="var(--calendar-size-12)" className={providersOpen ? '' : 'is-collapsed'} aria-hidden="true" /></ActionIcon>
      </Group>
      {!providersOpen && <Text size="xs" c="dimmed" className="practice-collapsed-summary" truncate>{focusedProviderId ? scope.providers.find(provider => provider.id === focusedProviderId)?.name : `${visibleCount} ${visibleCount === 1 ? 'calendar' : 'calendars'} selected`}</Text>}
      {providersOpen && <div id={providersId} className="practice-provider-body">
        <TextInput aria-label="Find provider calendars" placeholder="Find a provider…" size="xs" variant="unstyled" className="practice-provider-search" leftSection={<IconSearch size="var(--calendar-size-13)" />} value={scope.filters.query} onChange={event => scope.setQuery(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Escape' && scope.filters.query) { event.stopPropagation(); scope.setQuery(''); } }} rightSection={scope.filters.query ? <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Clear provider search" onClick={() => scope.setQuery('')}><IconX size="var(--calendar-size-12)" /></ActionIcon> : null} />
        <div className="practice-roster-meta"><span>{focusedProviderId ? 'Switch provider calendar' : `${selectedCount} of ${foundIds.length} selected`}</span>{scope.filters.query && <span>Search results</span>}</div>
        <div ref={chrome.ref} data-provider-scroll role={focusedProviderId ? 'radiogroup' : undefined} aria-label={focusedProviderId ? 'Choose provider calendar' : undefined} className="practice-scroll-list practice-provider-list" {...chrome.handlers} onKeyDown={event => { if (!focusedProviderId || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []); if (!rows.length) return; event.preventDefault(); const index = rows.indexOf(document.activeElement as HTMLButtonElement); const next = rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]!; next.click(); next.focus(); }} style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-10)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-12)' : '0px' } as CSSProperties}>
          {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
          <div>{scope.foundProviders.map(provider => <UserListItem key={provider.id} user={provider} isSelected={focusedProviderId ? provider.id === focusedProviderId : selectedIds.includes(provider.id)} onToggle={onToggle} description={scope.providerSummary(provider.id)} selectionMode={focusedProviderId ? 'single' : 'multiple'} tabStop={provider.id === focusedProviderId || (!foundIds.includes(focusedProviderId ?? '') && provider.id === foundIds[0])} />)}</div>
          {!foundIds.length && <div className="practice-search-empty"><Text size="xs" c="dimmed">{scope.filters.query ? 'No providers match your search.' : 'No providers cover these locations.'}</Text><Button size="compact-xs" variant="subtle" onClick={scope.filters.query ? () => scope.setQuery('') : scope.reset}>{scope.filters.query ? 'Clear search' : 'Clear filters'}</Button></div>}
        </div>
      </div>}
    </section>
  </Paper>;
}
