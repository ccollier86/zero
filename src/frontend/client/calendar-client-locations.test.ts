/** Browser transport and stream fixtures are memory-only; no server, SQLite file or generated output. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import type { FetchInit } from './sdk';

const location = { id: 'location-a', label: 'Synthetic location', region: 'US.NY', active: true, revision: 1 };
const page = { items: [location], truncated: false, nextAfter: null };
const assignment = { resourceId: 'resource-a', resourceRevision: 3, locationIds: ['location-a', 'location-b'] };
const receipt = { requestId: 'original-key', operation: 'location.created', id: location.id, revision: 1, changed: true };

test('location and resource facets use exact native paths/envelopes with detached JSON and control revisions', async () => {
  const calls: { path: string; init?: FetchInit }[] = [], signal = new AbortController().signal;
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init });
    if (init?.method === 'PUT') return { ...receipt, operation: path.includes('/resources/') ? 'resource.locations-changed' : 'location.updated',
      id: path.includes('/resources/') ? 'resource-a' : location.id } as T;
    if (init?.method === 'POST') return receipt as T;
    return (path.includes('/resources/') ? assignment : path.includes('/resources?') ? { items: [], truncated: false, nextAfter: null }
      : path.includes('/locations/') ? location : page) as T;
  });
  try {
    const input = { label: location.label, region: location.region, active: true }, supplied = { idempotencyKey: 'original-key', signal };
    const creating = client.locations.create(input, supplied); input.label = 'Changed'; supplied.idempotencyKey = 'changed'; await creating;
    await client.locations.list({ limit: 5, after: 'cursor-a' }, { signal });
    expect(await client.locations.get(location.id, { signal })).toEqual(location);
    const replacement = { label: location.label, region: null, active: false }, control = { idempotencyKey: 'original-key', expectedRevision: 2, signal };
    const replacing = client.locations.replace(location.id, replacement, control); replacement.active = true; control.expectedRevision = 99; await replacing;
    const current = await client.locations.forResource('resource-a', { signal });
    expect(current).toEqual(assignment); expect(Object.isFrozen(current.locationIds)).toBe(true);
    const ids = ['location-b', 'location-a']; const setting = client.resources.setLocations('resource-a', ids, { idempotencyKey: 'original-key', expectedRevision: 3, signal });
    ids[0] = 'changed'; await setting;
    await client.resources.list({ locationIds: ['location-b', 'location-a'], regions: ['US.NY', 'US.CA'], limit: 5 }, { signal });
    await client.resources.list({ locationIds: [], regions: [] });
    expect(calls.map(call => call.path)).toEqual(['/api/calendar/locations', '/api/calendar/locations?limit=5&after=cursor-a',
      '/api/calendar/locations/location-a', '/api/calendar/locations/location-a', '/api/calendar/resources/resource-a/locations',
      '/api/calendar/resources/resource-a/locations', '/api/calendar/resources?limit=5&locationIds=location-a%2Clocation-b&regions=US.CA%2CUS.NY',
      '/api/calendar/resources?locationIds=&regions=']);
    expect(calls[0]!.init!.body).toEqual({ location: { label: location.label, region: 'US.NY', active: true }, options: { idempotencyKey: 'original-key' } });
    expect(calls[3]!.init).toMatchObject({ method: 'PUT', body: { location: { label: location.label, region: null, active: false }, options: { idempotencyKey: 'original-key', expectedRevision: 2 } } });
    expect(calls[5]!.init).toMatchObject({ method: 'PUT', body: { locationIds: assignment.locationIds, options: { idempotencyKey: 'original-key', expectedRevision: 3 } } });
    const currentPage = await client.locations.list(); expect(Object.isFrozen(currentPage.items[0])).toBe(true);
    for (const call of calls) expect(call.init!.signal).toBeInstanceOf(AbortSignal);
  } finally { client.clear(); }
});

test('location admission rejects unknown authority, accessors, incomplete replacements and unbounded/invalid facets before dispatch', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt as T; });
  const control = { idempotencyKey: 'original-key', expectedRevision: 1 };
  try {
    for (const field of ['actor', 'id', 'scopeId', 'requestId', 'revision', 'manageAll', 'timeZone']) {
      expect(() => client.locations.create({ label: 'Location', [field]: 'forged' }, control)).toThrow();
    }
    for (const region of ['', 'US NY', '-US', 'é', 'x'.repeat(65)]) {
      expect(() => client.locations.create({ label: 'Location', region }, control)).toThrow();
      expect(() => client.resources.list({ regions: [region] })).toThrow();
    }
    for (const input of [{ label: 'Location' }, { label: 'Location', region: null }, { label: 'Location', active: true },
      { label: 'Location', region: undefined, active: true }, { label: '', region: null, active: false }]) {
      expect(() => client.locations.replace(location.id, input as never, control)).toThrow();
    }
    const input = { get label() { getters++; return 'Location'; } };
    expect(() => client.locations.create(input, control)).toThrow();
    for (const locationIds of [['duplicate', 'duplicate'], Array.from({ length: 17 }, (_, i) => 'location-' + i), ['bad/id']]) {
      expect(() => client.resources.setLocations('resource-a', locationIds, control)).toThrow();
      expect(() => client.resources.list({ locationIds })).toThrow();
    }
    for (const regions of [['US.NY', 'US.NY'], Array.from({ length: 17 }, (_, i) => 'region-' + i)]) {
      expect(() => client.resources.list({ regions })).toThrow();
    }
    expect(() => client.locations.list({ regions: [] } as never)).toThrow();
    expect(() => client.resources.setLocations('resource-a', [], { idempotencyKey: 'original-key' } as never)).toThrow();
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});

test('location reads reject mismatched identities, malformed catalog fields and unsafe pagination/assignment DTOs', async () => {
  for (const wire of [{ ...location, id: 'different' }, { ...location, region: 'not a region' }, { ...location, active: 1 },
    { ...location, revision: 0 }, { ...location, private: 'NEVER' }, { ...location, region: undefined }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.locations.get(location.id)).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  for (const wire of [{ ...page, items: [location, location] }, { ...page, truncated: true },
    { ...page, truncated: true, nextAfter: 'different' }, { items: [], truncated: true, nextAfter: location.id }, { ...page, private: 'NEVER' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.locations.list()).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  for (const wire of [{ ...assignment, resourceId: 'different' }, { ...assignment, resourceRevision: 0 },
    { ...assignment, locationIds: ['location-b', 'location-a'] }, { ...assignment, locationIds: ['location-a', 'location-a'] }, { ...assignment, region: 'NEVER' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.locations.forResource('resource-a')).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
});

test('new PUT commands bind receipt operation/id and retire with original-key unknown outcomes without replay', async () => {
  for (const wire of [{ ...receipt, operation: 'location.created' }, { ...receipt, operation: 'location.updated', id: 'different' },
    { ...receipt, operation: 'location.updated', requestId: 'different' }, { ...receipt, operation: 'resource.locations-changed' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try {
      const failure = await client.locations.replace(location.id, { label: location.label, region: location.region, active: true }, { idempotencyKey: 'original-key', expectedRevision: 1 }).catch(error => error);
      expect(failure).toMatchObject({ outcome: 'unknown', idempotencyKey: 'original-key', requiresReconciliation: true });
    } finally { client.clear(); }
  }
  for (const target of ['location', 'resource'] as const) {
    let finish!: (value: unknown) => void, calls = 0;
    const client = createCalendarClient(<T>() => { calls++; return new Promise<T>(resolve => { finish = resolve as (value: unknown) => void; }); });
    try {
      const control = { idempotencyKey: 'original-key', expectedRevision: 1 };
      const pending = (target === 'location' ? client.locations.replace(location.id, { label: location.label, region: null, active: false }, control)
        : client.resources.setLocations('resource-a', [], control)).catch(error => error);
      client.clear(); finish({ ...receipt, operation: target === 'location' ? 'location.updated' : 'resource.locations-changed', id: target === 'location' ? location.id : 'resource-a' });
      expect(await pending).toMatchObject({ name: 'AbortError', outcome: 'unknown', idempotencyKey: 'original-key' }); expect(calls).toBe(1);
    } finally { client.clear(); }
  }
});

test('location and resource pages stay bound to detached cursors/limits and canonical ascending IDs', async () => {
  const resource = { id: 'location-a', label: 'Resource', kind: 'room', ownerId: null, timeZone: 'UTC', revision: 1, active: true };
  for (const kind of ['locations', 'resources'] as const) {
    const item = kind === 'locations' ? location : resource;
    for (const [query, wire] of [
      [{ after: 'z', limit: 1 }, { items: [item], truncated: false, nextAfter: null }],
      [{ limit: 1 }, { items: [item, { ...item, id: 'location-b' }], truncated: false, nextAfter: null }],
      [{ limit: 2 }, { items: [{ ...item, id: 'location-b' }, item], truncated: false, nextAfter: null }],
      [{ limit: 2 }, { items: [item], truncated: true, nextAfter: item.id }],
      [{}, { items: Array.from({ length: 26 }, (_, index) => ({ ...item, id: 'item-' + String(index).padStart(2, '0') })), truncated: false, nextAfter: null }],
    ] as const) {
      const client = createCalendarClient(async <T>() => wire as T);
      try { await expect(client[kind].list(query)).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
    }
    // A configured server may narrow its default page below25; no explicit SDK limit was supplied.
    const client = createCalendarClient(async <T>() => ({ items: [item], truncated: true, nextAfter: item.id }) as T);
    try { expect((await client[kind].list()).items).toHaveLength(1); } finally { client.clear(); }
  }
});

test('catalog/resource watches encode detached facets, parse strict snapshots, and stop on invalid private data or boundary retirement', async () => {
  const paths: string[] = [], controllers: ReadableStreamDefaultController<Uint8Array>[] = [], pages: unknown[] = [], errors: unknown[] = [];
  const signals: AbortSignal[] = [];
  const client = createCalendarClient(async () => { throw new Error('Watch must not fetch separately.'); }, async (path, init) => {
    paths.push(path); signals.push(init.signal as AbortSignal);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  let stopLocation = () => {}, stopResource = () => {};
  const frame = (value: unknown) => new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify({ version: 1, value }) + '\n\n');
  try {
    const query = { limit: 4, locationIds: ['location-b', 'location-a'], regions: ['US.NY'] };
    stopLocation = client.locations.watch({ limit: 2, after: 'cursor' }, value => pages.push(value), { onError: error => errors.push(error) });
    stopResource = client.resources.watch(query, value => pages.push(value), { onError: error => errors.push(error) });
    query.locationIds[0] = 'retargeted'; query.regions[0] = 'retargeted';
    expect(paths).toEqual(['/api/calendar/locations/live?limit=2&after=cursor', '/api/calendar/resources/live?limit=4&locationIds=location-a%2Clocation-b&regions=US.NY']);
    controllers[0]!.enqueue(frame(page)); controllers[1]!.enqueue(frame({ items: [], truncated: false, nextAfter: null }));
    await eventually(() => pages.length === 2);
    controllers[0]!.enqueue(frame({ ...page, items: [{ ...location, private: 'NEVER_DELIVER' }] }));
    await eventually(() => errors.length === 1); expect(pages).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true); client.clear(); expect(signals[1]!.aborted).toBe(true);
  } finally { stopLocation(); stopResource(); client.clear(); }
});

test('location and resource-assignment detail watches bind every delivered DTO to the requested identity', async () => {
  for (const kind of ['location', 'assignment'] as const) {
    let controller!: ReadableStreamDefaultController<Uint8Array>, signal!: AbortSignal, path = '', deliveries = 0, errors = 0;
    const client = createCalendarClient(async () => { throw new Error('Detail watch cannot fetch separately.'); }, async (target, init) => {
      path = target; signal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const listener = () => { deliveries++; }, options = { onError() { errors++; } };
    const stop = kind === 'location' ? client.locations.watchLocation(location.id, listener, options) : client.locations.watchForResource('resource-a', listener, options);
    const frame = (value: unknown) => new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify({ version: 1, value }) + '\n\n');
    try {
      expect(path).toBe(kind === 'location' ? '/api/calendar/locations/location-a/live' : '/api/calendar/resources/resource-a/locations/live');
      controller.enqueue(frame(kind === 'location' ? location : assignment)); await eventually(() => deliveries === 1);
      controller.enqueue(frame(kind === 'location' ? { ...location, id: 'different' } : { ...assignment, resourceId: 'different' }));
      await eventually(() => errors === 1); expect(deliveries).toBe(1); expect(signal.aborted).toBe(true);
    } finally { stop(); client.clear(); }
  }
});

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise<void>(resolve => setTimeout(resolve, 5)); }
  throw new Error('Memory client fixture timed out.');
}
