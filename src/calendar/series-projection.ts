/** Private detached staging instructions, NOT booking admission, reservations,
 * publication or UTC coverage. Only an actual native COMMIT may recheck owner,
 * grant, generation, expiry, policy, all resources and SYSTEM participants and
 * make these facts authoritative. Never expose the factories to browser JSON. */
import { CalendarError } from './error';
import { inspectCalendarSeriesCompilationContribution, type CalendarSeriesCompilationBinding,
  type CalendarSeriesCompilationContribution, type CalendarSeriesCompilationEvidence, type CalendarSeriesCompilationSource,
  type CalendarSeriesCompiledOccurrence } from './series-compilation';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarValue } from './validation';
import { CALENDAR_SERIES_LEGACY_PROJECTION_ROW_LIMIT as CALENDAR_SERIES_MAX_PROJECTION_ROWS } from './series-projection-budgets';

export const CALENDAR_SERIES_UTC_CELL_MS = 86_400_000;
export const CALENDAR_SERIES_MAX_OCCURRENCE_CELLS = 544;
export const CALENDAR_SERIES_MAX_PROJECTION_INSTRUCTIONS = 256;
export { CALENDAR_SERIES_MAX_PROJECTION_ROWS };
/** Instruction subtree only. Keep headroom beneath the unchanged actor limits
 * for the independently bounded source binding, checkpoints and signed frame. */
export const CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_NODES = 6_000;
export const CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_BYTES = 512 * 1024;
type Phase = 'occurrence' | 'version' | 'resource' | 'cell' | 'complete';
export interface CalendarSeriesProjectionBinding {
  readonly kind: 'calendar-series-projection-binding-v1';
  /** Includes the exact root/owner/source/authoring/type/visit/participant facts. */
  readonly source: CalendarSeriesCompilationBinding;
  readonly runId: string;
  readonly batchDigest: string;
  readonly resourceVectorDigest: string;
  /** Original logical operation identity, never a claim/lease nonce. */
  readonly originalBatchKey: string;
  readonly bindingDigest: string;
}
export interface CalendarSeriesProjectionCheckpoint {
  readonly kind: 'calendar-series-projection-checkpoint-v1';
  readonly bindingDigest: string;
  readonly candidateOrdinal: number;
  readonly phase: Phase;
  readonly resourceOrdinal: number;
  readonly cellOrdinal: number;
  readonly instructionCount: number;
  readonly rowCount: number;
  /** Ordered instruction hash chain, independent of physical step sizes. This
   * is preparation evidence only, not a complete publication/coverage seal. */
  readonly manifestRootDigest: string;
}
declare const projectionBrand: unique symbol;
export interface CalendarSeriesProjection { readonly [projectionBrand]: true }
interface InstructionContext {
  readonly bindingDigest: string;
  readonly batchDigest: string;
  readonly candidateDigest: string;
  readonly resourceVectorDigest: string;
  readonly candidateOrdinal: number;
  readonly instructionOrdinal: number;
  readonly digest: string;
}
interface OccurrenceInstruction {
  readonly kind: 'occurrence'; readonly rowCount: 1; readonly id: string; readonly scopeId: string;
  readonly seriesId: string; readonly logicalSegmentId: string; readonly nominalKey: string; readonly appointmentId: string;
}
interface VersionInstruction {
  /** Version + ALL exact resource memberships and whole-interval claims enter
   * one physical transaction before any cell projection. */
  readonly kind: 'version'; readonly rowCount: number; readonly id: string; readonly scopeId: string; readonly seriesId: string;
  readonly occurrenceId: string; readonly runId: string; readonly versionDigest: string;
  readonly booking: CalendarSeriesCompiledOccurrence['booking']; readonly title: string;
  readonly participants: CalendarSeriesCompiledOccurrence['participants']; readonly resourceDigest: string;
}
interface ResourceInstruction {
  /** Conservatively two rows; the native writer verifies the membership/claim
   * already atomically created by VERSION, rather than reserving a partial set. */
  readonly kind: 'resource'; readonly rowCount: 2; readonly id: string; readonly claimId: string;
  readonly scopeId: string; readonly runId: string; readonly versionId: string;
  readonly resourceId: string; readonly resourceRevision: number; readonly fromMs: number; readonly untilMs: number;
  readonly expiresAtMs: number;
}
interface CellInstruction {
  /** Conservative physical projection cost: optional cell header+builder,
   * member insert and builder-head CAS. Existing headers may cost only two.
   * Fixed per-step receipt/run-state overhead is separately writer-bounded. */
  readonly kind: 'cell-member'; readonly rowCount: 4; readonly id: string; readonly scopeId: string; readonly runId: string;
  readonly cellSetId: string; readonly versionId: string; readonly resourceId: string;
  readonly cellStartMs: number; readonly fromMs: number; readonly untilMs: number;
}
export type CalendarSeriesProjectionInstruction = Readonly<InstructionContext &
  (OccurrenceInstruction | VersionInstruction | ResourceInstruction | CellInstruction)>;
export interface CalendarSeriesProjectionEvidence {
  readonly binding: CalendarSeriesProjectionBinding;
  readonly checkpoint: CalendarSeriesProjectionCheckpoint;
  readonly digest: string;
}
export interface CalendarSeriesProjectionStep {
  readonly cursor: CalendarSeriesProjection;
  readonly instructions: readonly CalendarSeriesProjectionInstruction[];
  readonly rowCount: number;
  readonly originalStepKey: string;
  readonly stepDigest: string;
  readonly progress: { readonly beforeDigest: string; readonly afterDigest: string; readonly checkpoint: CalendarSeriesProjectionCheckpoint };
}
interface Context {
  readonly source: CalendarSeriesCompilationSource;
  readonly contribution: CalendarSeriesCompilationContribution;
  readonly compilation: CalendarSeriesCompilationEvidence;
  readonly binding: CalendarSeriesProjectionBinding;
}
interface State { readonly context: Context; readonly checkpoint: CalendarSeriesProjectionCheckpoint }
interface CandidateFacts { readonly candidate: CalendarSeriesCompiledOccurrence; readonly digest: string;
  readonly versionId: string; readonly versionDigest: string; readonly firstCell: number; readonly cellCount: number }
const states = new WeakMap<object, State>();
const steps = new WeakMap<object, CalendarSeriesProjectionStep>();
interface PortableSize { readonly nodes: number; readonly bytes: number }
const portableSizes = new WeakMap<object, PortableSize>();
const candidateSizes = new WeakMap<CalendarSeriesCompiledOccurrence, { readonly digest: string; readonly firstCell: number; readonly cellCount: number }>();
const FIELDS = ['kind', 'bindingDigest', 'candidateOrdinal', 'phase', 'resourceOrdinal', 'cellOrdinal', 'instructionCount', 'rowCount', 'manifestRootDigest'] as const;
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function conflict(): never { throw new CalendarError('CALENDAR_REVISION_CONFLICT'); }
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid(); return value;
}
function hash(domain: string, value: unknown): string { return calendarHash([domain, value]); }
function current(context: Context): void {
  inspectCalendarSeriesCompilationContribution(context.source, context.contribution, context.binding.batchDigest);
}
function state(cursor: CalendarSeriesProjection): State {
  const value = cursor !== null && typeof cursor === 'object' ? states.get(cursor) : undefined;
  if (!value) throw new CalendarError('CALENDAR_FORBIDDEN'); current(value.context); return value;
}
function checkpoint(value: CalendarSeriesProjectionCheckpoint): CalendarSeriesProjectionCheckpoint { return Object.freeze(value); }
function handle(context: Context, value: CalendarSeriesProjectionCheckpoint): CalendarSeriesProjection {
  const token = Object.freeze({}) as CalendarSeriesProjection; states.set(token, { context, checkpoint: checkpoint(value) }); return token;
}
function evidence(context: Context, value: CalendarSeriesProjectionCheckpoint): CalendarSeriesProjectionEvidence {
  return Object.freeze({ binding: context.binding, checkpoint: value, digest: hash('calendar-series-projection-progress-v1', value) });
}
/** Internal measurement of already validated/frozen native data, not a JSON
 * admission API. Charge repeated references every time they occur on the wire,
 * but traverse a shared template/booking subtree only once. Bytes cover JSON
 * punctuation/escaping and conservatively charge at least the actor's eight
 * bytes per number. No growing packet is repeatedly cloned or serialized. */
function portableSize(value: unknown): PortableSize {
  if (value === null) return { nodes: 1, bytes: 4 };
  if (typeof value === 'string') return { nodes: 1, bytes: Buffer.byteLength(JSON.stringify(value)) };
  if (typeof value === 'boolean') return { nodes: 1, bytes: value ? 4 : 5 };
  if (typeof value === 'number') return { nodes: 1, bytes: Math.max(8, String(value).length) };
  if (typeof value !== 'object') throw new CalendarError('CALENDAR_STATE_INVALID');
  const cached = portableSizes.get(value); if (cached) return cached;
  let nodes = 1, bytes = 2;
  if (Array.isArray(value)) {
    bytes += Math.max(0, value.length - 1);
    for (const child of value) { const size = portableSize(child); nodes += size.nodes; bytes += size.bytes; }
  } else {
    const entries = Object.entries(value); bytes += Math.max(0, entries.length - 1);
    for (const [key, child] of entries) {
      const size = portableSize(child); nodes += size.nodes; bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + size.bytes;
    }
  }
  const result = Object.freeze({ nodes, bytes }); portableSizes.set(value, result); return result;
}
function footprint(candidate: CalendarSeriesCompiledOccurrence) {
  const interval = candidate.booking.interval;
  // Fixed UTC slabs, NOT scheduling-zone civil days. floor is essential before
  // epoch zero; subtracting one millisecond implements the exclusive end.
  const firstCell = Math.floor(interval.occupiedStartMs / CALENDAR_SERIES_UTC_CELL_MS);
  const lastCell = Math.floor((interval.occupiedEndMs - 1) / CALENDAR_SERIES_UTC_CELL_MS), cellCount = lastCell - firstCell + 1;
  if (cellCount < 1 || cellCount > 34 || cellCount * candidate.booking.resourceIds.length > CALENDAR_SERIES_MAX_OCCURRENCE_CELLS)
    throw new CalendarError('CALENDAR_STATE_INVALID');
  return { firstCell, cellCount };
}
function candidateFacts(context: Context, ordinal: number): CandidateFacts {
  const candidate = context.compilation.candidates[ordinal]; if (!candidate) return invalid();
  let qualified = candidateSizes.get(candidate);
  if (!qualified) { qualified = Object.freeze({ digest: calendarHash(candidate), ...footprint(candidate) }); candidateSizes.set(candidate, qualified); }
  const versionDigest = hash('calendar-series-version-v1', [context.binding.source.snapshotDigest, context.binding.runId, candidate.id, qualified.digest]);
  return { candidate, ...qualified, versionDigest, versionId: versionDigest };
}
function context(source: CalendarSeriesCompilationSource, contribution: CalendarSeriesCompilationContribution,
  expectedBatchDigest: string, options: { readonly runId: string }): Context {
  const compilation = inspectCalendarSeriesCompilationContribution(source, contribution, expectedBatchDigest);
  const r = calendarRecord(calendarValue(options), ['runId']), runId = calendarKey(r.runId), bindingSource = compilation.binding;
  const originalBatchKey = hash('calendar-series-projection-batch-key-v1', [bindingSource.scopeId, bindingSource.ownerId,
    bindingSource.sourceId, bindingSource.sourceGeneration, bindingSource.preparationId, runId, compilation.progress.beforeDigest]);
  const base = Object.freeze({ kind: 'calendar-series-projection-binding-v1' as const, source: bindingSource, runId,
    batchDigest: compilation.batchDigest, resourceVectorDigest: calendarHash(bindingSource.resourceRevisions), originalBatchKey });
  const binding = Object.freeze({ ...base, bindingDigest: hash('calendar-series-projection-binding-v1', base) });
  return { source, contribution, compilation, binding };
}

/** Native-only run identity; copied compilation evidence is not a contribution.
 * Creation retains the bounded candidate batch, never a pre-expanded cell list. */
export function createCalendarSeriesProjection(source: CalendarSeriesCompilationSource, contribution: CalendarSeriesCompilationContribution,
  expectedBatchDigest: string, options: { readonly runId: string }): CalendarSeriesProjection {
  const c = context(source, contribution, expectedBatchDigest, options);
  return handle(c, { kind: 'calendar-series-projection-checkpoint-v1', bindingDigest: c.binding.bindingDigest, candidateOrdinal: 0,
    phase: c.compilation.candidates.length ? 'occurrence' : 'complete', resourceOrdinal: 0, cellOrdinal: 0, instructionCount: 0, rowCount: 0,
    manifestRootDigest: hash('calendar-series-projection-empty-v1', c.binding.bindingDigest) });
}
export function inspectCalendarSeriesProjection(cursor: CalendarSeriesProjection): CalendarSeriesProjectionEvidence {
  const s = state(cursor); return evidence(s.context, s.checkpoint);
}
/** Native signer only. Durable nominal COUNT/gap progress is read from the
 * genuine projection context, never caller JSON adjacent to a valid cursor. */
export function inspectCalendarSeriesProjectionCompilation(cursor: CalendarSeriesProjection): Readonly<{
  progress: CalendarSeriesCompilationEvidence['progress']; work: CalendarSeriesCompilationEvidence['work'] }> {
  const s = state(cursor); return Object.freeze({ progress: s.context.compilation.progress, work: s.context.compilation.work });
}
/** Signers MUST inspect this retained runtime-owned step and serialize these
 * exact facts, never a caller's copied instructions beside a genuine cursor.
 * Fresh/restored cursors have no retained step and cannot fabricate one. */
export function inspectCalendarSeriesProjectionStep(cursor: CalendarSeriesProjection, expectedStepDigest: string): CalendarSeriesProjectionStep {
  state(cursor);
  const step = steps.get(cursor); if (!step) throw new CalendarError('CALENDAR_FORBIDDEN');
  if (digest(expectedStepDigest) !== step.stepDigest) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
  return step;
}
/** Validate canonical positional counters arithmetically, at most one pass over
 * the already bounded candidate batch. No historical/cell-prefix replay. */
function position(context: Context, input: Record<string, unknown>): CalendarSeriesProjectionCheckpoint {
  const candidates = context.compilation.candidates, candidateOrdinal = calendarInteger(input.candidateOrdinal, 0, candidates.length);
  const resourceOrdinal = calendarInteger(input.resourceOrdinal, 0, 15), cellOrdinal = calendarInteger(input.cellOrdinal, 0, 33);
  const phase = input.phase as Phase;
  let instructions = 0, rows = 0;
  for (let index = 0; index < candidateOrdinal; index++) {
    const candidate = candidates[index]!, cells = footprint(candidate).cellCount, resources = candidate.booking.resourceIds.length;
    instructions += 2 + resources * (1 + cells); rows += 2 + resources * (4 + 4 * cells);
  }
  if (candidateOrdinal === candidates.length) {
    if (phase !== 'complete' || resourceOrdinal !== 0 || cellOrdinal !== 0) return invalid();
  } else {
    const candidate = candidates[candidateOrdinal]!, cells = footprint(candidate).cellCount;
    if (resourceOrdinal >= candidate.booking.resourceIds.length || cellOrdinal >= cells) return invalid();
    if (phase === 'occurrence' || phase === 'version') {
      if (resourceOrdinal !== 0 || cellOrdinal !== 0) return invalid();
      if (phase === 'version') { instructions++; rows++; }
    } else if (phase === 'resource' || phase === 'cell') {
      instructions += 2 + resourceOrdinal * (1 + cells);
      rows += 2 + 2 * candidate.booking.resourceIds.length + resourceOrdinal * (2 + 4 * cells);
      if (phase === 'resource' && cellOrdinal !== 0) return invalid();
      if (phase === 'cell') { instructions += 1 + cellOrdinal; rows += 2 + 4 * cellOrdinal; }
    } else return invalid();
  }
  if (input.kind !== 'calendar-series-projection-checkpoint-v1' || input.bindingDigest !== context.binding.bindingDigest) return conflict();
  if (calendarInteger(input.instructionCount) !== instructions || calendarInteger(input.rowCount) !== rows) return invalid();
  return { kind: 'calendar-series-projection-checkpoint-v1', bindingDigest: context.binding.bindingDigest, candidateOrdinal,
    phase, resourceOrdinal, cellOrdinal, instructionCount: instructions, rowCount: rows, manifestRootDigest: digest(input.manifestRootDigest) };
}
/** Expected progress MUST be selected independently from trusted native DB/CAS
 * evidence. Browser-provided JSON plus its self-rehashed digest proves nothing.
 * Restoring progress is not ongoing native authority or a coverage certificate. */
export function restoreCalendarSeriesProjection(source: CalendarSeriesCompilationSource, contribution: CalendarSeriesCompilationContribution,
  expectedBatchDigest: string, options: { readonly runId: string }, persisted: unknown, expectedProgressDigest: string): CalendarSeriesProjection {
  const c = context(source, contribution, expectedBatchDigest, options), r = calendarRecord(calendarValue(persisted), FIELDS);
  if (hash('calendar-series-projection-progress-v1', r) !== digest(expectedProgressDigest)) return conflict();
  return handle(c, position(c, r));
}
function instruction(context: Context, progress: CalendarSeriesProjectionCheckpoint, facts: CandidateFacts): CalendarSeriesProjectionInstruction {
  const b = context.binding, s = b.source, candidate = facts.candidate, interval = candidate.booking.interval;
  let body: OccurrenceInstruction | VersionInstruction | ResourceInstruction | CellInstruction;
  if (progress.phase === 'occurrence') body = { kind: 'occurrence', rowCount: 1, id: candidate.id, scopeId: s.scopeId,
    seriesId: s.seriesId, logicalSegmentId: s.segmentId, nominalKey: candidate.nominalKey, appointmentId: candidate.id };
  else if (progress.phase === 'version') body = { kind: 'version', rowCount: 1 + 2 * candidate.booking.resourceIds.length, id: facts.versionId, scopeId: s.scopeId, seriesId: s.seriesId,
    occurrenceId: candidate.id, runId: b.runId, versionDigest: facts.versionDigest, booking: candidate.booking, title: candidate.title,
    participants: candidate.participants, resourceDigest: s.grant.resourceDigest };
  else {
    const resource = s.resourceRevisions[progress.resourceOrdinal]!;
    if (progress.phase === 'resource') body = { kind: 'resource', rowCount: 2,
      id: hash('calendar-series-version-resource-v1', [facts.versionId, resource.id]),
      claimId: hash('calendar-series-pending-claim-v1', [b.runId, facts.versionId, resource.id]), scopeId: s.scopeId, runId: b.runId,
      versionId: facts.versionId, resourceId: resource.id, resourceRevision: resource.revision,
      fromMs: interval.occupiedStartMs, untilMs: interval.occupiedEndMs, expiresAtMs: s.preparationExpiresAtMs };
    else {
      const cellStartMs = (facts.firstCell + progress.cellOrdinal) * CALENDAR_SERIES_UTC_CELL_MS;
      body = { kind: 'cell-member', rowCount: 4,
        id: hash('calendar-series-cell-member-v1', [b.runId, facts.versionId, resource.id, cellStartMs]), scopeId: s.scopeId, runId: b.runId,
        cellSetId: hash('calendar-series-cell-set-v1', [b.runId, resource.id, cellStartMs]), versionId: facts.versionId, resourceId: resource.id,
        cellStartMs, fromMs: Math.max(interval.occupiedStartMs, cellStartMs), untilMs: Math.min(interval.occupiedEndMs, cellStartMs + CALENDAR_SERIES_UTC_CELL_MS) };
    }
  }
  const value = { ...body, bindingDigest: b.bindingDigest, batchDigest: b.batchDigest, candidateDigest: facts.digest,
    resourceVectorDigest: b.resourceVectorDigest, candidateOrdinal: progress.candidateOrdinal, instructionOrdinal: progress.instructionCount };
  return Object.freeze({ ...value, digest: hash('calendar-series-projection-instruction-v1', value) });
}
function next(context: Context, previous: CalendarSeriesProjectionCheckpoint, facts: CandidateFacts,
  value: CalendarSeriesProjectionInstruction): CalendarSeriesProjectionCheckpoint {
  let { candidateOrdinal, phase, resourceOrdinal, cellOrdinal } = previous;
  if (phase === 'occurrence') phase = 'version';
  else if (phase === 'version') phase = 'resource';
  else if (phase === 'resource') phase = 'cell';
  else if (++cellOrdinal === facts.cellCount) {
    cellOrdinal = 0;
    if (++resourceOrdinal === facts.candidate.booking.resourceIds.length) {
      resourceOrdinal = 0; candidateOrdinal++; phase = candidateOrdinal === context.compilation.candidates.length ? 'complete' : 'occurrence';
    } else phase = 'resource';
  }
  return checkpoint({ ...previous, candidateOrdinal, phase, resourceOrdinal, cellOrdinal,
    instructionCount: previous.instructionCount + 1, rowCount: previous.rowCount + value.rowCount,
    manifestRootDigest: hash('calendar-series-projection-chain-v1', [previous.manifestRootDigest, value.digest]) });
}
/** Independent row/instruction/portable-payload limits, including full resource
 * membership+claim cost and repeated participant/booking template payloads.
 * At most limit instructions are constructed; there is no 54K-member array and
 * no database/civil-date operation. The minimum row limit is the maximum of 4
 * and the full VERSION cost (1+2*resourceCount, at most33), ensuring progress and
 * atomic all-resource claims before a candidate's first cell.
 * Cost covers projection rows conservatively, not the writer's fixed bounded
 * receipt/run-state overhead or a later cell/publication seal transaction.
 * Complete/zero-output batches retain their exact compiler progress/binding. */
export function advanceCalendarSeriesProjection(cursor: CalendarSeriesProjection,
  budget: { readonly instructionLimit?: number; readonly rowLimit?: number } = {}): CalendarSeriesProjectionStep {
  const s = state(cursor), b = calendarRecord(calendarValue(budget), ['instructionLimit', 'rowLimit']);
  const instructionLimit = b.instructionLimit === undefined ? CALENDAR_SERIES_MAX_PROJECTION_INSTRUCTIONS
    : calendarInteger(b.instructionLimit, 1, CALENDAR_SERIES_MAX_PROJECTION_INSTRUCTIONS);
  const minimumRowLimit = Math.max(4, 1 + 2 * s.context.binding.source.resourceRevisions.length);
  const rowLimit = b.rowLimit === undefined ? CALENDAR_SERIES_MAX_PROJECTION_ROWS : calendarInteger(b.rowLimit, minimumRowLimit, CALENDAR_SERIES_MAX_PROJECTION_ROWS);
  const before = evidence(s.context, s.checkpoint), instructions: CalendarSeriesProjectionInstruction[] = [];
  let progress = s.checkpoint, rowCount = 0, payloadNodes = 1, payloadBytes = 2, facts: CandidateFacts | undefined, ordinal = -1;
  while (progress.phase !== 'complete' && instructions.length < instructionLimit) {
    const cost = progress.phase === 'resource' ? 2 : progress.phase === 'cell' ? 4
      : progress.phase === 'version' ? 1 + 2 * s.context.binding.source.resourceRevisions.length : 1;
    if (rowCount + cost > rowLimit) break;
    if (ordinal !== progress.candidateOrdinal) { ordinal = progress.candidateOrdinal; facts = candidateFacts(s.context, ordinal); }
    const value = instruction(s.context, progress, facts!), size = portableSize(value), separatorBytes = instructions.length ? 1 : 0;
    if (payloadNodes + size.nodes > CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_NODES
      || payloadBytes + separatorBytes + size.bytes > CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_BYTES) {
      if (!instructions.length) throw new CalendarError('CALENDAR_CAPACITY');
      break;
    }
    instructions.push(value); rowCount += value.rowCount; payloadNodes += size.nodes; payloadBytes += separatorBytes + size.bytes;
    progress = next(s.context, progress, facts!, value);
  }
  current(s.context);
  const after = evidence(s.context, progress), originalStepKey = hash('calendar-series-projection-step-key-v1', [s.context.binding.originalBatchKey, before.digest]);
  const metadata = { bindingDigest: s.context.binding.bindingDigest, originalStepKey, beforeDigest: before.digest, afterDigest: after.digest,
    instructionLimit, rowLimit, rowCount, instructionDigests: instructions.map(value => value.digest) };
  const result = Object.freeze({ cursor: handle(s.context, progress), instructions: Object.freeze(instructions), rowCount, originalStepKey,
    stepDigest: hash('calendar-series-projection-step-v1', metadata),
    progress: Object.freeze({ beforeDigest: before.digest, afterDigest: after.digest, checkpoint: progress }) });
  steps.set(result.cursor, result); return result;
}
