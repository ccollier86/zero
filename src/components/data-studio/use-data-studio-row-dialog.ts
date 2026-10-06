'use client';

/**
 * use-data-studio-row-dialog.ts
 *
 * Owns one create-record session's draft, close confirmation and awaited write
 * lifecycle. Application callbacks own persistence/idempotency; this hook fences
 * stale UI completions and never emits submitted values or callback exceptions.
 */
import * as React from 'react';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import { reportDataStudioFrontendFailure } from '../../frontend/client/data-studio-observability';
import type { DataStudioRowDialogProps } from './data-studio-row-dialog.types';
import { buildDataStudioRowDraft, createDataStudioRowOpening, dataStudioRowSchemaKey,
  isDataStudioRowDraftDirty, updateDataStudioRowDraft, type DataStudioRowDraft } from './data-studio-row-draft';
import { dataStudioRowCreateFailure } from './data-studio-row-dialog-error';

type CloseConfirmation = 'discard' | 'reload' | null;

/** One mounted table/scope lifetime; schema changes require an explicit reload, not silent remapping. */
export function useDataStudioRowDialog(props: DataStudioRowDialogProps & { isOwnerCurrent(): boolean }) {
  const [opening, setOpening] = React.useState(() => createDataStudioRowOpening(props.table!));
  const openingRef = React.useRef(opening); openingRef.current = opening;
  const [draft, setDraft] = React.useState<DataStudioRowDraft>(opening.initial);
  const draftRef = React.useRef(draft); draftRef.current = draft;
  const [fieldErrors, setFieldErrors] = React.useState<Readonly<Record<string, string>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false), [accepted, setAccepted] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false), [confirmation, setConfirmation] = React.useState<CloseConfirmation>(null);
  const mounted = React.useRef(true), inFlight = React.useRef(false), acceptedRef = React.useRef(false);
  const uncertainRef = React.useRef(false), lastInput = React.useRef<Readonly<Record<string, unknown>> | null>(null);
  const current = React.useRef(props); current.current = props;
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const schemaChanged = !props.table || dataStudioRowSchemaKey(props.table) !== opening.schemaKey;
  const archived = props.table?.status === 'archived';
  const dirty = isDataStudioRowDraftDirty(opening, draft);
  const blocked = Boolean(props.busy) || pending || accepted || schemaChanged || archived;
  const fieldsBlocked = blocked || uncertain;
  const ownsSession = () => mounted.current && current.current.open && current.current.isOwnerCurrent();
  const matchesSchema = () => ownsSession() && current.current.table?.tableId === openingRef.current.tableId
    && dataStudioRowSchemaKey(current.current.table) === openingRef.current.schemaKey;

  const report = (stage: string) => {
    if (ownsSession()) emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED,
      { metadata: { surface: 'row-dialog', stage } });
  };
  const notifyClose = () => {
    if (!ownsSession()) return;
    try {
      const result: unknown = current.current.onOpenChange(false);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => report('close'));
    } catch { report('close'); }
  };
  const focusField = (columnId?: string) => {
    const fields = formRef.current?.querySelectorAll<HTMLElement>('[data-slot="data-studio-row-field"]');
    const field = Array.from(fields ?? []).find(item => !columnId || item.dataset.columnId === columnId);
    const input = field?.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),button[role="combobox"]:not(:disabled)');
    (input ?? formRef.current?.closest<HTMLElement>('[data-slot="data-studio-row-dialog"]'))?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: 'nearest' });
  };
  const changeField = (columnId: string, raw: string) => {
    if (!ownsSession() || current.current.busy || inFlight.current || acceptedRef.current || uncertainRef.current || !matchesSchema()
      || current.current.table?.status !== 'active' || !Object.hasOwn(draftRef.current, columnId)) return;
    const next = updateDataStudioRowDraft(draftRef.current, columnId, raw);
    draftRef.current = next; setDraft(next);
    setFieldErrors(previous => { const nextErrors = { ...previous }; delete nextErrors[columnId]; return nextErrors; });
    setError(null);
  };
  const requestClose = () => {
    if (!ownsSession() || current.current.busy || inFlight.current) return;
    if (!acceptedRef.current && (isDataStudioRowDraftDirty(openingRef.current, draftRef.current) || uncertainRef.current)) {
      setConfirmation('discard');
    } else notifyClose();
  };
  const reload = () => {
    if (!ownsSession() || current.current.busy || inFlight.current || !current.current.table || uncertainRef.current) return;
    const next = createDataStudioRowOpening(current.current.table);
    openingRef.current = next; draftRef.current = next.initial;
    setOpening(next); setDraft(next.initial); setFieldErrors({}); setError(null); setConfirmation(null);
    requestAnimationFrame(() => { if (ownsSession()) focusField(); });
  };
  const requestReload = () => {
    if (!ownsSession() || current.current.busy || inFlight.current || uncertainRef.current) return;
    if (isDataStudioRowDraftDirty(openingRef.current, draftRef.current)) setConfirmation('reload'); else reload();
  };
  const discard = () => {
    if (!ownsSession() || current.current.busy || inFlight.current) return;
    if (confirmation === 'reload') reload(); else notifyClose();
  };
  const save = async () => {
    if (!matchesSchema() || current.current.busy || inFlight.current || acceptedRef.current || current.current.table?.status !== 'active') return;
    const admitted = uncertainRef.current && lastInput.current
      ? { values: lastInput.current, errors: {}, error: null }
      : buildDataStudioRowDraft(openingRef.current, draftRef.current);
    setFieldErrors(admitted.errors); setError(admitted.error);
    if (!admitted.values) {
      const first = openingRef.current.schema.columns.find(column => Object.hasOwn(admitted.errors, column.columnId));
      requestAnimationFrame(() => { if (ownsSession()) focusField(first?.columnId); }); return;
    }
    const owner = openingRef.current;
    const stillCurrent = () => matchesSchema() && openingRef.current === owner;
    const onCreate = current.current.onCreate;
    const values = admitted.values;
    lastInput.current = values; inFlight.current = true; setPending(true); setConfirmation(null);
    try {
      await onCreate(values);
      if (!stillCurrent()) return;
      acceptedRef.current = true; uncertainRef.current = false; setAccepted(true); setUncertain(false); setError(null);
      notifyClose();
    } catch (cause) {
      if (!stillCurrent()) return;
      const failure = dataStudioRowCreateFailure(cause);
      uncertainRef.current = failure.uncertain; setUncertain(failure.uncertain); setError(failure.message);
      reportDataStudioFrontendFailure('row.create', 'mutation', cause);
    } finally {
      inFlight.current = false;
      if (ownsSession()) setPending(false);
    }
  };
  return { opening, draft, fieldErrors, error, pending, accepted, uncertain, confirmation, dirty, blocked, fieldsBlocked,
    schemaChanged, archived, formRef, focusField, changeField, requestClose, requestReload, discard, save,
    keepEditing: () => { if (ownsSession() && !current.current.busy && !inFlight.current) setConfirmation(null); } };
}
