import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

import { defineSchema, field } from '../schema';
import type { Row } from '../sync/types';
import { ClientProvider } from '../frontend/client/client-context';
import type { Collection } from '../frontend/client/sdk';
import type { AuthClient } from '../frontend/client/auth-client';
import type { Client } from '../frontend/client/sdk';
import { useForm } from './use-form';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../frontend/client/observability';

type FormRow = Row & { id: string; title: string };

const schema = defineSchema({
  id: field.text({ required: true }),
  title: field.text({ required: true }),
});

const activeRoots = new Set<Root>();
let restoreDom: (() => void) | null = null;
let events: FrontendObservabilityEvent[] = [];

beforeEach(() => {
  restoreDom = installMinimalDom();
  events = [];
  configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
});

afterEach(async () => {
  for (const root of [...activeRoots]) {
    await act(async () => root.unmount());
    activeRoots.delete(root);
  }
  restoreDom?.();
  restoreDom = null;
  configureFrontendObservability({ http: false, console: false });
});

describe('useForm collection submission', () => {
  test('waits for the insert receipt before success and clearing submitting state', async () => {
    const receipt = deferred<void>();
    const calls: string[] = [];
    const collection = {
      insertAsync: () => {
        calls.push('insertAsync');
        return receipt.promise;
      },
    } as unknown as Collection<FormRow>;
    const successes: string[] = [];
    const rendered = await renderForm({
      collection,
      onSuccess: () => successes.push('success'),
    });

    let submission!: Promise<void>;
    await act(async () => {
      submission = rendered.current.handleSubmit();
      await Promise.resolve();
    });

    expect(calls).toEqual(['insertAsync']);
    expect(successes).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      receipt.resolve();
      await submission;
    });

    expect(successes).toEqual(['success']);
    expect(rendered.current.isSubmitting).toBe(false);
  });

  test('waits for update receipts and routes receipt rejection to onError', async () => {
    const receipt = deferred<void>();
    const updates: Array<{ id: string; partial: Partial<FormRow> }> = [];
    const collection = {
      getAll: () => ({ 'row-1': { id: 'row-1', title: 'A title' } }),
      updateAsync: (id: string, partial: Partial<FormRow>) => {
        updates.push({ id, partial });
        return receipt.promise;
      },
    } as unknown as Collection<FormRow>;
    const successes: string[] = [];
    const errors: string[] = [];
    const rendered = await renderForm({
      collection,
      mode: 'edit',
      editId: 'row-1',
      onSuccess: () => successes.push('success'),
      onError: (error) => errors.push(error),
    });

    let submission!: Promise<void>;
    await act(async () => {
      submission = rendered.current.handleSubmit();
      await Promise.resolve();
    });

    expect(updates).toEqual([{ id: 'row-1', partial: { title: 'A title' } }]);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      receipt.reject(new Error('server rejected mutation'));
      await submission;
    });

    expect(successes).toEqual([]);
    expect(errors).toEqual(['server rejected mutation']);
    expect(rendered.current.isSubmitting).toBe(false);
  });

  test('same-render rapid submits only issue one collection mutation', async () => {
    const receipt = deferred<void>();
    let inserts = 0;
    const collection = {
      insertAsync: () => {
        inserts += 1;
        return receipt.promise;
      },
    } as unknown as Collection<FormRow>;
    const rendered = await renderForm({ collection });

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = rendered.current.handleSubmit();
      second = rendered.current.handleSubmit();
      await Promise.resolve();
    });

    expect(inserts).toBe(1);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      receipt.resolve();
      await Promise.all([first, second]);
    });
    expect(rendered.current.isSubmitting).toBe(false);
  });

  test('a failed accepted-success notification is not reported as a failed write', async () => {
    let inserts = 0;
    const collection = { insertAsync: async () => { inserts += 1; } } as unknown as Collection<FormRow>;
    const errors: string[] = [];
    const rendered = await renderForm({
      collection,
      onSuccess: () => { throw new Error('private notification contents'); },
      onError: (message) => errors.push(message),
    });
    await act(async () => { await rendered.current.handleSubmit(); });
    expect(inserts).toBe(1);
    expect(errors).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.code).toBe('frontend.mutation.failed');
    expect(events[0]?.metadata).toEqual({ surface: 'use-form', stage: 'accepted-callback' });
    expect(JSON.stringify(events)).not.toContain('private notification contents');
  });

  test('an async accepted notification finishing in an old scope cannot affect the new form', async () => {
    const notification = deferred<void>();
    const nextReceipt = deferred<void>();
    let inserts = 0;
    let notifications = 0;
    const collection = { insertAsync: () => ++inserts === 1 ? Promise.resolve() : nextReceipt.promise } as unknown as Collection<FormRow>;
    const errors: string[] = [];
    const scopeClient = createScopeClient();
    const rendered = await renderForm({
      collection, client: scopeClient.value,
      onSuccess: () => ++notifications === 1 ? notification.promise : undefined,
      onError: (message) => errors.push(message),
    });
    let previous!: Promise<void>;
    await act(async () => { previous = rendered.current.handleSubmit(); await Promise.resolve(); });
    expect(notifications).toBe(1);
    expect(rendered.current.isSubmitting).toBe(true);
    await act(async () => scopeClient.replaceScope());
    let replacement!: Promise<void>;
    await act(async () => { replacement = rendered.current.handleSubmit(); await Promise.resolve(); });
    await act(async () => { notification.reject(new Error('obsolete notification contents')); await previous; });
    expect(rendered.current.isSubmitting).toBe(true);
    expect(errors).toEqual([]);
    expect(events).toEqual([]);
    await act(async () => { nextReceipt.resolve(); await replacement; });
    expect(rendered.current.isSubmitting).toBe(false);
    expect(inserts).toBe(2);
  });

  test('stale receipt cannot call callbacks or clear a replacement scope submission', async () => {
    const oldReceipt = deferred<void>();
    const newReceipt = deferred<void>();
    const receipts = [oldReceipt, newReceipt];
    let inserts = 0;
    const collection = {
      insertAsync: () => receipts[inserts++]!.promise,
    } as unknown as Collection<FormRow>;
    const successes: string[] = [];
    const errors: string[] = [];
    const scopeClient = createScopeClient();
    const rendered = await renderForm({
      collection,
      client: scopeClient.value,
      onSuccess: () => successes.push('success'),
      onError: (error) => errors.push(error),
    });

    let oldSubmission!: Promise<void>;
    await act(async () => {
      oldSubmission = rendered.current.handleSubmit();
      await Promise.resolve();
    });
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => scopeClient.replaceScope());
    expect(rendered.current.isSubmitting).toBe(false);

    let newSubmission!: Promise<void>;
    await act(async () => {
      newSubmission = rendered.current.handleSubmit();
      await Promise.resolve();
    });
    expect(inserts).toBe(2);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      oldReceipt.reject(new Error('old scope rejection'));
      await oldSubmission;
    });

    expect(successes).toEqual([]);
    expect(errors).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      newReceipt.resolve();
      await newSubmission;
    });
    expect(successes).toEqual(['success']);
    expect(errors).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(false);
  });
});

async function renderForm(options: {
  collection: Collection<FormRow>;
  mode?: 'create' | 'edit';
  editId?: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  client?: Client;
}): Promise<{ current: ReturnType<typeof useForm<FormRow>> }> {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createContainer());
  activeRoots.add(root);
  let current!: ReturnType<typeof useForm<FormRow>>;

  function Capture(): ReactNode {
    current = useForm<FormRow>({
      schema,
      defaultValues: { id: 'row-1', title: 'A title' },
      collection: options.collection,
      mode: options.mode,
      editId: options.editId,
      onSuccess: options.onSuccess,
      onError: options.onError,
    });
    return null;
  }

  await act(async () => root.render(options.client
    ? createElement(ClientProvider, {
        client: options.client,
        children: createElement(Capture),
      })
    : createElement(Capture)));
  return { get current() { return current; } };
}

function createScopeClient(): { value: Client; replaceScope(): void } {
  let authState = {
    authorizationScopeKey: 'scope-a',
    user: { userId: 'user-a' },
    activeTenant: { tenantId: 'tenant-a' },
    isLoading: false,
    isAuthenticated: true,
    isRestoring: false,
    authorizationState: { status: 'ready' },
    sessionTransition: {
      phase: 'idle',
      operation: null,
      revision: 0,
      recoverable: false,
      error: null,
    },
  };
  const listeners = new Set<() => void>();
  const auth = {
    ...authState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeAuthorization: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AuthClient;

  function replaceScope() {
    authState = {
      ...authState,
      authorizationScopeKey: 'scope-b',
      user: { userId: 'user-b' },
      activeTenant: { tenantId: 'tenant-b' },
    };
    Object.assign(auth, authState);
    for (const listener of listeners) listener();
  }

  return {
    value: { auth } as unknown as Client,
    replaceScope,
  };
}

function createContainer(): Element {
  const document = globalThis.document as unknown as Record<string, unknown>;
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    textContent: '',
    firstChild: null,
  } as unknown as Element;
}

function installMinimalDom(): () => void {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  class HTMLIFrameElement {}
  const window = { HTMLIFrameElement, document: null as unknown };
  const document = {
    nodeType: 9,
    defaultView: window,
    activeElement: null,
    body: null,
    addEventListener() {},
    removeEventListener() {},
  };
  window.document = document;
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: window },
    document: { configurable: true, writable: true, value: document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise(undefined as T);
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
