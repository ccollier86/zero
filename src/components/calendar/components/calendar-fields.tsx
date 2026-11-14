/** Tokenized calendar field rows; native Zero supplies input, textarea and boolean controls. */
import { useId, useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Input } from '@zero/framework/components/ui/input';
import { Textarea as ZeroTextarea } from '@zero/framework/components/ui/textarea';
import { Checkbox as ZeroCheckbox } from '@zero/framework/components/ui/checkbox';
import { Switch as ZeroSwitch } from '@zero/framework/components/ui/switch';
import { layoutProps, type LayoutAliases } from './calendar-layout';
type InputProps = ComponentProps<'input'> & LayoutAliases & { label?: ReactNode; description?: ReactNode; size?: never; variant?: string; styles?: { input?: CSSProperties }; leftSection?: ReactNode; rightSection?: ReactNode; classNames?: object };
export function TextInput({ label, description, variant, styles, leftSection, rightSection, className, classNames, ...props }: Omit<InputProps, 'size'> & { size?: string }) {
  const id = useId(), { rest, style } = layoutProps(props), { size, ...input } = rest;
  return <div className={`calendar-field ${className ?? ''}`} style={style}>{label && <label htmlFor={props.id ?? id}>{label}</label>}
    <div className={`calendar-input-row ${variant === 'unstyled' ? 'is-unstyled' : ''}`}>
      {leftSection && <span className="calendar-input-leading">{leftSection}</span>}<Input {...input} id={props.id ?? id} className={`calendar-native-input ${leftSection ? 'has-leading' : ''} ${rightSection ? 'has-trailing' : ''}`} style={styles?.input} />
      {rightSection && <span className="calendar-input-trailing">{rightSection}</span>}
    </div>{description && <small>{description}</small>}
  </div>;
}
export function Textarea({ label, size, variant, styles, autosize, minRows, maxRows, ...props }: ComponentProps<'textarea'> & LayoutAliases & { label?: ReactNode; size?: string; variant?: string; styles?: { input?: CSSProperties }; autosize?: boolean; minRows?: number; maxRows?: number }) {
  const id = useId(), ref = useRef<HTMLTextAreaElement>(null), { rest, style } = layoutProps(props);
  useLayoutEffect(() => { const node = ref.current; if (!autosize || !node) return; node.style.height = 'auto'; const line = parseFloat(getComputedStyle(node).lineHeight); if (Number.isFinite(line)) node.style.height = `${Math.min(node.scrollHeight, (maxRows ?? 8) * line)}px`; }, [props.value, autosize, maxRows]);
  return <div className="calendar-field" style={style}>{label && <label htmlFor={props.id ?? id}>{label}</label>}<ZeroTextarea {...rest} ref={ref} id={props.id ?? id} rows={minRows ?? props.rows} className={`calendar-native-textarea ${variant === 'unstyled' ? 'is-unstyled' : ''} ${props.className ?? ''}`} style={styles?.input} /></div>;
}
type BooleanProps = LayoutAliases & { label?: ReactNode; checked?: boolean; defaultChecked?: boolean; disabled?: boolean; size?: string; styles?: { label?: CSSProperties }; className?: string; onChange?(checked: boolean): void; 'aria-label'?: string };
export function Checkbox({ label, checked, defaultChecked, onChange, disabled, size, styles, ...props }: BooleanProps) {
  const id = useId(), { rest, style } = layoutProps(props);
  return <label {...rest} htmlFor={id} className={`calendar-boolean-field ${props.className ?? ''}`} style={style}><ZeroCheckbox id={id} checked={checked} defaultChecked={defaultChecked} onCheckedChange={value => onChange?.(value === true)} disabled={disabled} aria-label={props['aria-label']} /><span style={styles?.label}>{label}</span></label>;
}
export function Switch({ label, checked, defaultChecked, onChange, disabled, size, styles, ...props }: BooleanProps) {
  const id = useId(), { rest, style } = layoutProps(props);
  return <label {...rest} htmlFor={id} className={`calendar-boolean-field calendar-switch ${props.className ?? ''}`} style={style}><ZeroSwitch id={id} checked={checked} defaultChecked={defaultChecked} onCheckedChange={onChange} disabled={disabled} aria-label={props['aria-label']} /><span style={styles?.label}>{label}</span></label>;
}
