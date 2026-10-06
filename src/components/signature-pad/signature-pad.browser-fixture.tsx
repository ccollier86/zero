/** Isolated production SignaturePad compositions; local deferred receipts never contact an app service. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { unstable_batchedUpdates } from 'react-dom';
import { configureFrontendObservability } from '../../frontend/client/observability';
import {
  SignaturePad, SignaturePadArea, SignaturePadPlaceholder, SignaturePadGuide,
  SignaturePadControls, SignaturePadClear, SignaturePadUndo, SignaturePadRedo, SignaturePadSave,
  SignatureAgreementCard, ClauseInitials,
  type SignaturePadApi, type SignaturePadStroke, type SignatureAgreementAcknowledgement,
  type SignatureAgreementPayload, type SignatureAgreementReceipt,
} from './index';

type Configuration = {
  mode: 'ordinary' | 'form' | 'external-form' | 'controlled' | 'agreement' | 'clauses';
  disabled: boolean; readOnly: boolean; required: boolean; scope: string;
  format: 'svg' | 'json'; sizing: 'auto' | 'pressure' | 'velocity';
  showFeedback: boolean;
  deferChangeNotifications: boolean;
  color?: string; minWidth: number; maxWidth: number; smoothing: number;
  pointerTypes: readonly ('mouse' | 'pen' | 'touch')[];
};
type Deferred<T> = { id: number; settled: boolean; resolve: (value: T) => void; reject: (error: Error) => void };
const DEFAULT: Configuration = { mode: 'ordinary', disabled: false, readOnly: false, required: true,
  scope: 'organization-a:contract-1', format: 'svg', sizing: 'auto', showFeedback: true, deferChangeNotifications: false,
  minWidth: .8, maxWidth: 3.2, smoothing: .5, pointerTypes: ['mouse', 'pen', 'touch'] };
const SEED: readonly SignaturePadStroke[] = [{ points: [[12, 30, 2], [60, 45, 2], [100, 20, 2]] }];
let sequence = 0;
const saves: (Deferred<void | false> & { value: string; strokes: readonly SignaturePadStroke[] })[] = [];
const signs: (Deferred<SignatureAgreementAcknowledgement> & { payload: SignatureAgreementPayload })[] = [];
const changeNotifications: (Deferred<void> & { strokes: readonly SignaturePadStroke[] })[] = [];
const notifications: SignatureAgreementReceipt[] = [];
const events: { code: string; message: string; metadata?: Record<string, unknown> }[] = [];
configureFrontendObservability({ sink: { emit(event) { events.push({ code: event.code, message: event.message, metadata: event.metadata }); } } });
let currentApi: SignaturePadApi | null = null;
let lastApi: SignaturePadApi | null = null;

function settle<T>(items: Deferred<T>[], id: number, value: T, reject = false): void {
  const item = items.find((candidate) => candidate.id === id && !candidate.settled);
  if (!item) throw new Error(`Missing signature fixture request ${id}.`);
  item.settled = true;
  if (reject) item.reject(new Error('Fixture failure containing private signature details.'));
  else item.resolve(value);
}
function requestSave(value: string, strokes: readonly SignaturePadStroke[]): Promise<void | false> {
  return new Promise((resolve, reject) => saves.push({ id: ++sequence, settled: false, value, strokes, resolve, reject }));
}
function requestSign(payload: SignatureAgreementPayload): Promise<SignatureAgreementAcknowledgement> {
  return new Promise((resolve, reject) => signs.push({ id: ++sequence, settled: false, payload, resolve, reject }));
}

function Fixture() {
  const [configuration, configure] = React.useState(DEFAULT);
  const latestConfiguration = React.useRef(configuration); latestConfiguration.current = configuration;
  const [generation, reset] = React.useState(0), [mounted, setMounted] = React.useState(true);
  const [value, setValue] = React.useState<readonly SignaturePadStroke[]>([]);
  const [changes, setChanges] = React.useState<readonly (readonly SignaturePadStroke[])[]>([]);
  const [submitted, setSubmitted] = React.useState<string[][]>([]);
  const [signed, setSigned] = React.useState<SignatureAgreementReceipt | undefined>();
  const [clauses, setClauses] = React.useState([{ id: 'confidentiality', label: 'Confidentiality', description: 'Keep shared project information private.' },
    { id: 'delivery', label: 'Delivery', description: 'Approve the agreed schedule and deliverables.' }]);
  const [cancelReset, setCancelReset] = React.useState(false);
  const [starts, recordStarts] = React.useState<string[]>([]), [ends, recordEnds] = React.useState(0);
  const remember = React.useCallback((api: SignaturePadApi | null) => { currentApi = api; if (api) lastApi = api; }, []);
  const changed = React.useCallback((strokes: readonly SignaturePadStroke[]) => {
    setValue(strokes); setChanges((previous) => [...previous, strokes]);
    if (latestConfiguration.current.deferChangeNotifications) return new Promise<void>((resolve, reject) => {
      changeNotifications.push({ id: ++sequence, settled: false, strokes, resolve, reject });
    });
  }, []);
  React.useEffect(() => {
    window.__signatureHarness = {
      configure(options) { configure({ ...DEFAULT, ...options }); reset((previous) => previous + 1); setMounted(true);
        setValue([]); setChanges([]); setSubmitted([]); setSigned(undefined); recordStarts([]); recordEnds(0); setCancelReset(false); },
      flags(options) { configure((previous) => ({ ...previous, ...options })); },
      scope(scope) { configure((previous) => ({ ...previous, scope })); },
      externalValue(strokes) { setValue(strokes); },
      unmount() { setMounted(false); }, mount() { setMounted(true); },
      saveRequests() { return saves.map(({ id, value, strokes, settled }) => ({ id, value, strokes, settled })); },
      resolveSave(id, accepted) { settle(saves, id, accepted); }, rejectSave(id) { settle(saves, id, undefined, true); },
      signRequests() { return signs.map(({ id, payload, settled }) => ({ id, payload, settled })); },
      resolveSign(id, acknowledgement) { settle(signs, id, acknowledgement); },
      rejectSign(id) { settle(signs, id, { signedAt: '' }, true); },
      signedReceipt(receipt) { setSigned(receipt); }, notifications() { return [...notifications]; },
      events() { return [...events]; },
      changeRequests() { return changeNotifications.map(({ id, settled }) => ({ id, settled })); },
      rejectChange(id) { settle(changeNotifications, id, undefined, true); },
      api() { const api = currentApi; return api ? { strokes: api.strokes, isEmpty: api.isEmpty, isDrawing: api.isDrawing,
        canUndo: api.canUndo, canRedo: api.canRedo, disabled: api.disabled, readOnly: api.readOnly } : null; },
      invoke(action, retired = false) { (retired ? lastApi : currentApi)?.[action](); },
      exportSVG() { return currentApi?.toSVG() ?? ''; }, exportSerialized() { return currentApi?.serialize() ?? ''; },
      cancelReset(value) { setCancelReset(value); },
      keepFirstClause() { setClauses((previous) => previous.slice(0, 1)); },
      clearClausesTogether() { unstable_batchedUpdates(() => {
        document.querySelectorAll<HTMLButtonElement>('[data-slot="clause-initials"] [data-slot="signature-pad-clear"]').forEach((button) => button.click());
      }); },
    };
  }, []);

  const pad = mounted ? <SignaturePad key={generation} apiRef={remember} name="signature"
    form={configuration.mode === 'external-form' ? 'signature-form' : undefined}
    scopeKey={configuration.scope} value={configuration.mode === 'controlled' ? value : undefined}
    defaultValue={configuration.mode === 'form' ? SEED : []} onValueChange={changed}
    disabled={configuration.disabled} readOnly={configuration.readOnly} required={configuration.required}
    format={configuration.format} sizing={configuration.sizing} pointerTypes={configuration.pointerTypes}
    color={configuration.color} minWidth={configuration.minWidth} maxWidth={configuration.maxWidth} smoothing={configuration.smoothing}
    onStrokeStart={({ pointerType }) => recordStarts((previous) => [...previous, pointerType])}
    onStrokeEnd={() => recordEnds((previous) => previous + 1)}>
    <SignaturePadArea variant="muted" data-testid="signature-area" aria-label="Your signature" className="h-52">
      <SignaturePadPlaceholder>Sign your name here</SignaturePadPlaceholder><SignaturePadGuide />
      <SignaturePadControls position="top-start"><SignaturePadUndo /><SignaturePadRedo /></SignaturePadControls>
      <SignaturePadControls position="bottom-end"><SignaturePadClear /><SignaturePadSave onSave={requestSave} showFeedback={configuration.showFeedback} /></SignaturePadControls>
    </SignaturePadArea>
    <input aria-label="Local notes" className="mt-3" />
  </SignaturePad> : null;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitted(Array.from(new FormData(event.currentTarget).entries(), ([key, value]) => [key, String(value)]));
  };
  const form = <form id="signature-form" data-testid="signature-form" onSubmit={submit}
    onReset={(event) => { if (cancelReset) event.preventDefault(); }}>
    {configuration.mode !== 'external-form' && pad}
    <div className="mt-4 flex gap-2"><button type="submit">Submit form</button><button type="reset">Reset form</button></div>
  </form>;
  return <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-12">
    <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <header className="space-y-2"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Signature capture</p>
        <h1 className="text-xl font-semibold tracking-tight">Make it official</h1>
        <p className="text-sm text-muted-foreground">Sign with a mouse, stylus, or touch. Review before saving.</p></header>
      {configuration.mode === 'agreement' ? mounted && <SignatureAgreementCard sourceKey={configuration.scope}
        title="Project agreement" description="Confirm the project terms and your signature."
        requireConsent consentLabel="I agree to the project terms." onSign={requestSign} signed={signed}
        disabled={configuration.disabled} readOnly={configuration.readOnly}
        onSigned={(receipt) => { notifications.push(receipt); }} /> : configuration.mode === 'clauses'
        ? mounted && <form data-testid="clause-form" onSubmit={submit}>
          <ClauseInitials clauses={clauses} namePrefix="initials" required scopeKey={configuration.scope}
            disabled={configuration.disabled} readOnly={configuration.readOnly} />
          <div className="mt-4 flex gap-2"><button type="reset">Reset initials</button><button type="submit">Submit initials</button></div>
        </form>
        : configuration.mode === 'form' || configuration.mode === 'external-form' ? <>{form}{configuration.mode === 'external-form' && pad}</> : pad}
      <input aria-label="Outside notes" />
      <output data-testid="signature-changes" className="sr-only">{JSON.stringify(changes)}</output>
      <output data-testid="signature-value" className="sr-only">{JSON.stringify(value)}</output>
      <output data-testid="submitted" className="sr-only">{JSON.stringify(submitted)}</output>
      <output data-testid="stroke-starts" className="sr-only">{JSON.stringify(starts)}</output>
      <output data-testid="stroke-ends" className="sr-only">{ends}</output>
      <span data-testid="fixture-ready" className="sr-only">Ready</span>
    </section>
  </main>;
}

declare global {
  interface Window {
    __signatureHarness: {
      configure(options: Partial<Configuration>): void; flags(options: Partial<Configuration>): void; scope(value: string): void;
      externalValue(strokes: readonly SignaturePadStroke[]): void; unmount(): void; mount(): void;
      saveRequests(): { id: number; value: string; strokes: readonly SignaturePadStroke[]; settled: boolean }[];
      resolveSave(id: number, accepted?: false): void; rejectSave(id: number): void;
      signRequests(): { id: number; payload: SignatureAgreementPayload; settled: boolean }[];
      resolveSign(id: number, acknowledgement: SignatureAgreementAcknowledgement): void; rejectSign(id: number): void;
      signedReceipt(receipt: SignatureAgreementReceipt): void; notifications(): SignatureAgreementReceipt[];
      events(): { code: string; message: string; metadata?: Record<string, unknown> }[];
      changeRequests(): { id: number; settled: boolean }[]; rejectChange(id: number): void;
      api(): Pick<SignaturePadApi, 'strokes' | 'isEmpty' | 'isDrawing' | 'canUndo' | 'canRedo' | 'disabled' | 'readOnly'> | null;
      invoke(action: 'clear' | 'undo' | 'redo' | 'reset' | 'focus', retired?: boolean): void;
      exportSVG(): string; exportSerialized(): string; cancelReset(value: boolean): void; keepFirstClause(): void; clearClausesTogether(): void;
    };
  }
}
createRoot(document.getElementById('root')!).render(<Fixture />);
