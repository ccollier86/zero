'use client';

/**
 * forms.tsx
 *
 * Modal form bodies for LaunchBoard entities. The forms own field collection
 * only; callers own persistence and modal lifecycle.
 */

import * as React from 'react';
import {
  Button,
  FormControl,
  FormField,
  FormLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@zero/framework/react';

import { COLUMN_ACCENTS } from './options';
import type {
  BoardInput,
  CardInput,
  CardPriority,
  CategoryInput,
  ColumnInput,
  LaunchBoard,
  LaunchCard,
  LaunchCategory,
  LaunchColumn,
} from './types';

const PRIORITY_OPTIONS: Array<{
  label: string;
  value: CardPriority;
  swatchClassName: string;
}> = [
  { label: 'Low', value: 'low', swatchClassName: 'bg-slate-400' },
  { label: 'Medium', value: 'medium', swatchClassName: 'bg-amber-500' },
  { label: 'High', value: 'high', swatchClassName: 'bg-rose-500' },
];

function modalTitle(title: string, description?: string) {
  return (
    <div className="space-y-1 pr-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function modalActions({
  submitLabel,
  onCancel,
  onDelete,
}: {
  submitLabel: string;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onDelete ? (
        <Button type="button" variant="destructive" onClick={onDelete}>
          Delete
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  children,
}: {
  name: string;
  label: string;
  children: React.ReactElement;
}) {
  return (
    <FormField name={name}>
      <FormLabel>{label}</FormLabel>
      <FormControl>{children}</FormControl>
    </FormField>
  );
}

interface FieldControlProps {
  id?: string;
  name?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

function SelectOptionContent({
  label,
  swatchClassName,
}: {
  label: string;
  swatchClassName?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {swatchClassName ? (
        <span className={`size-2.5 shrink-0 rounded-full ${swatchClassName}`} aria-hidden="true" />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

function AccentSelect({
  id,
  name,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  defaultValue,
}: FieldControlProps & {
  defaultValue: string;
}) {
  return (
    <Select name={name} defaultValue={defaultValue}>
      <SelectTrigger id={id} aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid}>
        <SelectValue placeholder="Select color" />
      </SelectTrigger>
      <SelectContent>
        {COLUMN_ACCENTS.map((accent) => (
          <SelectItem key={accent.value} value={accent.value}>
            <SelectOptionContent label={accent.label} swatchClassName={accent.value} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ColumnSelect({
  id,
  name,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  columns,
  defaultValue,
}: FieldControlProps & {
  columns: LaunchColumn[];
  defaultValue: string;
}) {
  return (
    <Select name={name} defaultValue={defaultValue}>
      <SelectTrigger id={id} aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid}>
        <SelectValue placeholder="Select column" />
      </SelectTrigger>
      <SelectContent>
        {columns.map((column) => (
          <SelectItem key={column.column_id} value={column.column_id}>
            <SelectOptionContent label={column.title} swatchClassName={column.accent} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PrioritySelect({
  id,
  name,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  defaultValue,
}: FieldControlProps & { defaultValue: CardPriority }) {
  return (
    <Select name={name} defaultValue={defaultValue}>
      <SelectTrigger id={id} aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid}>
        <SelectValue placeholder="Select priority" />
      </SelectTrigger>
      <SelectContent>
        {PRIORITY_OPTIONS.map((priority) => (
          <SelectItem key={priority.value} value={priority.value}>
            <SelectOptionContent
              label={priority.label}
              swatchClassName={priority.swatchClassName}
            />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CategoryForm({
  category,
  onSubmit,
  onCancel,
  onDelete,
}: {
  category?: LaunchCategory;
  onSubmit: (input: CategoryInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          name: String(form.get('name') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          color: String(form.get('color') ?? COLUMN_ACCENTS[0]!.value),
        });
      }}
    >
      {modalTitle(
        category ? 'Edit category' : 'Add category',
        'Categories switch the board list in the AppShell sidebar.',
      )}
      <Field name="name" label="Name">
        <Input required defaultValue={category?.name} />
      </Field>
      <Field name="description" label="Description">
        <Textarea defaultValue={category?.description} rows={3} />
      </Field>
      <Field name="color" label="Color">
        <AccentSelect defaultValue={category?.color ?? COLUMN_ACCENTS[0]!.value} />
      </Field>
      {modalActions({
        submitLabel: category ? 'Save category' : 'Create category',
        onCancel,
        onDelete,
      })}
    </form>
  );
}

export function BoardForm({
  board,
  onSubmit,
  onCancel,
  onDelete,
}: {
  board?: LaunchBoard;
  onSubmit: (input: BoardInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          name: String(form.get('name') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
        });
      }}
    >
      {modalTitle(board ? 'Edit board' : 'Add board', 'Boards live under the selected category.')}
      <Field name="name" label="Name">
        <Input required defaultValue={board?.name} />
      </Field>
      <Field name="description" label="Description">
        <Textarea defaultValue={board?.description} rows={3} />
      </Field>
      {modalActions({
        submitLabel: board ? 'Save board' : 'Create board',
        onCancel,
        onDelete,
      })}
    </form>
  );
}

export function ColumnForm({
  column,
  onSubmit,
  onCancel,
  onDelete,
}: {
  column?: LaunchColumn;
  onSubmit: (input: ColumnInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          title: String(form.get('title') ?? '').trim(),
          accent: String(form.get('accent') ?? COLUMN_ACCENTS[0]!.value),
        });
      }}
    >
      {modalTitle(column ? 'Edit column' : 'Add column', 'Columns become the Kanban lanes.')}
      <Field name="title" label="Title">
        <Input required defaultValue={column?.title} />
      </Field>
      <Field name="accent" label="Accent">
        <AccentSelect defaultValue={column?.accent ?? COLUMN_ACCENTS[0]!.value} />
      </Field>
      {modalActions({
        submitLabel: column ? 'Save column' : 'Create column',
        onCancel,
        onDelete,
      })}
    </form>
  );
}

export function CardForm({
  card,
  columns,
  defaultColumnId,
  onSubmit,
  onCancel,
  onDelete,
}: {
  card?: LaunchCard;
  columns: LaunchColumn[];
  defaultColumnId?: string;
  onSubmit: (input: CardInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          column_id: String(form.get('column_id') ?? defaultColumnId ?? ''),
          title: String(form.get('title') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          priority: String(form.get('priority') ?? 'medium') as CardPriority,
        });
      }}
    >
      {modalTitle(card ? 'Edit card' : 'Add card', 'Cards are persisted through Zero ReactiveDB.')}
      <Field name="title" label="Title">
        <Input required defaultValue={card?.title} />
      </Field>
      <Field name="column_id" label="Column">
        <ColumnSelect
          columns={columns}
          defaultValue={card?.column_id ?? defaultColumnId ?? columns[0]?.column_id ?? ''}
        />
      </Field>
      <Field name="description" label="Description">
        <Textarea defaultValue={card?.description} rows={4} />
      </Field>
      <Field name="priority" label="Priority">
        <PrioritySelect defaultValue={card?.priority ?? 'medium'} />
      </Field>
      {modalActions({
        submitLabel: card ? 'Save card' : 'Create card',
        onCancel,
        onDelete,
      })}
    </form>
  );
}
