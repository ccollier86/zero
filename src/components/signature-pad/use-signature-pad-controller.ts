'use client';

/** Owns React history/controlled-state admission and guarded actions, not drawing or persistence. */
import * as React from 'react';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import {
  assertSignaturePadColor, commitSignaturePadHistory, createSignaturePadHistory,
  hasSignaturePadInk, reconcileSignaturePadHistory, redoSignaturePadHistory,
  resetSignaturePadHistory, sameSignaturePadStrokes, snapshotSignaturePadStrokes, undoSignaturePadHistory,
} from './signature-model';
import { serializeSignaturePad, signaturePadToBlob, signaturePadToDataURL, signaturePadToSVG } from './signature-export';
import type { SignaturePadApi, SignaturePadExportOptions, SignaturePadHistory } from './signature-pad.types';
import type { SignaturePadConfig } from './signature-pad-context';
import type { SignaturePadProps } from './signature-pad.props';

/** History snapshots are immutable; imperative mutation guards use current props, not stale handles. */
export function useSignaturePadController(props: SignaturePadProps) {
  const [admitted, setAdmitted] = React.useState(() => ({
    scopeKey: props.scopeKey, history: createSignaturePadHistory(props.value ?? props.defaultValue),
  }));
  const history = admitted.history;
  const [isDrawing, setDrawingState] = React.useState(false);
  const [busy, setBusy] = React.useState(false), [invalid, setInvalid] = React.useState(false);
  const id = React.useId();
  const scope = React.useRef(props.scopeKey);
  const initial = React.useRef(snapshotSignaturePadStrokes(props.defaultValue ?? []));
  const area = React.useRef<HTMLDivElement | null>(null), mounted = React.useRef(true);
  const locks = React.useRef(new Set<object>());
  const scopeChanged = !Object.is(admitted.scopeKey, props.scopeKey);
  const provided = props.value === undefined ? undefined : snapshotSignaturePadStrokes(props.value);
  const effective = scopeChanged ? createSignaturePadHistory(provided ?? props.defaultValue)
    : provided ? reconcileSignaturePadHistory(history, provided) : history;
  // Admit external state once, before children commit. Otherwise drawing/busy renders
  // repeatedly manufacture a new ink epoch and discard the same controlled draft.
  if (scopeChanged || effective !== history) setAdmitted({ scopeKey: props.scopeKey, history: effective });
  const epoch = React.useMemo(() => ({}), [props.scopeKey, effective.present, props.color,
    props.minWidth, props.maxWidth, props.smoothing, props.sizing, props.pointerTypes?.join(',')]);
  const callbackScope = React.useMemo(() => ({}), [props.scopeKey]);
  const current = React.useRef({ props, history: effective, epoch, callbackScope, drawing: isDrawing });
  current.current = { props, history: effective, epoch, callbackScope, drawing: isDrawing };
  const editable = () => mounted.current && !current.current.props.disabled &&
    !current.current.props.readOnly && !current.current.drawing && locks.current.size === 0;
  const observe = (operation: string, callback: (() => unknown) | undefined): boolean => {
    // Notifications belong to this scope, not the pre-edit ink epoch: a
    // successful local edit must not hide its later callback rejection.
    const owner = current.current.callbackScope;
    const failed = () => {
      if (mounted.current && owner === current.current.callbackScope) {
        emitFrontendCode(OBS_CODES.FRONTEND_SIGNATURE_PAD_CALLBACK_FAILED, { metadata: { operation } });
      }
    };
    try {
      const result = callback?.();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(failed);
      return true;
    } catch { failed(); return false; }
  };
  const accept = (next: SignaturePadHistory) => {
    if (!editable()) return false;
    const source = current.current;
    if (next === source.history) return false;
    const changed = !sameSignaturePadStrokes(next.present, source.history.present);
    if (changed && !observe('change', () => source.props.onValueChange?.(next.present))) return false;
    current.current = { ...current.current, history: next };
    setAdmitted({ scopeKey: source.props.scopeKey, history: next }); setInvalid(false);
    return true;
  };
  const frame = (options: SignaturePadExportOptions = {}): SignaturePadExportOptions => options.crop === false && area.current
    ? { ...options, width: options.width ?? Math.max(1, area.current.clientWidth), height: options.height ?? Math.max(1, area.current.clientHeight) } : options;
  const api: SignaturePadApi = {
    strokes: effective.present, isEmpty: !hasSignaturePadInk(effective.present), isDrawing,
    canUndo: effective.past.length > 0, canRedo: effective.future.length > 0,
    disabled: !!props.disabled, readOnly: !!props.readOnly,
    clear: () => { if (editable()) accept(commitSignaturePadHistory(current.current.history, [])); },
    undo: () => { if (editable()) accept(undoSignaturePadHistory(current.current.history)); },
    redo: () => { if (editable()) accept(redoSignaturePadHistory(current.current.history)); },
    reset: () => { if (editable()) accept(resetSignaturePadHistory(initial.current)); },
    focus: () => { if (mounted.current) area.current?.focus({ preventScroll: true }); },
    toSVG: (options) => signaturePadToSVG(current.current.history.present, frame(options)),
    toDataURL: (options) => signaturePadToDataURL(current.current.history.present, frame(options)),
    toBlob: (options) => signaturePadToBlob(current.current.history.present, frame(options)),
    serialize: (format, options) => serializeSignaturePad(current.current.history.present, format, frame(options)),
  };
  const latestApi = React.useRef(api); latestApi.current = api;
  const handleCache = React.useRef<{ key: unknown[]; handle: SignaturePadApi } | null>(null);
  React.useImperativeHandle(props.apiRef, () => {
    const key = [effective.present, effective.past, effective.future, isDrawing, props.disabled, props.readOnly];
    if (handleCache.current?.key.every((value, index) => Object.is(value, key[index]))) return handleCache.current.handle;
    const handle = {} as SignaturePadApi;
    for (const key of Object.keys(api) as (keyof SignaturePadApi)[]) {
      Object.defineProperty(handle, key, { enumerable: true, get: () => latestApi.current[key] });
    }
    handleCache.current = { key, handle: Object.freeze(handle) };
    return handleCache.current.handle;
  }, [effective.present, effective.past, effective.future, isDrawing, props.disabled, props.readOnly]);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; locks.current.clear(); };
  }, []);
  React.useEffect(() => {
    if (scope.current === props.scopeKey) return;
    scope.current = props.scopeKey;
    initial.current = snapshotSignaturePadStrokes(props.defaultValue ?? []);
    locks.current.clear(); setBusy(false); setDrawingState(false); setInvalid(false);
  }, [props.scopeKey]);
  const config: SignaturePadConfig = {
    epoch, color: props.color, minWidth: props.minWidth ?? .8, maxWidth: props.maxWidth ?? 3.2,
    smoothing: props.smoothing ?? .5, sizing: props.sizing ?? 'auto', pointerTypes: props.pointerTypes,
    name: props.name, form: props.form, required: !!props.required, format: props.format ?? 'svg',
    interactive: !props.disabled && !props.readOnly && !busy, busy, invalid,
    fieldId: `${id}-field`, errorId: `${id}-error`, setInvalid,
    setArea: (node) => { area.current = node; },
    setDrawing: (drawing) => { current.current.drawing = drawing; if (mounted.current) setDrawingState(drawing); },
    commitStroke: (stroke) => {
      if (!editable()) return;
      const next = commitSignaturePadHistory(current.current.history, [...current.current.history.present, stroke]);
      if (accept(next)) observe('stroke-end', () => current.current.props.onStrokeEnd?.(next.present.at(-1)!));
    },
    notifyStrokeStart: (details) => observe('stroke-start', () => current.current.props.onStrokeStart?.(details)),
    lockInteractions: () => {
      const token = {};
      locks.current.add(token); if (mounted.current) setBusy(true);
      return () => { if (locks.current.delete(token) && mounted.current) setBusy(locks.current.size > 0); };
    },
  };
  return { api, config };
}

/** Reject invalid drawing knobs instead of silently producing malformed SVG ink. */
export function validateSignaturePadOptions(props: SignaturePadProps): void {
  const min = props.minWidth ?? .8, max = props.maxWidth ?? 3.2;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min || max > 256) {
    throw new RangeError('SignaturePad widths must be positive, ordered and at most 256.');
  }
  if (props.smoothing !== undefined && (!Number.isFinite(props.smoothing) || props.smoothing < 0 || props.smoothing > 1)) {
    throw new RangeError('SignaturePad smoothing must be between 0 and 1.');
  }
  if (props.color !== undefined) assertSignaturePadColor(props.color);
  if (props.sizing !== undefined && !['auto', 'pressure', 'velocity'].includes(props.sizing)) throw new TypeError('Invalid signature ink sizing.');
  if (props.format !== undefined && !['svg', 'json'].includes(props.format)) throw new TypeError('SignaturePad supports SVG and JSON formats.');
  if (props.pointerTypes !== undefined && (!Array.isArray(props.pointerTypes) || props.pointerTypes.some((type) => !['mouse', 'pen', 'touch'].includes(type)))) {
    throw new TypeError('Invalid signature pointer types.');
  }
}
