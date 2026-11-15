'use client';

/** Native current-scope operator view. Definitions and input editors remain application-owned. */
import * as React from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary, readAuthorizationScopeBoundaryKey } from '../../frontend/client/authorization-scope-hooks';
import type { Client, InternalClient } from '../../frontend/client/sdk';
import { useJobSchedules } from '../../frontend/client/jobs-hooks';
import type { JobDefinitionView, JobScheduleDetail, JobScheduleSummary } from '../../jobs/contracts';
import { defineSchema, field } from '../../schema';
import { DataTable } from '../data-table/data-table';
import type { DataTableServerSource } from '../data-table/data-table-server-types';
import type { DataTableState } from '../data-table/data-table-state';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { ListDetailLayout } from '../ui/list-detail-layout';
import { Clock } from '../animate-ui/icons/clock';
import { RotateCw } from '../animate-ui/icons/rotate-cw';
import { ControlledModal } from '../../modals/modal-controlled';
import { useJobsWorkspace, type JobsWorkspaceAction } from './use-jobs-workspace';
import { JobsStatusBadge, JobsScheduleDetails, JobsOccurrenceList, formatJobsTimestamp } from './jobs-workspace-parts';

export interface JobsWorkspaceProps {
  readonly className?: string;
  readonly title?: string;
  readonly description?: string;
  /** Safe display names only; registered definition names remain the authoritative identity. */
  readonly definitionLabels?: Readonly<Record<string, string>>;
  /** Applications may resolve authorized profile/directory content without exposing definition input. */
  readonly renderOwner?: (ownerId: string) => React.ReactNode;
  readonly renderRun?: (workflowId: string) => React.ReactNode;
  /** Supply an application-owned validated editor; the native view does not invent a JSON schema. */
  readonly onCreate?: (definitions: readonly JobDefinitionView[], trigger: HTMLButtonElement) => void;
  readonly onEdit?: (schedule: JobScheduleDetail, trigger: HTMLButtonElement) => void;
}

const schema = defineSchema({ id: field.text(), job: field.text({ label: 'Job' }), status: field.text({ label: 'Status' }),
  next: field.text({ label: 'Next run' }), owner: field.text({ label: 'Owner' }) });
type JobRow = { id: string; job: string; status: string; next: string; owner: string; summary: JobScheduleSummary };
type Control = 'all' | 'active' | 'paused' | 'cancelled';
const identities = new WeakMap<object, number>(); let sequence = 0;
function clientKey(client: Client) { let key = identities.get(client); if (!key) identities.set(client, key = ++sequence); return key; }
function labelFor(name: string, labels?: JobsWorkspaceProps['definitionLabels']) {
  return labels?.[name] || name.replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Place inside the shared AppProvider/AppShell; no separate client, credential or tenant selector. */
export function JobsWorkspace(props: JobsWorkspaceProps) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  if (!client) return <p role="status">JobsWorkspace requires the application's AppProvider.</p>;
  if (!boundary.ready || !boundary.stable) return <p role="status">Checking access to jobs…</p>;
  return <JobsWorkspaceBody key={`${clientKey(client)}:${boundary.key}`} {...props} client={client} boundaryKey={boundary.key} />;
}

function JobsWorkspaceBody({ client, boundaryKey, ...props }: JobsWorkspaceProps & { client: Client; boundaryKey: string }) {
  const [control, setControl] = React.useState<Control>('all');
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [definitions, setDefinitions] = React.useState<readonly JobDefinitionView[] | null>(null);
  const query = { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize,
    ...(control === 'all' ? {} : { control }) };
  const live = useJobSchedules(query);
  const pageFingerprint = live.page ? JSON.stringify(live.page) : '';
  const detailChange = React.useRef({ id: selectedId, summary: '', query: '', revision: 0, reconnectRevision: 0, version: 0, readDenied: false });
  const selectedRow = live.page?.items.find(row => row.id === selectedId);
  const queryKey = JSON.stringify(query), observation = detailChange.current;
  if (observation.id !== selectedId) { observation.id = selectedId; observation.summary = ''; observation.version++; }
  if (live.status === 'error' && !observation.readDenied) { observation.readDenied = true; observation.version++; }
  if (live.status === 'ready') {
    // A successful list retry is not itself proof of a retained detail read.
    if (observation.readDenied) { observation.readDenied = false; observation.version++; }
    // Page replacement alone must not reset an independently selected inspector.
    // A real committed hint still refreshes it when the selected job/history is off-page.
    // A successful transport re-admission separately reconciles any subscription gap.
    if (observation.query !== queryKey) { observation.query = queryKey; observation.revision = 0; observation.reconnectRevision = 0; }
    if (live.invalidationRevision > observation.revision) { observation.revision = live.invalidationRevision; observation.version++; }
    if (live.reconnectRevision > observation.reconnectRevision) { observation.reconnectRevision = live.reconnectRevision; observation.version++; }
    if (selectedRow && observation.summary !== JSON.stringify(selectedRow)) { observation.summary = JSON.stringify(selectedRow); observation.version++; }
  }
  const controller = useJobsWorkspace(client.jobs, boundaryKey, selectedId, observation.version);
  const [trigger, setTrigger] = React.useState<HTMLButtonElement | null>(null);
  const liveRef = React.useRef({ live, query, control }); liveRef.current = { live, query, control };
  const current = React.useCallback(() => {
    const internal = client as InternalClient;
    return readAuthorizationScopeBoundaryKey(internal.auth ?? null, internal._authorizationDataBoundary?.revision ?? 0) === boundaryKey;
  }, [client, boundaryKey]);
  React.useEffect(() => {
    let active = true;
    if (props.onCreate) void client.jobs.definitions.list().then(page => { if (active && current()) setDefinitions(page.items); }).catch(() => {
      if (active && current()) setDefinitions(null);
    });
    return () => { active = false; };
  }, [client, props.onCreate, current]);
  React.useEffect(() => {
    if (live.status === 'ready' && live.page && !live.page.items.length && pagination.pageIndex > 0
      && query.offset >= live.page.total) setPagination(value => ({ ...value, pageIndex: Math.max(0, Math.ceil(live.page!.total / value.pageSize) - 1) }));
  }, [live.status, live.page, pagination.pageIndex, query.offset]);

  const source = React.useMemo<DataTableServerSource<JobRow>>(() => ({ type: 'server', table: 'zero_jobs_operator_projection',
    live: false, prefetch: false, getRowId: row => row.id, adapter: { async query(request, context) {
      context.signal.throwIfAborted();
      if (!current()) throw Object.assign(new Error('Jobs read authority changed.'), { status: 403 });
      const state = liveRef.current, limit = request.pagination.pageSize, offset = request.pagination.pageIndex * limit;
      // Refresh the table from the exact live page, not fabricated INSERT events or another HTTP call per update.
      const page = state.live.status === 'ready' && state.query.limit === limit && state.query.offset === offset
        ? state.live.page! : await client.jobs.schedules.list({ limit, offset, ...(state.control === 'all' ? {} : { control: state.control }) });
      context.signal.throwIfAborted();
      if (!current()) throw Object.assign(new Error('Jobs read authority changed.'), { status: 403 });
      return { rows: page.items.map(row => ({ id: row.id, job: row.definition, status: row.control, next: '', owner: row.ownerId, summary: row })),
        page: { mode: 'offset', offset, total: page.total, hasMore: offset + page.items.length < page.total } };
    } } }), [client, current]);
  const prepare = (action: JobsWorkspaceAction, row: JobScheduleSummary, element: HTMLButtonElement) => {
    if (liveRef.current.live.status === 'ready' && controller.prepare(action, row)) setTrigger(element);
  };
  const refresh = () => { live.refresh(); controller.refresh(); };
  const selected = controller.detail.data;
  const denied = observation.readDenied;
  const table = <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Select value={control} onValueChange={value => { setControl(value as Control); setPagination(value => ({ ...value, pageIndex: 0 })); setSelectedId(null); }}>
        <SelectTrigger className="w-40" aria-label="Filter jobs by state"><SelectValue /></SelectTrigger>
        <SelectContent>{(['all', 'active', 'paused', 'cancelled'] as const).map(value => <SelectItem key={value} value={value}>{value === 'all' ? 'All jobs' : labelFor(value)}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={refresh}><RotateCw size={14} aria-hidden="true" /> Refresh</Button>
    </div>
    {denied ? <div role="alert" className="rounded-lg border border-border p-4 text-sm"><p>{live.error ?? 'Confirming current jobs access…'}</p><Button variant="outline" size="sm" className="mt-3" onClick={refresh} disabled={live.status === 'loading'}>Retry authorized read</Button></div>
      : <DataTable<JobRow> schema={schema} source={source} refreshKey={`${control}:${pageFingerprint}`} columns={['job', 'status', 'next', 'owner']}
        columnOverrides={{ job: { header: 'Job', cell: ({ row }) => <div className="min-w-0"><span className="font-medium">{labelFor(row.summary.definition, props.definitionLabels)}</span><span className="block truncate text-xs text-muted-foreground">{row.summary.definitionVersion}</span></div> },
          status: { cell: ({ row }) => <JobsStatusBadge row={row.summary} /> },
          next: { cell: ({ row }) => <span className="text-xs">{row.summary.control !== 'active' ? 'Not scheduled' : formatJobsTimestamp(row.summary.nextDueAt)}</span> },
          owner: { cell: ({ row }) => props.renderOwner?.(row.summary.ownerId) ?? <span className="truncate text-xs">{row.summary.ownerId === client.user?.userId ? 'You' : 'Another account'}</span> } }}
        primaryKey="id" paginated={{ pageSize: 20 }} state={{ pagination }} onStateChange={(state: DataTableState) => setPagination(state.pagination)}
        onRowClick={row => setSelectedId(row.id)} highlightedRowId={selectedId ?? undefined}
        searchable={false} sortable={false} filterable={false} selectable={false} showExport={false} showColumnVisibility={false} cellMotion={false}
        toolbarLabel="Scheduled jobs" className="min-h-0 flex-1" tableLayout="fixed"
        emptyState={<div className="space-y-1 py-12 text-center"><Clock className="mx-auto text-muted-foreground" size={24} /><p className="text-sm font-medium">No {control === 'all' ? '' : `${control} `}jobs</p><p className="text-xs text-muted-foreground">Registered schedules and queued one-off jobs appear here.</p></div>} />}
  </div>;
  const detail = <ScrollArea className="h-full" scrollChaining="auto"><div className="space-y-5 p-4">
    {denied ? <p role="status" className="text-sm text-muted-foreground">Job content was withdrawn. Restore authorized access before continuing.</p>
      : !selectedId ? <div className="py-16 text-center"><Clock size={28} className="mx-auto mb-3 text-muted-foreground" /><p className="text-sm font-medium">Select a job</p><p className="mt-1 text-xs text-muted-foreground">Inspect timing, execution history and available controls.</p></div>
      : controller.detail.status === 'error' ? <div role="alert"><p className="text-sm">{controller.detail.error}</p><Button variant="outline" size="sm" onClick={controller.refreshDetail}>Retry details</Button></div>
      : !selected ? <p role="status" className="text-sm text-muted-foreground">Loading job details…</p>
      : <><JobsScheduleDetails detail={selected} definitionLabel={labelFor(selected.definition, props.definitionLabels)} renderOwner={props.renderOwner} renderRun={props.renderRun}
        onAction={prepare} disabled={controller.pending !== null} onEdit={props.onEdit ? (detail, element) => {
          if (current() && liveRef.current.live.status === 'ready') props.onEdit?.(detail, element);
        } : undefined} />
        <section aria-label="Execution history"><h3 className="mb-2 text-sm font-semibold">Execution history</h3>
          {controller.occurrences.status === 'error' ? <div role="alert"><p className="text-sm">{controller.occurrences.error}</p><Button variant="outline" size="sm" onClick={controller.refreshOccurrences}>Retry history</Button></div>
            : controller.occurrences.page ? <JobsOccurrenceList items={controller.occurrences.page.items} total={controller.occurrences.page.total} offset={controller.occurrences.offset} limit={20} onOffset={controller.setOccurrenceOffset} renderRun={props.renderRun} />
              : <p role="status" className="text-sm text-muted-foreground">Loading execution history…</p>}
        </section></>}
  </div></ScrollArea>;
  const pending = controller.pending;
  return <section className={`flex h-full min-h-0 min-w-0 flex-col ${props.className ?? ''}`} aria-label={props.title ?? 'Jobs'}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3"><div><h2 className="text-lg font-semibold tracking-tight">{props.title ?? 'Jobs'}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{props.description ?? 'Current-scope schedules, durable handoffs and execution outcomes.'}</p></div>
      {props.onCreate && <Button size="sm" disabled={!definitions?.length || live.status !== 'ready'} onClick={event => {
        if (definitions && current() && liveRef.current.live.status === 'ready') props.onCreate?.(definitions, event.currentTarget);
      }}>Create job</Button>}
    </header>
    <ListDetailLayout list={table} detail={detail} hasSelection={!!selectedId && !denied} selectedKey={selectedId ?? ''}
      contentBoundaryKey={`${boundaryKey}:${denied ? 'denied' : selectedId ?? 'none'}`} listWidth="3fr" detailWidth="2fr" resizable onMobileBack={() => setSelectedId(null)} />
    {pending && !denied && <ControlledModal open identityKey={pending.snapshot.idempotencyKey} busy={pending.status === 'busy'} error={pending.error}
      onOpenChange={open => { if (!open) { controller.closeConfirmation(); setTrigger(null); } }}
      descriptor={{ title: `${actionLabel(pending.snapshot.action)}?`, description: pending.snapshot.action === 'runNow'
        ? 'Creates a separate one-off execution under your current authority. It does not replay or rewrite the original schedule.'
        : pending.snapshot.action === 'cancel' ? 'Stop future scheduling. Work already accepted by a workflow is not cancelled by this control.'
          : pending.snapshot.action === 'pause' ? 'Pause future scheduling. Already accepted work may still finish.' : 'Resume future scheduling after current admission checks.',
        trigger, role: 'alertdialog', size: 'sm', initialFocus: 'cancel', guard: false,
        beforeClose: () => !['busy', 'unknown'].includes(controller.pending?.status ?? ''),
        actions: [{ id: 'cancel', label: 'Keep unchanged', role: 'cancel', disabled: ['busy', 'unknown'].includes(pending.status) },
          { id: 'confirm', label: pending.status === 'unknown' ? 'Check outcome' : actionLabel(pending.snapshot.action),
            variant: pending.snapshot.action === 'cancel' ? 'danger' : 'primary', disabled: pending.status === 'busy' || pending.status === 'rejected' || pending.status === 'accepted',
            onClick: async context => pending.status === 'unknown' ? controller.reconcile() : controller.confirm(context.signal) }],
        body: <div className="space-y-2 text-xs text-muted-foreground"><p>Schedule <code className="break-all">{pending.snapshot.id}</code> · revision {pending.snapshot.revision}</p>
          {pending.status === 'unknown' && <p>Original request: <code className="break-all">{pending.snapshot.idempotencyKey}</code>. Checking reads its receipt only; it never sends this action again.</p>}</div> }} />}
  </section>;
}

function actionLabel(action: JobsWorkspaceAction) { return { pause: 'Pause job', resume: 'Resume job', cancel: 'Cancel job', runNow: 'Run separately now' }[action]; }
