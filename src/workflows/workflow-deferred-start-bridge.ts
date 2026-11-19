/** Private cryptographic bridge for adjacent durable services; no raw SQL, provider bag or weakened public actor lookup. */
import type { AuthContext } from '../auth/types';
import { assertWorkflowSynchronousAuthority } from './workflow-authority-assertion';
import { createSystemAuthority, scopeFromIdentity, type WorkflowAuthoritySeal, type WorkflowPersistedExecutionAuthority, type WorkflowSystemExecutionOptions } from './workflow-execution-authority';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import type { WorkflowGraphRuntime } from './workflow-graph-runtime';
import type { WorkflowIdempotentStartCoordinator } from './workflow-idempotent-start-coordinator';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowScopeBoundary } from './workflow-scope-boundary';
import { WorkflowError } from './workflow-error';
import type { WorkflowActorAuthorityFence } from './workflow-service';
import type { WorkflowPinnedStart, WorkflowDeferredStartInspection } from './workflow-deferred-start-contract';

const DOMAIN = 'zero.jobs.admission.v1';
const bridges = new WeakMap<object, WorkflowDeferredStartBridge>();
interface Dependencies {
  graph: WorkflowGraphRuntime; authority: WorkflowExecutionAuthorityGate; starts: WorkflowIdempotentStartCoordinator;
  repository: WorkflowRepository; scopes: WorkflowScopeBoundary;
  assertRuntimeCurrent(): void; captureActor(context: AuthContext): WorkflowActorAuthorityFence;
}
/** @internal Composition-time binding; never pass the resulting broker to a request or activity. */
export function bindWorkflowDeferredStarts(service: object, dependencies: Dependencies): void { bridges.set(service, new WorkflowDeferredStartBridge(dependencies)); }
/** @internal Intentionally not exported by @zero/framework/workflows or request service projection. */
export function workflowDeferredStarts(service: object): WorkflowDeferredStartBridge {
  const bridge = bridges.get(service); if (!bridge) throw unavailable(); return bridge;
}
export class WorkflowDeferredStartBridge {
  constructor(private readonly dependencies: Dependencies) {}
  assertRuntimeCurrent(): void { this.dependencies.assertRuntimeCurrent(); }
  actor(context: AuthContext): WorkflowPersistedExecutionAuthority {
    this.assertRuntimeCurrent(); const result = this.dependencies.captureActor(context); result.assertCurrentAuthority(); return result.authority;
  }
  system(options: WorkflowSystemExecutionOptions): WorkflowPersistedExecutionAuthority {
    this.assertRuntimeCurrent(); const scope = this.dependencies.scopes.requireScope(options.scope);
    return createSystemAuthority({ principal: options.principal, reason: options.reason, scope });
  }
  assertCurrent(authority: WorkflowPersistedExecutionAuthority): void {
    this.assertRuntimeCurrent(); this.dependencies.scopes.assertCompatible(scopeFromIdentity(authority.identity));
    if (authority.kind === 'actor') this.dependencies.authority.assertActorCurrent(authority);
    else this.dependencies.authority.assertSystemCurrent(authority, authority.identity.tenantId);
  }
  pin(authority: WorkflowPersistedExecutionAuthority, name: string, input: unknown, version: number): WorkflowPinnedStart {
    this.assertCurrent(authority); const pin = this.dependencies.graph.pinStart(name, input, authority, version); this.assertCurrent(authority); return pin;
  }
  /** Native fixed catalogs must prove their current registered code graph, never select a scoped database shadow. */
  pinRegistered(authority: WorkflowPersistedExecutionAuthority, name: string, input: unknown, version: number): WorkflowPinnedStart {
    this.assertCurrent(authority); const pin = this.dependencies.graph.pinRegisteredStart(name, input, authority, version); this.assertCurrent(authority); return pin;
  }
  /** Discovery stamp only, not the scoped/authorized pin required for enqueue. */
  registeredCatalogStamp(name: string, version: number): import('./workflow-deferred-start-contract').WorkflowRegisteredCatalogStamp {
    this.assertRuntimeCurrent(); const stamp = this.dependencies.graph.registeredCatalogStamp(name, version); this.assertRuntimeCurrent(); return stamp;
  }
  seal(authority: WorkflowPersistedExecutionAuthority, binding: string): WorkflowAuthoritySeal {
    this.assertCurrent(authority); return this.dependencies.authority.store.sealAuthority(DOMAIN, authority, bound(binding));
  }
  /** Opening evidence permits reconciliation only. A new dispatch still requires assertCurrent() plus live source eligibility. */
  open(seal: WorkflowAuthoritySeal, binding: string): WorkflowPersistedExecutionAuthority {
    this.assertRuntimeCurrent();
    if (!seal || typeof seal.authorityJson !== 'string' || typeof seal.authorityMac !== 'string') throw invalidSeal();
    const result = this.dependencies.authority.store.openAuthority(DOMAIN, bound(binding), seal.authorityJson, seal.authorityMac);
    if (!result) throw invalidSeal(); this.dependencies.scopes.assertCompatible(scopeFromIdentity(result.identity)); return result;
  }
  inspect(authority: WorkflowPersistedExecutionAuthority, pin: WorkflowPinnedStart, input: unknown, key: string, binding: string): WorkflowDeferredStartInspection | null {
    this.assertRuntimeCurrent();
    const receipt = this.dependencies.starts.reconcileSealed(pin.name, input, authority, key, { version: pin.version }, JSON.stringify(bound(binding)),
      { assertCurrentAuthority: () => this.assertRuntimeCurrent() });
    if (!receipt) return null;
    const instance = this.dependencies.repository.getInstance(receipt.instanceId);
    if (!instance || instance.definition_id !== pin.definitionId || instance.definition_version_id !== pin.versionId
      || instance.definition_version !== pin.version || instance.graph_fingerprint !== pin.fingerprint || instance.name !== pin.name
      || instance.tenant_id !== authority.identity.tenantId) throw new WorkflowError('Deferred start receipt does not match its admitted graph', 'WORKFLOW_STATE_INVALID', 500);
    this.assertRuntimeCurrent(); return Object.freeze({ receipt, status: instance.status });
  }
  enqueue(authority: WorkflowPersistedExecutionAuthority, pin: WorkflowPinnedStart, input: unknown, key: string, binding: string,
    assertSourceCurrent: () => void): Promise<import('./workflow-system-start-contract').WorkflowSystemStartResult> {
    const fence = () => {
      this.assertCurrent(authority); assertWorkflowSynchronousAuthority(assertSourceCurrent);
      const current = this.pin(authority, pin.name, input, pin.version);
      if (current.definitionId !== pin.definitionId || current.versionId !== pin.versionId || current.fingerprint !== pin.fingerprint) throw new WorkflowError('Deferred start definition changed', 'WORKFLOW_VERSION_CONFLICT', 409);
    };
    fence(); return this.dependencies.starts.enqueueSealed(pin.name, input, authority, key, { version: pin.version }, JSON.stringify(bound(binding)), { assertCurrentAuthority: fence });
  }
}
function bound(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new WorkflowError('Deferred admission binding is invalid', 'WORKFLOW_REQUEST_INVALID', 422);
  return value;
}
function unavailable() { return new WorkflowError('Deferred workflow admission is unavailable', 'WORKFLOW_NOT_READY', 503); }
function invalidSeal() { return new WorkflowError('Deferred workflow authority is invalid', 'WORKFLOW_AUTHORITY_REQUIRED', 403); }
