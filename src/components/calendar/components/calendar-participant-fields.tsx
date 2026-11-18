'use client';
/** Native account picker anatomy. Domain contacts/guests remain a separate future adapter, not invented users. */
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CalendarParticipantDirectoryPage, CalendarParticipantReference, CalendarParticipantView } from '../../../calendar/contracts';
import { CalendarPopover } from './calendar-surfaces';
import { IconCheck, IconChevronDown, IconPlus, IconSearch, IconX } from './calendar-icons';
import { useListChrome } from '../hooks/use-list-chrome';
import '../styles/attendee-picker.css';

export interface CalendarParticipantFieldsProps {
  readonly value: readonly CalendarParticipantReference[];
  readonly directory: CalendarParticipantDirectoryPage | null;
  /** Fresh, authorized retained binding presentation, never a cache of previous picker choices. */
  readonly accepted?: readonly CalendarParticipantView[];
  /** Combined current-scope presentation readiness. Error/retirement masks all old names and actions. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly search: string;
  readonly disabled?: boolean;
  readonly maxParticipants?: number;
  readonly canGoBack?: boolean;
  onSearchChange(search: string): void;
  onChange(value: readonly CalendarParticipantReference[]): void;
  onRetry?(): void;
  onPrevious?(): void;
  onNext?(): void;
}

export function CalendarParticipantFields(props: CalendarParticipantFieldsProps) {
  const [opened, setOpened] = useState(false), id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const ready = props.status === 'ready', disabled = !!props.disabled || !ready;
  const surfaceOpen = opened && (ready || props.status === 'loading');
  const accepted = new Map(ready ? (props.accepted ?? []).map(item => [item.ref.userId, item] as const) : []);
  const found = ready ? (props.directory?.items ?? []).flatMap(item => {
    const retained = accepted.get(item.ref.userId);
    return item.availability !== 'available' || retained?.availability === 'unavailable' ? [] : [retained?.availability === 'available' ? retained : item];
  }) : [];
  // A known current unavailable binding must mask an independently lagging directory caption.
  const names = new Map(ready ? [...found, ...(props.accepted ?? [])].map(item => [item.ref.userId, item] as const) : []);
  const selected = new Set(props.value.map(ref => ref.userId));
  const max = Math.max(1, Math.min(100, props.maxParticipants ?? 100));
  const chrome = useListChrome(`participants/${opened}/${ready}/${props.search}/${found.map(item => item.ref.userId).join(',')}`, opened && ready);
  function choose(ref: CalendarParticipantReference) {
    if (disabled) return;
    props.onChange(selected.has(ref.userId) ? props.value.filter(item => item.userId !== ref.userId)
      : props.value.length < max ? [...props.value, { kind: 'guardian-user', userId: ref.userId }] : props.value);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpened(false); return; }
    const target = event.target as HTMLElement, input = target.tagName === 'INPUT';
    if (input && event.key === 'Enter') { event.preventDefault(); return; }
    if (!(input || target.getAttribute('role') === 'option') || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
      || input && ['Home', 'End'].includes(event.key)) return;
    const rows = [...(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
    event.preventDefault(); if (!rows.length) return;
    const current = rows.indexOf(target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : current < 0 ? event.key === 'ArrowUp' ? rows.length - 1 : 0 : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus(); rows[next]!.scrollIntoView({ block: 'nearest' });
  }
  return <div className="appointment-attendees" role="group" aria-label="Calendar participants">
    {ready && props.value.length > 0 && <div className="appointment-attendee-chips" role="list" aria-label="Selected participants">
      {props.value.map((ref, index) => {
        const person = names.get(ref.userId), name = person?.availability === 'available' ? person.name
          : person?.availability === 'unavailable' ? 'Unavailable participant' : 'Selected account (not on this page)';
        return <span key={ref.userId} role="listitem" className="appointment-attendee-chip is-staff">
          <span className="appointment-chip-name">{name}</span>
          <button type="button" disabled={disabled} aria-label={`Remove ${name}${person?.availability === 'available' ? '' : ` ${index + 1}`}`}
            onClick={() => { choose(ref); trigger.current?.focus(); }}><IconX size="var(--calendar-size-11)" aria-hidden="true" /></button>
        </span>;
      })}
    </div>}
    <CalendarPopover opened={surfaceOpen} onChange={setOpened} position="bottom-start" width="var(--calendar-size-292)"
      offset={5} radius="md" withinPortal withRoles={false} trapFocus returnFocus closeOnEscape={false}>
      <CalendarPopover.Target><button ref={trigger} type="button" disabled={disabled} className="appointment-attendee-trigger"
        aria-haspopup="dialog" aria-expanded={surfaceOpen} aria-controls={surfaceOpen ? id : undefined} onClick={() => setOpened(value => !value)}>
        <IconPlus size="var(--calendar-size-12)" aria-hidden="true" /><span>{props.value.length && ready ? 'Add another participant' : 'Add participants…'}</span><IconChevronDown size="var(--calendar-size-12)" aria-hidden="true" />
      </button></CalendarPopover.Target>
      <CalendarPopover.Dropdown id={id} role="dialog" aria-label="Choose calendar participants" tabIndex={-1}
        className="practice-scope-popover appointment-attendee-popup" onKeyDownCapture={keyboard}>
        <div className="appointment-attendee-search"><IconSearch size="var(--calendar-size-13)" aria-hidden="true" />
          <input aria-label="Search calendar participants" placeholder="Search people…" autoComplete="off" maxLength={100}
            value={props.search} onChange={event => props.onSearchChange(event.currentTarget.value)} /><span>{props.value.length} added</span>
        </div>
        <div ref={chrome.ref} {...chrome.handlers} role="listbox" aria-label="Participant results" aria-multiselectable="true"
          className="practice-scroll-list appointment-attendee-results" style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-8)' : '0px',
            '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
          {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
          {found.map(person => <button type="button" key={person.ref.userId} role="option" aria-selected={selected.has(person.ref.userId)}
            data-list-item className="appointment-attendee-option" disabled={!!props.disabled || !selected.has(person.ref.userId) && props.value.length >= max}
            onClick={() => choose(person.ref)}><span className="appointment-attendee-copy"><b>{person.name}</b><small>Account</small></span>
            <span className={`practice-option-check ${selected.has(person.ref.userId) ? 'is-checked' : ''}`} aria-hidden="true">{selected.has(person.ref.userId) && <IconCheck size="var(--calendar-size-10)" />}</span>
          </button>)}
          {!found.length && <div className="appointment-attendee-empty">{!ready ? 'Loading currently authorized participants…' : props.directory?.truncated ? 'No matches on this page. More accounts can be checked.' : 'No eligible accounts match this search.'}</div>}
        </div>
        <div className="appointment-attendee-footer"><button type="button" disabled={disabled || !props.canGoBack} onClick={props.onPrevious}>Previous</button>
          <button type="button" disabled={disabled || !props.directory?.nextAfter} onClick={props.onNext}>Next</button><button type="button" onClick={() => setOpened(false)}>Done</button></div>
      </CalendarPopover.Dropdown>
    </CalendarPopover>
    {(props.status === 'idle' || props.status === 'loading') && <p role="status" className="appointment-attendee-note">Loading currently authorized participants…</p>}
    {props.status === 'error' && <div role="status" className="appointment-attendee-error">Participant choices are unavailable or access changed.
      {props.onRetry && <button type="button" onClick={props.onRetry}>Retry participants</button>}</div>}
    {ready && <p className="appointment-attendee-note">Account references only. Selecting a participant neither sends an invitation nor grants calendar access.</p>}
  </div>;
}
