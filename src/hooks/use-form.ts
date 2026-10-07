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
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary } from '../frontend/client/authorization-scope-hooks';
import type { InternalClient } from '../frontend/client/sdk';
import { areFormValuesEqual } from './form-value-utils';
import { copyFormValue, FormAcceptanceController, isFormRevisionConflict } from './form-acceptance-controller';
import type { FormRevision, FormSubmissionAcceptance, FormSubmissionSnapshot, FormSubmitContext,
  FormSubmitResult } from './form-save-types';
export type { FormRevision, FormSubmissionAcceptance, FormSubmissionSnapshot, FormSubmitContext,
  FormSubmitResult } from './form-save-types';
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
  onSubmit?: (data: T, context: FormSubmitContext) => void | FormSubmissionAcceptance<T>
    | Promise<void | FormSubmissionAcceptance<T>>;
  /** Opt in to advancing reset/dirty baseline only after acknowledged writes. */
  baseline?: 'initial' | 'accepted';
  /** Backend-owned revision captured in each submission; never auto-rebased on conflict. */
  initialRevision?: FormRevision;
  /** Additional application target fence, independent of Guardian identity. */
  scopeKey?: string | number;
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
  submit(): Promise<FormSubmitResult<T>>;
  /** Validate only declared draft fields before a separately acknowledged field mutation. */
  validateFields(fields?: readonly string[]): boolean;
  captureValues(fields?: readonly string[]): FormSubmissionSnapshot<T>;
  acceptValues(accepted: FormSubmissionAcceptance<T>, snapshot: FormSubmissionSnapshot<T>): boolean;
  readonly revision?: FormRevision;
  readonly submitError: string | null;
  readonly hasConflict: boolean;
  readonly dirtyFields: readonly string[];
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
  const effectiveBoundaryKey = JSON.stringify([authorizationBoundary.key, options.scopeKey ?? null, mode, editId ?? null]);
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
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [, setIsSubmitting] = useState(false);
  const submissionRef = useRef<{ readonly controller: AbortController } | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(effectiveBoundaryKey);
  const initialRef = useRef(copyFormValue(initialValues));
  const acceptanceRef = useRef<FormAcceptanceController | null>(null);
  if (!acceptanceRef.current) { acceptanceRef.current = new FormAcceptanceController(); acceptanceRef.current.reset(options.initialRevision); }
  const acceptance = acceptanceRef.current;
  const [, setBaselineVersion] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const conflictRef = useRef(false);
  const mounted = useRef(true);
  const fieldRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const currentScopeRef = useRef({ client, scopeKey: options.scopeKey, mode, editId });
  currentScopeRef.current = { client, scopeKey: options.scopeKey, mode, editId };
  const callbackBoundaryKey = effectiveBoundaryKey;
  const readBoundary = useCallback(() => {
    const current = currentScopeRef.current;
    const internal = current.client as InternalClient | null;
    const auth = internal?.auth ?? null, revision = internal?._authorizationDataBoundary?.revision ?? 0;
    return { key: JSON.stringify([readAuthorizationScopeBoundaryKey(auth, revision), current.scopeKey ?? null, current.mode, current.editId ?? null]),
      ready: !auth || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
        && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated) };
  }, []);
  const isCurrentScope = useCallback(
    () => { const boundary = readBoundary(); return mounted.current && boundary.ready && boundary.key === callbackBoundaryKey; },
    [callbackBoundaryKey, readBoundary],
  );
  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === effectiveBoundaryKey;
  const visibleValues = visible ? values : initialValues;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; submissionRef.current?.controller.abort(); submissionRef.current = null; acceptance.reset(); };
  }, [acceptance]);

  useEffect(() => {
    submissionRef.current?.controller.abort();
    setLoadedBoundaryKey(effectiveBoundaryKey);
    initialRef.current = copyFormValue(initialValues);
    valuesRef.current = initialValues;
    setValues(initialValues);
    acceptance.reset(options.initialRevision);
    setBaselineVersion(version => version + 1);
    setSubmitError(null); conflictRef.current = false; setHasConflict(false);
    setErrors({});
    setTouched(new Set());
    setIsSubmitting(false);
    submissionRef.current = null;
  }, [effectiveBoundaryKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
        valuesRef.current = loaded;
        initialRef.current = copyFormValue(loaded);
        acceptance.reset(options.initialRevision);
        setBaselineVersion(version => version + 1);
      }
    }
  }, [
    effectiveBoundaryKey,
    authorizationBoundary.ready,
    mode,
    editId,
    collection,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Dirty check ────────────────────────────────────────────────────

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
        acceptance.edited(name);
        valuesRef.current = { ...valuesRef.current, [name]: newValue };
        setValues(valuesRef.current);
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
    [acceptance, errors, isCurrentScope, validateField, visible, visibleValues],
  );

  // ─── Submit ─────────────────────────────────────────────────────────

  const captureValues = useCallback((fields: readonly string[] = fieldNames): FormSubmissionSnapshot<T> => {
    const allowed = new Set(fieldNames);
    if (fields.some(field => !allowed.has(field)) || new Set(fields).size !== fields.length) {
      throw new Error('Form snapshots require unique declared fields.');
    }
    return acceptance.capture(isCurrentScope() ? valuesRef.current : {}, isCurrentScope() ? fields : []) as FormSubmissionSnapshot<T>;
  }, [acceptance, fieldNames, isCurrentScope]);

  const validateFields = useCallback((fields: readonly string[] = fieldNames): boolean => {
    const allowed = new Set(fieldNames);
    if (fields.some(field => !allowed.has(field)) || new Set(fields).size !== fields.length) {
      throw new Error('Form validation requires unique declared fields.');
    }
    if (!isCurrentScope()) return false;
    const invalid = Object.fromEntries(fields.flatMap(field => {
      const error = validateField(field, valuesRef.current[field]);
      return error ? [[field, error]] : [];
    }));
    setTouched(previous => new Set([...previous, ...fields]));
    setErrors(previous => ({ ...Object.fromEntries(Object.entries(previous).filter(([field]) => !fields.includes(field))), ...invalid }));
    const first = fields.find(field => invalid[field]);
    if (first) fieldRefs.current.get(first)?.focus();
    return first === undefined;
  }, [fieldNames, isCurrentScope, validateField]);

  const acceptValues = useCallback((accepted: FormSubmissionAcceptance<T>, snapshot: FormSubmissionSnapshot<T>): boolean => {
    if (!isCurrentScope()) return false;
    const submitted = acceptance.read(snapshot);
    if (!submitted) return false;
    const canonical = accepted.values === undefined ? submitted
      : schema.decodeRow({ ...schema.encodeRow(submitted), ...accepted.values });
    const patch = acceptance.accept(snapshot, canonical, accepted.revision);
    if (!patch) return false;
    initialRef.current = { ...initialRef.current, ...patch.baseline };
    valuesRef.current = { ...valuesRef.current, ...patch.draft };
    setValues(valuesRef.current);
    setBaselineVersion(version => version + 1);
    setSubmitError(null); conflictRef.current = false; setHasConflict(false);
    setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([field]) => !snapshot.fields.includes(field))));
    return true;
  }, [acceptance, isCurrentScope, schema]);

  const submit = useCallback(
    async (): Promise<FormSubmitResult<T>> => {
      if (!visible || !isCurrentScope()) return { kind: 'retired' };
      if (options.baseline === 'accepted' && conflictRef.current) return { kind: 'failed', conflict: true,
        error: 'These settings changed elsewhere. Your draft is preserved. Reload and review before saving.' };
      if (submissionRef.current !== null) return { kind: 'blocked' };
      if (!onSubmit && !collection) return { kind: 'blocked' };
      const operationIsCurrent = isCurrentScope;

      // Mark all fields as touched
      setTouched(new Set(fieldNames));

      const validationErrors = collectValidationErrors(valuesRef.current);
      setErrors(validationErrors);
      if (Object.keys(validationErrors).length > 0) {
        for (const name of fieldNames) {
          if (validationErrors[name]) {
            fieldRefs.current.get(name)?.focus();
            break;
          }
        }
        return { kind: 'invalid', errors: validationErrors };
      }

      const snapshot = captureValues();
      const submission = { controller: new AbortController() };
      submissionRef.current = submission;
      setIsSubmitting(true);
      setSubmitError(null); conflictRef.current = false; setHasConflict(false);
      try {
        const data = schema.encodeRow(
          options.includeFields === undefined
            ? snapshot.values
            : pickFormFields(snapshot.values, fieldNames),
        ) as T;

        let accepted: void | FormSubmissionAcceptance<T> = undefined;
        if (onSubmit) {
          accepted = await onSubmit(data, { signal: submission.controller.signal, expectedRevision: snapshot.expectedRevision });
        } else if (collection) {
          if (mode === 'edit' && editId) {
            const updateData = { ...data } as Record<string, unknown>;
            delete updateData[schema.primaryKey];
            await collection.updateAsync(editId, updateData as Partial<T>);
          } else {
            await collection.insertAsync(data);
          }
        }

        if (!operationIsCurrent() || submission.controller.signal.aborted) return { kind: 'retired' };
        const acknowledgment = accepted || {};
        const acceptedValues = (acknowledgment.values === undefined ? acceptance.read(snapshot)
          : schema.decodeRow({ ...schema.encodeRow(snapshot.values), ...acknowledgment.values })) as T;
        if (options.baseline === 'accepted') acceptValues(acknowledgment, snapshot);
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
        if (!operationIsCurrent()) return { kind: 'retired' };
        return { kind: 'accepted', values: copyFormValue(acceptedValues), revision: acknowledgment.revision ?? snapshot.expectedRevision };
      } catch (err) {
        if (!operationIsCurrent() || submission.controller.signal.aborted) return { kind: 'retired' };
        const message = err instanceof Error ? err.message : 'Submit failed';
        const conflict = isFormRevisionConflict(err);
        const safeError = conflict ? 'These settings changed elsewhere. Your draft is preserved. Reload and review before saving.'
          : 'These changes could not be saved. Please try again.';
        setSubmitError(safeError); conflictRef.current = conflict; setHasConflict(conflict);
        emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, { metadata: { surface: 'use-form', stage: conflict ? 'conflict' : 'submit' } });
        try { await onError?.(message); }
        catch { if (operationIsCurrent()) emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, { metadata: { surface: 'use-form', stage: 'error-callback' } }); }
        return operationIsCurrent() ? { kind: 'failed', error: safeError, conflict } : { kind: 'retired' };
      } finally {
        if (submissionRef.current === submission) submissionRef.current = null;
        if (operationIsCurrent()) setIsSubmitting(false);
      }
    },
    [
      acceptance,
      acceptValues,
      captureValues,
      collectValidationErrors,
      collection,
      editId,
      fieldNames,
      isCurrentScope,
      mode,
      onError,
      onSubmit,
      onSuccess,
      options.includeFields,
      options.baseline,
      schema,
      visible,
    ],
  );
  const handleSubmit = useCallback(async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    // Existing validation-only forms keep their notification contract. The new
    // submit() API remains blocked without persistence, so a save/leave guard
    // cannot mistake validation alone for a durable acknowledgment.
    if (!onSubmit && !collection && options.baseline !== 'accepted') {
      if (!isCurrentScope() || submissionRef.current) return;
      const invalid = collectValidationErrors(valuesRef.current); setErrors(invalid); setTouched(new Set(fieldNames));
      if (Object.keys(invalid).length) return;
      try { await onSuccess?.(); }
      catch { if (isCurrentScope()) emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, { metadata: { surface: 'use-form', stage: 'accepted-callback' } }); }
      return;
    }
    await submit();
  }, [collectValidationErrors, collection, fieldNames, isCurrentScope, onSubmit, onSuccess, options.baseline, submit]);

  // ─── Utilities ──────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (!isCurrentScope() || submissionRef.current) return;
    for (const field of fieldNames) acceptance.edited(field);
    valuesRef.current = copyFormValue(initialRef.current);
    setValues(valuesRef.current);
    setErrors({});
    setTouched(new Set());
    setIsSubmitting(false);
    setSubmitError(null); conflictRef.current = false; setHasConflict(false);
  }, [acceptance, fieldNames, isCurrentScope]);

  const setValue = useCallback((name: string, value: unknown) => {
    if (!isCurrentScope()) return;
    if (!fieldNames.includes(name)) throw new Error('Form edits require a declared field.');
    acceptance.edited(name);
    valuesRef.current = { ...valuesRef.current, [name]: value };
    setValues(valuesRef.current);
  }, [acceptance, fieldNames, isCurrentScope]);

  const watch = useCallback(
    (name: string) => isCurrentScope() ? valuesRef.current[name] : undefined,
    [isCurrentScope],
  );

  const getValues = useCallback(
    () => copyFormValue(isCurrentScope() ? valuesRef.current : initialValues) as T,
    [initialValues, isCurrentScope],
  );

  const getFieldMeta = useCallback(
    (name: string) => schema.fields.get(name),
    [schema],
  );

  return {
    register,
    handleSubmit,
    submit,
    validateFields,
    captureValues,
    acceptValues,
    revision: visible ? acceptance.revision : undefined,
    submitError: visible ? submitError : null,
    hasConflict: visible && hasConflict,
    get dirtyFields() { return isCurrentScope() ? fieldNames.filter(field => !areFormValuesEqual(valuesRef.current[field], initialRef.current[field])) : []; },
    errors: visible ? errors : {},
    get isSubmitting() { return visible && isCurrentScope() && submissionRef.current !== null; },
    get isDirty() { return visible && isCurrentScope() && fieldNames.some(field => !areFormValuesEqual(valuesRef.current[field], initialRef.current[field])); },
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
