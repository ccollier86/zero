'use client';

/**
 * Own-account property submission lifecycle. SDK calls retain Guardian authority;
 * this hook fences drafts/callbacks and reports partial/unknown outcomes rather
 * than retrying mutations or treating a follow-up read as an operation receipt.
 */
import * as React from 'react';
import { useAuth } from '../../frontend/client/auth-hooks';
import type { AuthUserPropertyConfig } from '../../frontend/client/auth-types';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { getAuthDisplayMessage, getAuthErrorCode } from './auth-error';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';
import { propertyFormSchema, UserPropertiesDraft, type PropertyFormValue } from './user-properties-draft';

// Retire at the React commit, not a later passive-effect turn in which an
// accepted response could dispatch the next field for an already removed form.
const useCommitEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/** Native form state; no custom submit path can bypass the SDK's authority fences. */
export function useUserPropertiesForm(fields: readonly AuthUserPropertyConfig[], onSuccess?: (properties: Record<string, string>) => void, configurationReady = true) {
  const client = useClientMaybe();
  const internal = client as InternalClient | null;
  const auth = useAuth();
  const boundary = useAuthorizationScopeBoundary(client);
  const ready = boundary.ready && configurationReady;
  const schema = propertyFormSchema(fields);
  const [, render] = React.useReducer(value => value + 1, 0);
  const holder = React.useMemo(() => ({
    draft: new UserPropertiesDraft(), mounted: false, busy: false,
    error: null as string | null, success: null as string | null,
    uncertain: false, run: null as object | null,
    schema, schemaRevision: 0,
  }), [client, boundary.key]);
  const current = React.useRef({ holder, ready, auth, fields, onSuccess });
  current.current = { holder, ready, auth, fields, onSuccess };
  if (configurationReady) {
    if (holder.schema !== schema) { holder.schema = schema; holder.schemaRevision++; }
    holder.draft.reconcile(fields, auth.user?.properties ?? {});
  }
  useCommitEffect(() => {
    holder.mounted = true;
    return () => { holder.mounted = false; holder.run = null; };
  }, [holder]);
  const liveKey = () => readAuthorizationScopeBoundaryKey(internal?.auth ?? null, internal?._authorizationDataBoundary?.revision ?? 0);
  const publish = () => { if (holder.mounted && current.current.holder === holder) render(); };

  async function submit() {
    // A ref-backed lock closes the rapid submit/Enter gap before React renders.
    if (!holder.mounted || holder.busy || holder.uncertain || !ready || !auth.user || !internal?.auth) return;
    let writes;
    try { writes = holder.draft.changes(); }
    catch (error) { holder.error = getAuthDisplayMessage(error, 'Check the changed settings.'); publish(); return; }
    if (!writes.length) return;
    const run = {}, capturedKey = liveKey(), schemaRevision = holder.schemaRevision;
    holder.run = run; holder.busy = true; holder.error = null; holder.success = null;
    holder.draft.begin(writes); publish();
    const sameOwner = () => holder.mounted && current.current.holder === holder && liveKey() === capturedKey;
    const lifecycleCurrent = () => sameOwner() && current.current.ready && holder.schemaRevision === schemaRevision;
    const isCurrent = () => lifecycleCurrent() && holder.run === run;
    const accepted: Record<string, string> = {};
    try {
      for (const write of writes) {
        if (!isCurrent()) return;
        await auth.setProperty(write.key, write.value);
        if (!isCurrent()) return;
        holder.draft.accept(write); accepted[write.key] = String(write.value); publish();
      }
      if (!isCurrent()) return;
      holder.success = holder.draft.dirty ? 'Submitted settings saved. You have newer unsaved changes.' : 'Settings updated.';
      const result = { ...current.current.auth.user?.properties, ...accepted };
      // Application notification is not part of the accepted persistence result.
      try {
        const notification = current.current.onSuccess?.(result);
        void Promise.resolve(notification).catch(() => {
          if (lifecycleCurrent()) reportPropertyFailure('userPropertiesAcceptedCallback', null);
        });
      } catch {
        if (lifecycleCurrent()) reportPropertyFailure('userPropertiesAcceptedCallback', null);
      }
    } catch (error) {
      const unknown = propertySaveOutcomeUnknown(error);
      // A schema/config refresh retires queued dispatch, not the possibility
      // that the already-issued write committed. Keep that uncertainty for
      // this same account/client/authority until an explicit current read.
      // A replaced owner or authorization family must receive nothing late.
      if (!sameOwner() || holder.run !== run || (!isCurrent() && !unknown)) return;
      holder.uncertain = unknown;
      const count = Object.keys(accepted).length;
      holder.error = `${count ? `${count} setting${count === 1 ? '' : 's'} saved. ` : ''}${holder.uncertain
        ? 'The last request outcome is unknown. Check the current saved settings before trying again.'
        : getAuthDisplayMessage(error, 'Some settings could not be saved. Your remaining changes are preserved.')}`;
      reportPropertyFailure('setUserProperties', error);
    } finally {
      if (holder.mounted && current.current.holder === holder && holder.run === run) {
        holder.run = null; holder.busy = false; holder.draft.finish(); publish();
      }
    }
  }

  async function reconcile() {
    if (!holder.mounted || holder.busy || !holder.uncertain || !ready) return;
    const run = {}, capturedKey = liveKey(), schemaRevision = holder.schemaRevision;
    holder.run = run; holder.busy = true; holder.draft.hold(); publish();
    const isCurrent = () => holder.mounted && current.current.holder === holder && holder.run === run
      && current.current.ready && holder.schemaRevision === schemaRevision && liveKey() === capturedKey;
    try {
      const properties = await auth.getProperties();
      if (!isCurrent()) return;
      holder.draft.reconcile(current.current.fields, properties);
      holder.uncertain = false;
      holder.error = 'The earlier request outcome is still unknown. Current settings have been checked. Review any remaining changes before saving.';
    } catch (error) {
      if (isCurrent()) { holder.error = 'Current settings could not be checked. No changes were retried.'; reportPropertyFailure('getUserProperties', error); }
    } finally {
      if (holder.mounted && current.current.holder === holder && holder.run === run) { holder.run = null; holder.busy = false; holder.draft.finish(); publish(); }
    }
  }

  return {
    value: (key: string) => holder.draft.value(key), dirty: holder.draft.dirty,
    edit(key: string, value: PropertyFormValue) { holder.draft.edit(key, value); if (!holder.uncertain) holder.error = null; holder.success = null; publish(); },
    submitting: holder.busy, reconciling: holder.busy && holder.uncertain, ready, authorizationReady: boundary.ready, error: holder.error, success: holder.success,
    uncertain: holder.uncertain, submit, reconcile,
  };
}

function reportPropertyFailure(action: string, error: unknown): void {
  // The sink receives stable codes only. A caller's faulty optional sink must
  // never change an accepted mutation into an unknown operation.
  try { reportAuthClientActionFailure(action, error, { codeOnly: true }); } catch { /* Optional observability cannot undo persistence. */ }
}

/** Unknown responses never authorize automatic replay of a possibly committed mutation. */
export function propertySaveOutcomeUnknown(error: unknown): boolean {
  const code = getAuthErrorCode(error);
  if (code && /OUTCOME_UNKNOWN|AUTH_STATE_CHANGED|AUTHORIZATION_CHANGED/.test(code)) return true;
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status: unknown }).status : undefined;
  return typeof status !== 'number' || status === 0 || status >= 500;
}
