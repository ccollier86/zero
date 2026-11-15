/** Pure, code-owned scheduling contracts. Version explicitly when parser/policy semantics change; never serialize executable code. */
import { isDeepStrictEqual, types as utilTypes } from 'node:util';
import type { AccessRequirement } from '../auth/authorization-kernel';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { JobsError } from './error';
import { jobHash, jobInput, jobInteger, jobRecord, jobText, type JobValue } from './validation';

/** Service lifetime is a deliberate code policy, not an actor-to-SYSTEM fallback after a user's session expires. */
export interface JobServicePolicy {
  readonly principal: string;
  readonly scopes: readonly ('application' | 'tenant')[];
  /** Must synchronously inspect current app-owned eligibility at admission and again before a new handoff. */
  readonly isEligible: (context: { readonly scope: ServiceDataScope; readonly ownerId: string }, input: JobValue) => boolean;
}
export interface JobDefinitionInput<Input> {
  readonly name: string;
  readonly version: string;
  /** New name-only admissions select this version. Retained non-default versions remain available for recovery. Default: true. */
  readonly default?: boolean;
  readonly workflow: { readonly name: string; readonly version: number };
  readonly parseInput: (input: JobValue) => Input;
  /** Omitted means administrator, not public or every signed-in account. Compiled against Guardian at managed configuration. */
  readonly access?: AccessRequirement;
  readonly service?: JobServicePolicy;
}
declare const jobInputType: unique symbol;
export interface JobDefinition<Input = unknown> {
  readonly [jobInputType]?: { readonly input: Input };
  readonly name: string; readonly version: string; readonly fingerprint: string; readonly default: boolean;
  readonly workflow: Readonly<{ name: string; version: number }>;
  readonly access: AccessRequirement;
  readonly service: JobServicePolicy | null;
  readonly parseInput: (input: unknown) => JobValue;
}
export type JobDefinitionValue<Definition extends JobDefinition> = NonNullable<Definition[typeof jobInputType]>['input'];
const registered = new WeakSet<JobDefinition>();
export function defineJob<Input>(definition: JobDefinitionInput<Input>): JobDefinition<Input> {
  try {
    const r = jobRecord(definition, ['name', 'version', 'default', 'workflow', 'parseInput', 'access', 'service']);
    const name = nameValue(r.name), version = versionValue(r.version), workflow = jobRecord(r.workflow, ['name', 'version']);
    if (typeof r.parseInput !== 'function' || r.default !== undefined && typeof r.default !== 'boolean') throw new JobsError('JOBS_CONFIG_INVALID');
    const pin = Object.freeze({ name: jobText(workflow.name, 200), version: jobInteger(workflow.version, 1) });
    if (pin.name.trim() !== pin.name) throw new JobsError('JOBS_CONFIG_INVALID');
    const parse = r.parseInput as (input: JobValue) => unknown, access = freeze(jobInput(r.access ?? 'admin')) as AccessRequirement;
    const service = r.service === undefined ? null : servicePolicy(r.service);
    // Portable semantic declaration, not a function.toString() or executable-integrity claim.
    const fingerprint = jobHash({ name, version, workflow: pin, access, service: service ? { principal: service.principal, scopes: service.scopes } : null });
    const result: JobDefinition<Input> = Object.freeze({ name, version, fingerprint, default: r.default ?? true, workflow: pin, access, service,
      parseInput(input: unknown) {
        try {
          const value = parseValue(parse, input);
          if (!isDeepStrictEqual(value, parseValue(parse, value))) throw new JobsError('JOBS_INPUT_INVALID');
          return value;
        } catch { throw new JobsError('JOBS_INPUT_INVALID'); }
      } });
    registered.add(result); return result;
  } catch { throw new JobsError('JOBS_CONFIG_INVALID'); }
}
export class JobDefinitionCatalog {
  private readonly definitions = new Map<string, JobDefinition>();
  private readonly defaults = new Map<string, JobDefinition>();
  readonly fingerprint: string;
  constructor(definitions: readonly JobDefinition[]) {
    if (!Array.isArray(definitions) || utilTypes.isProxy(definitions) || Object.getPrototypeOf(definitions) !== Array.prototype || definitions.length > 256) throw new JobsError('JOBS_CONFIG_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(definitions);
    if (Reflect.ownKeys(definitions).length !== definitions.length + 1) throw new JobsError('JOBS_CONFIG_INVALID');
    for (let index = 0; index < definitions.length; index++) {
      const entry = descriptors[String(index)]; if (!entry || !('value' in entry)) throw new JobsError('JOBS_CONFIG_INVALID');
      const definition = entry.value as JobDefinition;
      if (!registered.has(definition) || this.definitions.has(key(definition.name, definition.version)) || definition.default && this.defaults.has(definition.name)) throw new JobsError('JOBS_CONFIG_INVALID');
      this.definitions.set(key(definition.name, definition.version), definition);
      if (definition.default) this.defaults.set(definition.name, definition);
    }
    const metadata = [...this.definitions.values()].map(item => ({ name: item.name, version: item.version, fingerprint: item.fingerprint, default: item.default }));
    metadata.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    this.fingerprint = jobHash(metadata);
  }
  resolve(target: string | JobDefinition, version?: string): JobDefinition {
    const definition = typeof target === 'string' ? version === undefined ? this.defaults.get(target) : this.definitions.get(key(target, version))
      : version === undefined && registered.has(target) && this.definitions.get(key(target.name, target.version)) === target ? target : undefined;
    if (!definition) throw new JobsError('JOBS_DEFINITION_UNAVAILABLE'); return definition;
  }
  list(): readonly JobDefinition[] { return Object.freeze([...this.definitions.values()]); }
}
function key(name: string, version: string): string { return name + ':' + version; }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
export function assertJobServiceEligibility(definition: JobDefinition, scope: ServiceDataScope, ownerId: string, input: JobValue): void {
  const policy = definition.service;
  if (!policy || !policy.scopes.includes(scope.scopeKind)) throw new JobsError('JOBS_FORBIDDEN');
  let eligible = false;
  invokeSynchronousAuthCallback(() => {
    const result = policy.isEligible(Object.freeze({ scope, ownerId }), jobInput(input));
    if (result === true) eligible = true;
    else if (result !== false) {
      // Consume only genuine promise rejection, never an authored then getter.
      try { Promise.prototype.then.call(result, undefined, () => {}); } catch {}
      throw new JobsError('JOBS_CONFIG_INVALID');
    }
  }, { component: 'jobs', invariant: 'service-eligibility-is-synchronous', message: 'Job eligibility must not yield.', createError: () => new JobsError('JOBS_CONFIG_INVALID') });
  if (!eligible) throw new JobsError('JOBS_AUTHORITY_RETIRED');
}
function nameValue(input: unknown): string { const value = jobText(input, 96); if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)) throw new JobsError('JOBS_CONFIG_INVALID'); return value; }
function versionValue(input: unknown): string { const value = jobText(input, 64); if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) throw new JobsError('JOBS_CONFIG_INVALID'); return value; }
function servicePolicy(input: unknown): JobServicePolicy {
  const r = jobRecord(input, ['principal', 'scopes', 'isEligible']), principal = jobText(r.principal, 96);
  const scopes = jobInput(r.scopes);
  if (!/^[A-Za-z][A-Za-z0-9._:-]*$/.test(principal) || !Array.isArray(scopes) || !scopes.length || scopes.length > 2
    || scopes.some(scope => typeof scope !== 'string' || !['application', 'tenant'].includes(scope)) || new Set(scopes).size !== scopes.length || typeof r.isEligible !== 'function') throw new JobsError('JOBS_CONFIG_INVALID');
  return Object.freeze({ principal, scopes: Object.freeze([...scopes].sort()) as readonly ('application' | 'tenant')[], isEligible: r.isEligible as JobServicePolicy['isEligible'] });
}
function parseValue(parse: (input: JobValue) => unknown, input: unknown): JobValue {
  const value = parse(jobInput(input));
  try { return jobInput(value); }
  catch (error) { try { Promise.prototype.then.call(value, undefined, () => {}); } catch {} throw error; }
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
