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
import { useClient } from '../frontend/client/hooks';

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

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useForm<T extends Row = Row>(
  options: UseFormOptions<T>,
): UseFormReturn<T> {
  const { schema, defaultValues, mode = 'create', editId, onSubmit, onSuccess, onError } = options;

  // Resolve collection — string name resolves via client.collection() (requires ClientProvider)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const client = useClient();
  const resolvedByName = typeof options.collection === 'string'
    ? client.collection<T>(options.collection)
    : null;
  const collection = resolvedByName ?? (typeof options.collection === 'object' ? options.collection : null);

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
      if (values[key] !== init[key]) return true;
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

  const validateAll = useCallback((): boolean => {
    const result = schema.validate(values);
    if (result.success) {
      setErrors({});
      return true;
    }
    const newErrors: Record<string, string> = {};
    for (const issue of result.issues) {
      const path = (issue as any).path?.[0]?.key as string | undefined;
      if (path && !newErrors[path]) {
        newErrors[path] = issue.message;
      }
    }
    setErrors(newErrors);
    return false;
  }, [schema, values]);

  const isValid = useMemo(() => {
    const result = schema.validate(values);
    return result.success;
  }, [schema, values]);

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

      if (!validateAll()) {
        // Focus first error field
        for (const name of schema.fieldNames) {
          if (errors[name]) {
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
    [isSubmitting, schema.fieldNames, validateAll, values, onSubmit, collection, mode, editId, onSuccess, onError, errors],
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
