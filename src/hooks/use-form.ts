/**
 * use-form.ts
 *
 * Owns Zero's headless React form state hook. It manages values, validation,
 * dirty state, and optional collection submit wiring; rendering remains in
 * form components and persistence policy remains in the SDK/collections.
 */

import {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  type FormEvent,
} from 'react';
import * as v from 'valibot';
import type { SchemaDescriptor } from '../schema/define-schema';
import type { FieldMeta } from '../schema/field-types';
import type { Row } from '../sync/types';
import type { Collection } from '../frontend/client/sdk';
import { useClientMaybe } from '../frontend/client/hooks';
import { areFormValuesEqual } from './form-value-utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UseFormOptions<T extends Row = Row> {
  schema: SchemaDescriptor;
  defaultValues?: Partial<T>;
  collection?: string | Collection<T>;
  mode?: 'create' | 'edit';
  editId?: string;
  onSubmit?: (data: T) => void | Promise<void>;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export interface FieldRegistration {
  name: string;
  value: unknown;
  onChange: (valueOrEvent: unknown) => void;
  onBlur: () => void;
  error?: string;
  ref: (el: HTMLElement | null) => void;
}

export interface UseFormReturn<T extends Row = Row> {
  register(name: string): FieldRegistration;
  handleSubmit(e?: FormEvent): Promise<void>;
  errors: Record<string, string>;
  isSubmitting: boolean;
  isDirty: boolean;
  isValid: boolean;
  reset(): void;
  setValue(name: string, value: unknown): void;
  watch(name: string): unknown;
  getValues(): T;
  getFieldMeta(name: string): FieldMeta | undefined;
  fieldNames: readonly string[];
}

/**
 * Manage schema-backed form state with optional collection create/update.
 *
 * A string `collection` resolves through `ClientProvider`; an object
 * collection or custom `onSubmit` can run without a client provider.
 */
export function useForm<T extends Row = Row>(
  options: UseFormOptions<T>,
): UseFormReturn<T> {
  const { schema, defaultValues, mode = 'create', editId, onSubmit, onSuccess, onError } = options;

  const client = useClientMaybe();
  const collection = useMemo((): Collection<T> | null => {
    if (typeof options.collection === 'string') {
      if (!client) {
        if (typeof window !== 'undefined') {
          throw new Error('useForm with collection name must be used within <AppProvider> or <ClientProvider>.');
        }

        return null;
      }

      return client.collection<T>(options.collection);
    }

    return options.collection ?? null;
  }, [client, options.collection]);

  const initialValues = useMemo(() => {
    const defaults = schema.decodeRow(schema.getDefaults());
    return schema.decodeRow({ ...defaults, ...defaultValues }) as Record<string, unknown>;
  }, [schema, defaultValues]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const initialRef = useRef(initialValues);
  const fieldRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  // ─── Edit mode: load existing row from collection ─────────────────
  useEffect(() => {
    if (mode === 'edit' && editId && collection) {
      const all = collection.getAll();
      const existing = all[editId];
      if (existing) {
        const loaded = schema.decodeRow({
          ...initialValues,
          ...(existing as Record<string, unknown>),
        });
        setValues(loaded);
        initialRef.current = loaded;
      }
    }
  }, [mode, editId, collection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Dirty check ────────────────────────────────────────────────────

  const isDirty = useMemo(() => {
    const init = initialRef.current;
    for (const key of schema.fieldNames) {
      if (!areFormValuesEqual(values[key], init[key])) return true;
    }
    return false;
  }, [values, schema.fieldNames]);

  // ─── Per-field validation ───────────────────────────────────────────

  const validateField = useCallback(
    (name: string, value: unknown): string | undefined => {
      const fieldSchema = schema.getFieldSchema(name);
      if (!fieldSchema) return undefined;
      const result = v.safeParse(fieldSchema, value);
      if (result.success) return undefined;
      return result.issues[0]?.message ?? 'Invalid value';
    },
    [schema],
  );

  // ─── Full validation ───────────────────────────────────────────────

  const collectValidationErrors = useCallback((candidateValues: Record<string, unknown>): Record<string, string> => {
    const result = schema.validate(candidateValues);
    if (result.success) {
      return {};
    }

    const newErrors: Record<string, string> = {};
    for (const issue of result.issues) {
      const path = (issue as any).path?.[0]?.key as string | undefined;
      if (path && !newErrors[path]) {
        newErrors[path] = issue.message;
      }
    }
    return newErrors;
  }, [schema]);

  const validateAll = useCallback((): Record<string, string> => {
    const newErrors = collectValidationErrors(values);
    setErrors(newErrors);
    return newErrors;
  }, [collectValidationErrors, values]);

  const isValid = useMemo(() => {
    return Object.keys(collectValidationErrors(values)).length === 0;
  }, [collectValidationErrors, values]);

  // ─── Register ───────────────────────────────────────────────────────

  const register = useCallback(
    (name: string): FieldRegistration => ({
      name,
      value: values[name] ?? '',
      onChange: (valueOrEvent: unknown) => {
        let newValue: unknown;
        if (
          valueOrEvent &&
          typeof valueOrEvent === 'object' &&
          'target' in (valueOrEvent as Record<string, unknown>)
        ) {
          const target = (valueOrEvent as any).target;
          if (target.type === 'checkbox') {
            newValue = target.checked;
          } else if (target.type === 'number') {
            newValue = target.value === '' ? '' : Number(target.value);
          } else {
            newValue = target.value;
          }
        } else {
          newValue = valueOrEvent;
        }
        setValues((prev) => ({ ...prev, [name]: newValue }));
        // Clear error on change
        if (errors[name]) {
          setErrors((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
          });
        }
      },
      onBlur: () => {
        setTouched((prev) => new Set(prev).add(name));
        const error = validateField(name, values[name]);
        if (error) {
          setErrors((prev) => ({ ...prev, [name]: error }));
        } else {
          setErrors((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
          });
        }
      },
      error: errors[name],
      ref: (el: HTMLElement | null) => {
        fieldRefs.current.set(name, el);
      },
    }),
    [values, errors, validateField],
  );

  // ─── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (isSubmitting) return;

      // Mark all fields as touched
      setTouched(new Set(schema.fieldNames));

      const validationErrors = validateAll();
      if (Object.keys(validationErrors).length > 0) {
        for (const name of schema.fieldNames) {
          if (validationErrors[name]) {
            fieldRefs.current.get(name)?.focus();
            break;
          }
        }
        return;
      }

      setIsSubmitting(true);
      try {
        const data = schema.encodeRow(values) as T;

        if (onSubmit) {
          await onSubmit(data);
        } else if (collection) {
          if (mode === 'edit' && editId) {
            const updateData = { ...data } as Record<string, unknown>;
            delete updateData[schema.primaryKey];
            collection.update(editId, updateData as Partial<T>);
          } else {
            collection.insert(data);
          }
        }

        onSuccess?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Submit failed';
        onError?.(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, schema, validateAll, values, onSubmit, collection, mode, editId, onSuccess, onError],
  );

  // ─── Utilities ──────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setValues(initialRef.current);
    setErrors({});
    setTouched(new Set());
    setIsSubmitting(false);
  }, []);

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const watch = useCallback(
    (name: string) => values[name],
    [values],
  );

  const getValues = useCallback(() => values as T, [values]);

  const getFieldMeta = useCallback(
    (name: string) => schema.fields.get(name),
    [schema],
  );

  return {
    register,
    handleSubmit,
    errors,
    isSubmitting,
    isDirty,
    isValid,
    reset,
    setValue,
    watch,
    getValues,
    getFieldMeta,
    fieldNames: schema.fieldNames,
  };
}
