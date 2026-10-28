'use client';
/** Share private photo reads across repeated rows; no permanent URL or cross-account image cache. */
import { useEffect, useState } from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { Client } from '../../frontend/client/sdk';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { User } from '../animate-ui/icons/user';
interface Photo { refs: number; abort: AbortController; url: string | null; promise: Promise<string | null> }
const owners = new WeakMap<Client, Map<string, Photo>>();
function acquire(client: Client, key: string, userId: string) {
  let entries = owners.get(client); if (!entries) owners.set(client, entries = new Map());
  let photo = entries.get(key);
  if (!photo) {
    const abort = new AbortController();
    photo = { refs: 0, abort, url: null, promise: Promise.resolve(null) };
    const captured = photo;
    captured.promise = Promise.resolve().then(async () => {
      abort.signal.throwIfAborted();
      const entry = await client.userAvatar.directory(userId, abort.signal);
      if (!entry.asset) return null;
      const blob = await client.userAvatar.deliver(entry.asset, abort.signal);
      abort.signal.throwIfAborted(); captured.url = URL.createObjectURL(blob); return captured.url;
    }).catch(() => null); // Disabled/private/unavailable photos do not hide a retained event.
    entries.set(key, captured);
  }
  photo.refs++;
  const captured = photo; let released = false;
  return { promise: photo.promise, release() {
    if (released) return; released = true;
    if (--captured.refs > 0) return;
    // React retires old cells before acquiring their replacement effects.
    // Share through that one cleanup turn, not a timed/cross-scope image cache.
    queueMicrotask(() => {
      if (captured.refs > 0) return;
      captured.abort.abort(); if (captured.url) URL.revokeObjectURL(captured.url);
      if (entries!.get(key) === captured) entries!.delete(key);
    });
  } };
}
export function LoggingPersonAvatar({ userId, name, revision, className }: { userId?: string | null; name: string; revision?: number; className?: string }) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const key = JSON.stringify([boundary.key, userId, revision]), [image, setImage] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!client || !userId || !boundary.ready) return;
    let active = true; const lease = acquire(client, key, userId);
    void lease.promise.then(url => { if (active) setImage({ key, url }); });
    return () => { active = false; lease.release(); };
  }, [client, key, userId, boundary.ready]);
  const initials = name.trim().split(/\s+/u).slice(0, 2).map(part => [...part][0]).join('').toUpperCase() || '?';
  return <Avatar aria-hidden="true" className={className}><AvatarImage src={boundary.ready && image?.key === key ? image.url ?? undefined : undefined} alt="" />
    <AvatarFallback className="text-[11px]">{userId ? initials : <User className="size-4" />}</AvatarFallback></Avatar>;
}
