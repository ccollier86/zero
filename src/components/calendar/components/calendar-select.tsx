/** Compact calendar field anatomy over Zero's native select/anchored surface. */
import { useId, useState, type CSSProperties, type ComponentProps, type ReactNode } from 'react';
import type { LayoutAliases } from './calendar-layout';
import { Select as Root, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@zero/framework/components/ui/select';
import { CalendarPopover as Popover } from './calendar-surfaces';
import { CheckIcon } from './prototype-icons';
import { useListChrome } from '../hooks/use-list-chrome';
import '../styles/calendar-select.css';
type Option = string | { value: string; label: string; disabled?: boolean };
type Props = Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'defaultValue' | 'children'> & LayoutAliases & {
  data?: readonly Option[]; value?: string | null; defaultValue?: string | null; onChange?(value: string | null, option: { value: string; label: string; disabled?: boolean }): void;
  label?: ReactNode; placeholder?: string; searchable?: boolean; variant?: string; size?: string; allowDeselect?: boolean;
  onDropdownOpen?(): void; onDropdownClose?(): void; comboboxProps?: { withinPortal?: boolean; offset?: number; transitionProps?: object };
  styles?: { input?: CSSProperties; option?: CSSProperties };
};
export function CalendarSelect({ data = [], value, defaultValue, onChange, label, placeholder, disabled, searchable, variant, styles, size, w, mt, mb, onDropdownOpen, onDropdownClose, className, allowDeselect, comboboxProps, ...props }: Props) {
  const id = useId(), [uncontrolled, setUncontrolled] = useState(defaultValue ?? null), [opened, setOpened] = useState(false), [query, setQuery] = useState('');
  const options = data.map(item => typeof item === 'string' ? { value: item, label: item } : item);
  const selected = value !== undefined ? value : uncontrolled;
  const caption = options.find(item => item.value === selected)?.label;
  const name = props['aria-label'] ?? (typeof label === 'string' ? label : 'Choose an option');
  function open(next: boolean) { setOpened(next); if (next) { setQuery(''); onDropdownOpen?.(); } else onDropdownClose?.(); }
  function choose(next: string) { const option = options.find(item => item.value === next); if (!option || option.disabled) return; setUncontrolled(next); onChange?.(next, option); }
  const chrome = useListChrome(`select/${opened}/${query}`, opened && !!searchable);
  const triggerProps = { ...props, id: props.id ?? id, disabled: disabled || !options.length, 'aria-label': name, 'data-expanded': opened ? 'true' : undefined,
    className: `calendar-select-trigger ${variant === 'unstyled' ? 'is-unstyled' : ''}`, style: styles?.input };
  const outerStyle: CSSProperties = { width: typeof w === 'number' ? w : w as string | undefined,
    ...(w ? { flex: `0 0 ${typeof w === 'number' ? `${w}px` : w}` } : {}),
    marginTop: typeof mt === 'number' ? mt : mt ? `var(--calendar-space-${mt})` : undefined,
    marginBottom: typeof mb === 'number' ? mb : mb ? `var(--calendar-space-${mb})` : undefined };
  const found = options.filter(item => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className={`calendar-select ${className ?? ''}`} style={outerStyle}>{label && <label htmlFor={props.id ?? id}>{label}</label>}
    {searchable ? <Popover opened={opened} onChange={open} width="var(--calendar-select-search-width)" position="bottom-start" returnFocus trapFocus>
      <Popover.Target><button {...triggerProps} type="button" role="combobox" aria-expanded={opened} aria-haspopup="listbox"><span>{caption ?? placeholder ?? 'Choose…'}</span><span aria-hidden="true">⌄</span></button></Popover.Target>
      <Popover.Dropdown className="calendar-select-search-menu"><input aria-label={`Search ${name.toLocaleLowerCase()}`} value={query} onChange={event => setQuery(event.currentTarget.value)} maxLength={120} autoComplete="off" placeholder="Search…" />
        <div ref={chrome.ref} {...chrome.handlers} role="listbox" aria-label={`${name} options`} className="practice-scroll-list calendar-select-search-list" style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-8)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
          {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
          {found.map(item => <button key={item.value} type="button" role="option" aria-selected={selected === item.value} disabled={item.disabled} data-list-item onClick={() => { choose(item.value); open(false); }}>{item.label}{selected === item.value && <CheckIcon size="var(--calendar-size-12)" />}</button>)}
          {!found.length && <div className="calendar-select-empty">No matches</div>}
        </div>
      </Popover.Dropdown>
    </Popover> : <Root value={selected ?? ''} onValueChange={choose} open={opened} onOpenChange={open} disabled={disabled || !options.length}>
      <SelectTrigger {...triggerProps}><SelectValue placeholder={placeholder ?? 'Choose…'} /></SelectTrigger>
      <SelectContent className="calendar-select-menu">{options.map(item => <SelectItem key={item.value} value={item.value} disabled={item.disabled} style={styles?.option}>{item.label}</SelectItem>)}</SelectContent>
    </Root>}
  </div>;
}
