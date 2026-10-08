'use client';

/** Semantic, responsive settings rows; controls and domain persistence remain with callers. */
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

export interface DenseListProps extends React.ComponentProps<'ul'> {
  density?: 'compact' | 'default';
  separators?: boolean;
}

/** A list is not a listbox; its trailing controls keep their own native semantics. */
export function DenseList({ density = 'default', separators = true, className, ...props }: DenseListProps) {
  return <ul {...props} className={cn('zero-dense-list', className)} data-density={density}
    data-separators={separators || undefined} />;
}

export interface DenseListItemProps extends Omit<React.ComponentProps<'li'>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

/** No outer button wraps switches/selects; omit leading media without leaving an empty column. */
export function DenseListItem({ title, description, leading, trailing, children, className, ...props }: DenseListItemProps) {
  return <li {...props} className={cn('zero-dense-list__item', className)}>
    <div className="zero-dense-list__row">
      {leading != null && <div className="zero-dense-list__leading">{leading}</div>}
      <div className="zero-dense-list__text"><div className="zero-dense-list__title">{title}</div>
        {description != null && <div className="zero-dense-list__description">{description}</div>}</div>
      {trailing != null && <div className="zero-dense-list__trailing">{trailing}</div>}
    </div>
    {children != null && <div className="zero-dense-list__detail">{children}</div>}
  </li>;
}

export interface DenseListGroupProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
}

/** Group headings remain outside the ul; section children should contain a DenseList. */
export function DenseListGroup({ title, description, children, className, ...props }: DenseListGroupProps) {
  const id = React.useId();
  return <section {...props} aria-labelledby={props['aria-labelledby'] ?? id}
    className={cn('zero-dense-list__group', className)}>
    <header><h3 id={id}>{title}</h3>{description != null && <p>{description}</p>}</header>{children}
  </section>;
}

export interface DenseListChoiceProps extends Omit<DenseListItemProps, 'trailing' | 'onClick'> {
  onChoose: () => void;
  disabled?: boolean;
}

/** Single-action picker row; use DenseListItem for rows containing other interactive controls. */
export function DenseListChoice({ title, description, leading, onChoose, disabled, className, children, ...props }: DenseListChoiceProps) {
  return <li {...props} className={cn('zero-dense-list__choice', className)}>
    <Button type="button" variant="ghost" disabled={disabled} onClick={onChoose} className="zero-dense-list__row h-auto w-full justify-start whitespace-normal text-left">
      {leading != null && <span className="zero-dense-list__leading">{leading}</span>}
      <span className="zero-dense-list__text"><span className="zero-dense-list__title">{title}</span>
        {description != null && <span className="zero-dense-list__description">{description}</span>}</span>
    </Button>{children}
  </li>;
}
