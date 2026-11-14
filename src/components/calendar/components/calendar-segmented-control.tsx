/** Small native radio group, styled with calendar tokens. Arrow keys retain native group navigation. */
import { useId } from 'react';
import { layoutProps, type LayoutAliases } from './calendar-layout';
export function SegmentedControl({ value, onChange, data, size, ...props }: LayoutAliases & { value: string; onChange(value: string): void; data: readonly { value: string; label: string }[]; size?: string }) {
  const id = useId(), { rest, style } = layoutProps(props);
  return <div {...rest} className="calendar-segmented" style={style}>{data.map(item => <label key={item.value} className={value === item.value ? 'is-selected' : ''}><input type="radio" name={id} value={item.value} checked={value === item.value} onChange={() => onChange(item.value)} /><span>{item.label}</span></label>)}</div>;
}
