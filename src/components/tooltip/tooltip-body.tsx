/** Display-only tooltip content using Zero's keyboard primitive, never new interactive controls. */
import * as React from 'react';
import { Kbd, KbdGroup } from '../kbd';

export interface TooltipBodyProps {
  children?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  shortcut?: string | readonly string[] | React.ReactNode;
}

/** Extract plain text for Radix's separate accessible description without cloning visual refs. */
export function tooltipText(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(tooltipText).filter(Boolean).join(' ');
  if (React.isValidElement<{ children?: React.ReactNode }>(value)) return tooltipText(value.props.children);
  return '';
}

/** A compact label or richer title/description with native display-only keyboard hints. */
export function TooltipBody({ children, title, description, shortcut }: TooltipBodyProps) {
  const keys = typeof shortcut === 'string' ? shortcut.split(/\s+/u).filter(Boolean)
    : Array.isArray(shortcut) && shortcut.every(key => typeof key === 'string') ? shortcut : null;
  const hint = shortcut == null ? null : <span className="zero-tooltip-keys">{keys
    ? <KbdGroup>{keys.map((key, index) => <Kbd key={index}>{key}</Kbd>)}</KbdGroup> : shortcut}</span>;
  return <div className="zero-tooltip-body" data-rich={description != null || undefined}>
    {title != null || description != null || hint ? <>
      <div className="zero-tooltip-title"><span>{title ?? children}</span>{hint}</div>
      {description != null && <div className="zero-tooltip-description">{description}</div>}
      {title != null && children != null && <div>{children}</div>}
    </> : children}
  </div>;
}
