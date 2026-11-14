/** Preserve compact calendar button geometry while Zero owns button/icon interaction behavior. */
import type { ComponentProps, ReactNode, CSSProperties } from 'react';
import { Button as ZeroButton } from '@zero/framework/components/ui/button';
import { layoutProps, calendarColor, type LayoutAliases } from './calendar-layout';
type Props = Omit<ComponentProps<typeof ZeroButton>, 'size' | 'variant'> & LayoutAliases & { size?: string; variant?: string; color?: string; leftSection?: ReactNode; rightSection?: ReactNode; fullWidth?: boolean };
function CalendarButton({ size = 'sm', variant = 'filled', color = 'blue', leftSection, rightSection, children, fullWidth, ...props }: Props) {
  const { rest, style } = layoutProps(props), compact = size.startsWith('compact-');
  return <ZeroButton {...rest} type={props.type ?? 'button'} size="sm" variant={variant === 'default' ? 'outline' : variant === 'subtle' ? 'ghost' : variant === 'light' ? 'secondary' : 'default'}
    className={`calendar-button ${compact ? 'is-compact' : ''} is-${variant} ${props.className ?? ''}`} style={{ '--calendar-button-color': calendarColor(color), '--calendar-button-tint': `var(--calendar-color-${color}-0)`, ...(fullWidth ? { width: '100%' } : {}), ...style } as CSSProperties}>
    {leftSection}{children}{rightSection}
  </ZeroButton>;
}
export const Button = Object.assign(CalendarButton, { Group: ({ children }: { children: ReactNode }) => <div className="calendar-button-group">{children}</div> });
export function ActionIcon({ size = 'sm', children, variant = 'subtle', ...props }: Props) {
  const { rest, style } = layoutProps(props); return <CalendarButton {...rest} variant={variant} className={`calendar-action-icon ${props.className ?? ''}`} style={{ width: `var(--calendar-action-${size}-size)`, height: `var(--calendar-action-${size}-size)`, ...style }}>{children}</CalendarButton>;
}
export function UnstyledButton(props: ComponentProps<'button'> & LayoutAliases) { const { rest, style } = layoutProps(props); return <button {...rest} className={`calendar-unstyled-button ${props.className ?? ''}`} type={props.type ?? 'button'} style={style} />; }
