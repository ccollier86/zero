'use client';

/**
 * Projects existing acknowledged form/save controllers into an owned modal.
 * No transport, validation engine, inferred persistence, or native unload replacement.
 */
import { useCallback, useEffect, useRef, type FormEvent } from 'react';
import type { Row } from '../sync/types';
import type { UseFormReturn } from '../hooks/use-form';
import type { UseFormSaveReturn } from '../hooks/use-form-save';
import type { FormSubmitResult } from '../hooks/form-save-types';
import type { ModalContext } from './modal-system.types';
import type { ModalCloseContext } from './modal.types';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';
import { modals } from './modal-events';

type FormState = Pick<UseFormReturn<Row>, 'boundaryKey' | 'isDirty' | 'isSubmitting' | 'submitError'>;
interface Contribution { readonly dirty: boolean; readonly busy: boolean; readonly error: string | null }
interface Aggregate {
  readonly parts: Map<object, Contribution>;
  published?: Contribution;
}
const aggregates = new WeakMap<ModalContext<unknown>, Aggregate>();

/** Internal exact-owner aggregation; unmounting one tab cannot clear another form's flags. */
export function bindModalFormState(context: ModalContext<unknown>) {
  let aggregate = aggregates.get(context);
  if (!aggregate) { aggregate = { parts: new Map() }; aggregates.set(context, aggregate); }
  const token = {}, owned = aggregate;
  let disposed = false;
  const publish = () => {
    if (context.signal.aborted) return;
    const values = [...owned.parts.values()];
    const next: Contribution = { dirty: values.some(value => value.dirty), busy: values.some(value => value.busy),
      error: values.find(value => value.error !== null)?.error ?? null };
    if (owned.published?.dirty !== next.dirty) context.setDirty(next.dirty);
    // The kernel's setBusy keeps actionPending authoritative, including false
    // from the last form contributor; a binding never unlocks an active action.
    if (owned.published?.busy !== next.busy) context.setBusy(next.busy);
    if (owned.published?.error !== next.error) context.setError(next.error);
    owned.published = next;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; context.signal.removeEventListener('abort', dispose);
    owned.parts.delete(token); publish();
  };
  context.signal.addEventListener('abort', dispose, { once: true });
  if (context.signal.aborted) dispose();
  return { update(state: Contribution) { if (!disposed) { owned.parts.set(token, state); publish(); } }, dispose };
}

/** Exact modal-close cancellation never cancels a separately admitted save acknowledgment. */
export function createModalFormGuard(save: Pick<UseFormSaveReturn, 'requestLeave'>) {
  return ({ signal }: ModalCloseContext): Promise<boolean> => signal.aborted ? Promise.resolve(false)
    : save.requestLeave(() => {}, { signal });
}

/** Use the existing form's typed submit(), never legacy void handleSubmit() as acceptance. */
export interface UseModalFormOptions<T extends Row = Row> {
  readonly context: ModalContext<T>;
  readonly form: FormState & Pick<UseFormReturn<T>, 'submit'>;
  readonly save?: Pick<UseFormSaveReturn, 'save' | 'requestLeave' | 'isSaving' | 'error'>;
}

/** Returns native submit and action adapters; only acknowledged, current, clean writes accept the modal. */
export function useModalForm<T extends Row = Row>({ context, form, save }: UseModalFormOptions<T>) {
  const latest = useRef({ form, save }); latest.current = { form, save };
  const registration = useRef<ReturnType<typeof bindModalFormState> | null>(null);
  const dirty = form.isDirty, busy = form.isSubmitting || save?.isSaving === true;
  const error = save?.error ?? form.submitError;
  useEffect(() => {
    const binding = bindModalFormState(context as unknown as ModalContext<unknown>);
    registration.current = binding;
    return () => { binding.dispose(); if (registration.current === binding) registration.current = null; };
  }, [context]);
  useEffect(() => { registration.current?.update({ dirty, busy, error }); }, [busy, context, dirty, error]);
  const requestLeave = save?.requestLeave;
  useEffect(() => {
    if (!requestLeave) return;
    return modals.bindBeforeClose(context.id, context.signal, close => {
      const current = latest.current.save;
      return current ? createModalFormGuard(current)(close) : Promise.resolve(true);
    });
  }, [context, requestLeave]);

  const submit = useCallback(async (): Promise<FormSubmitResult<T>> => {
    const current = latest.current, boundary = current.form.boundaryKey;
    if (context.signal.aborted) return { kind: 'retired' };
    const isCurrent = () => !context.signal.aborted && latest.current.form.boundaryKey === boundary;
    try {
      const result = await (current.save ? current.save.save() : current.form.submit()) as FormSubmitResult<T>;
      if (!isCurrent()) return { kind: 'retired' };
      if (result.kind === 'accepted' && !latest.current.form.isDirty) context.accept(result.values);
      return result;
    } catch {
      if (!isCurrent()) return { kind: 'retired' };
      const safeError = 'These changes could not be saved. Please try again.';
      context.setError(safeError);
      emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'modal-form', stage: 'submit' } });
      return { kind: 'failed', error: safeError, conflict: false };
    }
  }, [context]);
  const onSubmit = useCallback((event: FormEvent) => {
    // React portals preserve event ancestry. A child form must never invoke
    // its parent's shell submit adapter as well as its own acknowledged writer.
    event.preventDefault(); event.stopPropagation(); void submit();
  }, [submit]);
  const action = useCallback(async () => { await submit(); return false as const; }, [submit]);
  return { submit, onSubmit, action, isDirty: dirty, isBusy: busy, error,
    beforeClose: save ? createModalFormGuard(save) : undefined };
}
