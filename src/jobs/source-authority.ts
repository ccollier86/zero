/** @internal Fixed server composition only. Deliberately absent from all public/request exports. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { JobDefinition } from './definition';
import { JobsError } from './error';
import { normalizeJobSourceIdentity, type JobSourceIdentity } from './source-model';
import { jobText } from './validation';

declare const sourceBrand: unique symbol;
export interface TrustedJobSource { readonly [sourceBrand]: true }
interface SourceBinding {
  readonly identity: JobSourceIdentity; readonly scope: ServiceDataScope; readonly realmFingerprint: string;
  readonly policyVersion: string; readonly semanticsVersion: string; readonly definition: JobDefinition;
  /** Owner/runtime lifetime ONLY. Policy retirement uses eligibility guards; historical evidence remains readable. */
  readonly signal: AbortSignal;
  /** Verify established owner/root/realm/scope, independent of whether this policy is retired. */
  readonly assertOwnerCurrent: () => void; readonly confirmOwnerCurrent: () => Promise<void>;
  /** Current domain policy only; no asynchronous SQL/Guardian lease may be retained over dispatch. */
  readonly assertEligible: () => void; readonly confirmEligible: () => Promise<void>;
}
const bindings = new WeakMap<object, SourceBinding>();
/**
 * The installing native service must verify its established physical owner first.
 * This is not a public registration API: authored JSON, a clone or a guessed ID
 * cannot acquire this capability. The callbacks are trusted code, not predicates
 * received over HTTP. Explicitly bump semanticsVersion when callback/parser
 * behavior changes; callback.toString() is deliberately not an integrity proof.
 */
export function createTrustedJobSource(input: SourceBinding): TrustedJobSource {
  const identity = normalizeJobSourceIdentity(input.identity);
  if (identity.scopeId !== serviceDataScopeKey(input.scope) || !(input.signal instanceof AbortSignal)
    || !/^sha256:[a-f0-9]{64}$/.test(input.realmFingerprint)
    || ['assertOwnerCurrent', 'confirmOwnerCurrent', 'assertEligible', 'confirmEligible'].some(key => typeof input[key as keyof SourceBinding] !== 'function')) throw new JobsError('JOBS_CONFIG_INVALID');
  const binding: SourceBinding = Object.freeze({ ...input, identity, scope: Object.freeze({ ...input.scope }),
    policyVersion: jobText(input.policyVersion, 64), semanticsVersion: jobText(input.semanticsVersion, 64) });
  assertJobSourceOwner(binding);
  const capability = Object.freeze({}) as TrustedJobSource; bindings.set(capability, binding); return capability;
}
export function requireJobSource(source: TrustedJobSource): SourceBinding {
  const binding = source && typeof source === 'object' ? bindings.get(source) : undefined;
  if (!binding) throw new JobsError('JOBS_FORBIDDEN'); return binding;
}
export function assertJobSourceOwner(source: SourceBinding): void {
  source.signal.throwIfAborted();
  const result = invokeSynchronousAuthCallback(source.assertOwnerCurrent, { component: 'jobs', invariant: 'source-owner-is-synchronous',
    message: 'Source ownership checks must not yield.', createError: () => new JobsError('JOBS_CONFIG_INVALID') });
  if (result !== undefined) throw new JobsError('JOBS_CONFIG_INVALID');
}
export function assertJobSourceEligible(source: SourceBinding): void {
  assertJobSourceOwner(source);
  const result = invokeSynchronousAuthCallback(source.assertEligible, { component: 'jobs', invariant: 'source-eligibility-is-synchronous',
    message: 'Source eligibility checks must not yield.', createError: () => new JobsError('JOBS_CONFIG_INVALID') });
  if (result !== undefined) throw new JobsError('JOBS_CONFIG_INVALID');
}
export async function confirmJobSource(source: SourceBinding, eligible: boolean): Promise<void> {
  assertJobSourceOwner(source); await source.confirmOwnerCurrent(); assertJobSourceOwner(source);
  if (eligible) { assertJobSourceEligible(source); await source.confirmEligible(); assertJobSourceEligible(source); }
}
