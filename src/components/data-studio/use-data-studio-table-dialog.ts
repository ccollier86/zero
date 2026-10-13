'use client';

/** One mounted editing session owns its opening revision, local draft and awaited save lifecycle. */
import * as React from 'react';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';
import type { JsonEditorHandle } from '../json-editor';
import { buildDataStudioSchema, normalizeDataStudioKey } from './data-studio-schema-draft';
import { parseDataStudioSchemaCode } from './data-studio-schema-code';
import { useDataStudioSchemaDraft } from './use-data-studio-schema-draft';
import { dataStudioDialogErrorMessage } from './data-studio-dialog-field';
import { dataStudioTableOpeningDraft, dataStudioDraftSignature, dataStudioSchemaImpact, dataStudioUiColumnLimit } from './data-studio-table-draft';
import type { DataStudioTableDialogProps } from './data-studio-table-dialog.types';
import type { ModalCloseReason } from '../../modals/modal-system.types';

export function useDataStudioTableDialog(props: DataStudioTableDialogProps) {
  const [opening] = React.useState(() => ({ table: props.table, initial: dataStudioTableOpeningDraft(props.table, props.startWithNewColumn, props.maxColumns) }));
  const [name, setName] = React.useState(opening.initial.name), [key, setKey] = React.useState(opening.initial.key);
  const [description, setDescription] = React.useState(opening.initial.description);
  const schema = useDataStudioSchemaDraft(opening.initial.columns);
  const jsonEditorRef = React.useRef<JsonEditorHandle<unknown>>(null);
  const [pending, setPending] = React.useState(false), [error, setError] = React.useState<string | null>(null);
  const [accepted, setAccepted] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false), [impact, setImpact] = React.useState<string[]>([]);
  const mounted = React.useRef(true), inFlight = React.useRef(false), acceptedRef = React.useRef(false), current = React.useRef(props);
  current.current = props;
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => {
    if (props.startWithNewColumn) schema.selectColumn(opening.initial.columns.at(-1)?.columnId ?? null);
  }, []);
  const [initialSchema] = React.useState(() => opening.table?.schema ?? buildDataStudioSchema(opening.initial.columns));
  let candidate: unknown;
  try {
    if (schema.mode === 'json') {
      const parsed = parseDataStudioSchemaCode(schema.code);
      candidate = parsed.ok ? parsed.schema : schema.code;
    } else candidate = buildDataStudioSchema(schema.columns);
  } catch { candidate = schema.columns; }
  const initialSignature = dataStudioDraftSignature(opening.initial.name, opening.initial.key, opening.initial.description, initialSchema);
  const dirty = schema.jsonEditing || dataStudioDraftSignature(name, key, description, candidate) !== initialSignature;
  const blocked = Boolean(props.busy) || pending;
  // Admission only. ControlledModal reflects the owner's state after managed
  // settlement; changing open here would retire the shell before its exit.
  const requestClose = (close: { readonly reason: ModalCloseReason }) => {
    if (!mounted.current || !current.current.open || current.current.busy || inFlight.current) return false;
    // In the confirmation footer the only cancel action is explicit Discard.
    // X/Escape/backdrop continue to preserve the dirty draft.
    if (confirmClose && close.reason === 'cancel') return true;
    if (dirty && !acceptedRef.current) { setConfirmClose(true); setImpact([]); return false; }
    return true;
  };
  const save = async (confirmed = false) => {
    if (!mounted.current || !current.current.open || current.current.busy || inFlight.current || acceptedRef.current) return false;
    setError(null);
    let jsonCandidate: unknown;
    if (schema.mode === 'json') {
      const result = jsonEditorRef.current?.commit();
      if (!result?.ok) { setError(result?.error ?? 'Finish the open JSON edit.'); return false; }
      jsonCandidate = result.value;
    }
    const admitted = schema.readSchema(jsonCandidate);
    if (!admitted) return false;
    if (admitted.columns.length > dataStudioUiColumnLimit(current.current.maxColumns)) {
      setError(`This application allows at most ${dataStudioUiColumnLimit(current.current.maxColumns)} columns per table.`); return false;
    }
    const cleanName = name.trim(), cleanKey = normalizeDataStudioKey(key || name);
    if (!cleanName) { setError('Table name is required.'); return false; }
    if (!opening.table && !cleanKey) { setError('A machine key is required.'); return false; }
    const changes = dataStudioSchemaImpact(opening.table?.schema, admitted);
    if (changes.length && !confirmed) { setImpact(changes); setConfirmClose(false); return false; }
    inFlight.current = true; setPending(true); setImpact([]);
    try {
      const input = { name: cleanName, description: description.trim() || null, schema: admitted };
      if (opening.table) {
        if (!current.current.onUpdate) throw new Error('Table updates are unavailable.');
        await current.current.onUpdate(input, { expectedRevision: opening.table.revision });
      } else {
        if (!current.current.onCreate) throw new Error('Table creation is unavailable.');
        await current.current.onCreate({ ...input, key: cleanKey });
      }
      if (!mounted.current || !current.current.open) return false;
      acceptedRef.current = true; setAccepted(true); return true;
    } catch (cause) {
      if (mounted.current) {
        setError(dataStudioDialogErrorMessage(cause));
        emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, { metadata: { surface: 'table-dialog', stage: 'save' } });
      }
      return false;
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  return { name, key, description, setName, setKey, setDescription, schema, jsonEditorRef, error, pending, accepted,
    blocked, opening, dirty, confirmClose, setConfirmClose, impact, setImpact, requestClose, save };
}
