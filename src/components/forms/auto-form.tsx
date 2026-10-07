'use client';

import * as React from 'react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { FieldMeta } from '../../schema/field-types';
import { useForm, type UseFormOptions, type UseFormReturn } from '../../hooks/use-form';
import { useFormSave } from '../../hooks/use-form-save';
import { FormSaveBar, UnsavedChangesDialog } from '../form-save';
import { FieldRenderer, type FieldRendererProps } from './field-renderer';
import { Button } from '#zero/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '#zero/components/ui/card';
import { cn } from '#zero/lib/utils';
import type { Row } from '../../sync/types';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { Loader } from '#zero/components/animate-ui/icons/loader';

// ─── Types ──────────────────────────────────────────────────────────────────

type FieldOverrides = NonNullable<FieldRendererProps['overrides']>;

export interface AutoFormProps<T extends Row = Row> {
  schema: SchemaDescriptor;
  collection?: UseFormOptions<T>['collection'];
  mode?: 'create' | 'edit';
  editId?: string;
  defaultValues?: Partial<T>;
  layout?: 'vertical' | 'horizontal' | 'inline';
  columns?: number;
  card?: { title: string; description?: string };
  fields?: Record<string, FieldOverrides>;
  /** Field allow-list used for rendering, validation, and submitted data. */
  includeFields?: readonly string[];
  onSubmit?: UseFormOptions<T>['onSubmit'];
  baseline?: UseFormOptions<T>['baseline'];
  initialRevision?: UseFormOptions<T>['initialRevision'];
  scopeKey?: UseFormOptions<T>['scopeKey'];
  /** Opt in to acknowledged-baseline Save/Discard/Stay instead of the existing submit row. */
  saveBar?: boolean | 'inline';
  onSuccess?: () => void;
  onError?: (error: string) => void;
  submitLabel?: string;
  showReset?: boolean;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AutoForm<T extends Row = Row>({
  schema,
  collection,
  mode = 'create',
  editId,
  defaultValues,
  layout = 'vertical',
  columns = 1,
  card,
  fields: fieldOverrides = {},
  includeFields,
  onSubmit,
  baseline,
  initialRevision,
  scopeKey,
  saveBar = false,
  onSuccess,
  onError,
  submitLabel,
  showReset = false,
  className,
}: AutoFormProps<T>) {
  const form = useForm<T>({
    schema,
    defaultValues,
    collection,
    mode,
    editId,
    includeFields,
    onSubmit,
    baseline: baseline ?? (saveBar ? 'accepted' : 'initial'),
    initialRevision,
    scopeKey,
    onSuccess,
    onError,
  });

  const gridStyle = columns > 1
    ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '1rem' }
    : undefined;

  const content = (
    <form onSubmit={form.handleSubmit} className={cn('space-y-4', className)}>
      <div style={gridStyle} className={columns <= 1 ? 'space-y-4' : undefined}>
        {form.fieldNames.map((name) => {
          const meta = form.getFieldMeta(name);
          if (!meta) return null;

          const overrides = fieldOverrides[name];
          if (overrides?.hidden) return null;

          return (
            <FieldRenderer
              key={name}
              name={name}
              meta={meta}
              registration={form.register(name)}
              overrides={overrides}
            />
          );
        })}
      </div>

      {saveBar ? <AutoFormSaveControls form={form} scopeKey={scopeKey} placement={saveBar === 'inline' ? 'inline' : 'floating'} /> : <div className={cn(
        'flex gap-2',
        layout === 'inline' ? 'flex-row items-end' : 'flex-row pt-2',
      )}>
        <Button
          type="submit"
          disabled={form.isSubmitting}
        >
          {form.isSubmitting && (
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
          )}
          {submitLabel ?? (mode === 'edit' ? 'Save' : 'Create')}
        </Button>
        {showReset && (
          <Button
            type="button"
            variant="outline"
            onClick={form.reset}
            disabled={form.isSubmitting || !form.isDirty}
          >
            Reset
          </Button>
        )}
      </div>}
    </form>
  );

  if (card) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{card.title}</CardTitle>
          {card.description && <CardDescription>{card.description}</CardDescription>}
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
    );
  }

  return content;
}

function AutoFormSaveControls<T extends Row>({ form, scopeKey, placement }: {
  form: UseFormReturn<T>; scopeKey?: string | number; placement: 'inline' | 'floating';
}) {
  const controller = useFormSave({ form, scopeKey });
  return <><FormSaveBar controller={controller} placement={placement} /><UnsavedChangesDialog controller={controller} /></>;
}
