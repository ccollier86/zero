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
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../frontend/client/authorization-scope-hooks';
import { areFormValuesEqual } from './form-value-utils';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UseFormOptions<T extends Row = Row> {
  schema: SchemaDescriptor;
  defaultValues?: Partial<T>;
  collection?: string | Collection<T>;
  mode?: 'create' | 'edit';
  editId?: string;
  /** Optional field allow-list for generated forms and submitted payloads. */
  includeFields?: readonly string[];
  onSubmit?: (data: T) => void | Promise<void>;
  /** Called after custom submission resolves or a collection write is acknowledged. */
  onSuccess?: () => void;
  /** Called when custom submission or an acknowledged collection write fails. */
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
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
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

  const fieldNames = useMemo(() => {
    if (options.includeFields === undefined) return schema.fieldNames;
    const known = new Set(schema.fieldNames);
    const seen = new Set<string>();
    const included: string[] = [];
    for (const field of options.includeFields) {
      if (!known.has(field)) {
        throw new Error(`Form field allow-list references unknown schema field '${field}'.`);
      }
      if (seen.has(field)) continue;
      seen.add(field);
      included.push(field);
    }
    return included;
  }, [options.includeFields, schema.fieldNames]);

  const initialValues = useMemo(() => {
    const defaults = schema.decodeRow(schema.getDefaults());
    const decoded = schema.decodeRow({ ...defaults, ...defaultValues });
    if (options.includeFields === undefined) return decoded;
    return Object.fromEntries(
      fieldNames
        .filter((field) => Object.prototype.hasOwnProperty.call(decoded, field))
        .map((field) => [field, decoded[field]]),
    );
  }, [schema, defaultValues, fieldNames, options.includeFields]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionRef = useRef<object | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const initialRef = useRef(initialValues);
  const fieldRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const isCurrentScope = useCallback(
    () => isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    ),
    [callbackBoundaryKey],
  );
  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  const visibleValues = visible ? values : initialValues;

  useEffect(() => {
    setLoadedBoundaryKey(authorizationBoundary.key);
    initialRef.current = initialValues;
    setValues(initialValues);
    setErrors({});
    setTouched(new Set());
    setIsSubmitting(false);
    submissionRef.current = null;
  }, [authorizationBoundary.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Edit mode: load existing row from collection ─────────────────
  useEffect(() => {
    if (authorizationBoundary.ready
      && mode === 'edit'
      && editId
      && collection) {
      const all = collection.getAll();
      const existing = all[editId];
      if (existing) {
        const decoded = schema.decodeRow({
          ...initialValues,
          ...(existing as Record<string, unknown>),
        });
        const loaded = options.includeFields === undefined
          ? decoded
          : pickFormFields(decoded, fieldNames);
        setValues(loaded);
        initialRef.current = loaded;
      }
    }
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    mode,
    editId,
    collection,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Dirty check ────────────────────────────────────────────────────

  const isDirty = useMemo(() => {
    if (!visible) return false;
    const init = initialRef.current;
    for (const key of fieldNames) {
      if (!areFormValuesEqual(visibleValues[key], init[key])) return true;
    }
    return false;
  }, [fieldNames, visible, visibleValues]);

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
    if (options.includeFields !== undefined) {
      const fieldErrors: Record<string, string> = {};
      for (const field of fieldNames) {
        const error = validateField(field, candidateValues[field]);
        if (error) fieldErrors[field] = error;
      }
      return fieldErrors;
    }
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
  }, [fieldNames, options.includeFields, schema, validateField]);

  const validateAll = useCallback((): Record<string, string> => {
    const newErrors = collectValidationErrors(visibleValues);
    if (isCurrentScope()) setErrors(newErrors);
    return newErrors;
  }, [collectValidationErrors, isCurrentScope, visibleValues]);

  const isValid = useMemo(() => {
    return visible && Object.keys(collectValidationErrors(visibleValues)).length === 0;
  }, [collectValidationErrors, visible, visibleValues]);

  // ─── Register ───────────────────────────────────────────────────────

  const register = useCallback(
    (name: string): FieldRegistration => ({
      name,
      value: visibleValues[name] ?? '',
      onChange: (valueOrEvent: unknown) => {
        if (!isCurrentScope()) return;
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
            newValue = target.value === ''
              ? schema.fields.get(name)?.required === false ? null : ''
              : Number(target.value);
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
        if (!isCurrentScope()) return;
        setTouched((prev) => new Set(prev).add(name));
        const error = validateField(name, visibleValues[name]);
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
      error: visible ? errors[name] : undefined,
      ref: (el: HTMLElement | null) => {
        fieldRefs.current.set(name, el);
      },
    }),
    [errors, isCurrentScope, validateField, visible, visibleValues],
  );

  // ─── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!isCurrentScope() || submissionRef.current !== null) return;
      const operationBoundaryKey = callbackBoundaryKey;
      const operationIsCurrent = () => isAuthorizationScopeCallbackCurrent(
        boundaryKeyRef.current,
        boundaryReadyRef.current,
        operationBoundaryKey,
      );

      // Mark all fields as touched
      setTouched(new Set(fieldNames));

      const validationErrors = validateAll();
      if (Object.keys(validationErrors).length > 0) {
        for (const name of fieldNames) {
          if (validationErrors[name]) {
            fieldRefs.current.get(name)?.focus();
            break;
          }
        }
        return;
      }

      const submission = {};
      submissionRef.current = submission;
      setIsSubmitting(true);
      try {
        const data = schema.encodeRow(
          options.includeFields === undefined
            ? visibleValues
            : pickFormFields(visibleValues, fieldNames),
        ) as T;

        if (onSubmit) {
          await onSubmit(data);
        } else if (collection) {
          if (mode === 'edit' && editId) {
            const updateData = { ...data } as Record<string, unknown>;
            delete updateData[schema.primaryKey];
            await collection.updateAsync(editId, updateData as Partial<T>);
          } else {
            await collection.insertAsync(data);
          }
        }

        if (operationIsCurrent()) {
          try {
            await onSuccess?.();
          } catch {
            // This notification failed after the write was accepted. Sending
            // it to onError would misclassify the write and invite a duplicate
            // retry. Keep standard observability value-free and scope-fenced.
            if (operationIsCurrent()) emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
              metadata: { surface: 'use-form', stage: 'accepted-callback' },
            });
          }
        }
      } catch (err) {
        if (!operationIsCurrent()) return;
        const message = err instanceof Error ? err.message : 'Submit failed';
        onError?.(message);
      } finally {
        if (submissionRef.current === submission) submissionRef.current = null;
        if (operationIsCurrent()) setIsSubmitting(false);
      }
    },
    [
      callbackBoundaryKey,
      collection,
      editId,
      fieldNames,
      isCurrentScope,
      mode,
      onError,
      onSubmit,
      onSuccess,
      options.includeFields,
      schema,
      validateAll,
      visibleValues,
    ],
  );

  // ─── Utilities ──────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (!isCurrentScope()) return;
    setValues(initialRef.current);
    setErrors({});
    setTouched(new Set());
    setIsSubmitting(false);
  }, [isCurrentScope]);

  const setValue = useCallback((name: string, value: unknown) => {
    if (!isCurrentScope()) return;
    setValues((prev) => ({ ...prev, [name]: value }));
  }, [isCurrentScope]);

  const watch = useCallback(
    (name: string) => isCurrentScope() ? visibleValues[name] : undefined,
    [isCurrentScope, visibleValues],
  );

  const getValues = useCallback(
    () => (isCurrentScope() ? visibleValues : initialValues) as T,
    [initialValues, isCurrentScope, visibleValues],
  );

  const getFieldMeta = useCallback(
    (name: string) => schema.fields.get(name),
    [schema],
  );

  return {
    register,
    handleSubmit,
    errors: visible ? errors : {},
    isSubmitting: visible && isSubmitting,
    isDirty,
    isValid,
    reset,
    setValue,
    watch,
    getValues,
    getFieldMeta,
    fieldNames,
  };
}

function pickFormFields(
  values: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(values, field))
      .map((field) => [field, values[field]]),
  );
}
