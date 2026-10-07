'use client';

/** Account availability controls observe the SDK tracker; they never start another activity lease. */
import { useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useGuardianPresence } from '../../frontend/client/guardian-presence-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/utils';

export interface UserPresenceSettingsProps {
  readOnly?: boolean;
  /** Null keeps manual availability until changed; the server validates any duration. */
  expiresAfterMs?: number | null;
  className?: string;
}

export function UserPresenceSettings({ readOnly = false, expiresAfterMs = null, className }: UserPresenceSettingsProps) {
  const presence = useGuardianPresence(), boundary = useAuthorizationScopeBoundary(), id = useId();
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ controller: AbortController; kind: 'read' | 'mutation' } | null>(null);
  const enabled = Boolean(presence.capabilities?.enabled), ready = presence.status === 'ready';
  useEffect(() => {
    setError(null);
    request.current?.controller.abort(); request.current = null;
    if (!enabled || !ready || !boundary.ready) return;
    const operation = { controller: new AbortController(), kind: 'read' as const }; request.current = operation;
    void presence.getSelf(operation.controller.signal).catch(() => {
      if (!operation.controller.signal.aborted && request.current === operation) setError('Your availability could not be loaded. Retry to review it.');
    });
    return () => { operation.controller.abort(); if (request.current === operation) request.current = null; };
  }, [enabled, ready, boundary.key, boundary.ready, presence.getSelf]);
  useEffect(() => () => { request.current?.controller.abort(); }, []);
  useEffect(() => { if (readOnly && request.current?.kind === 'mutation') request.current.controller.abort(); }, [readOnly]);
  if (presence.status === 'disabled' || presence.capabilities?.state === 'disabled') return null;
  const definitions = presence.capabilities?.statuses ?? [];
  const selected = presence.self?.intent.status;
  const label = definitions.find(status => status.key === selected)?.label ?? 'Loading availability…';
  const locked = readOnly || !ready || !presence.capabilities?.canSetIntent || !presence.self || presence.saving;
  const update = async (status: string) => {
    if (locked || !presence.self || status === selected) return;
    request.current?.controller.abort(); const operation = { controller: new AbortController(), kind: 'mutation' as const }; request.current = operation; setError(null);
    try {
      await presence.updateIntent({ status, expectedRevision: presence.self.intent.revision, expiresAfterMs }, operation.controller.signal);
    } catch {
      if (!operation.controller.signal.aborted && request.current === operation) {
        setError('Availability was not saved. Retry to review the current value before changing it.');
      }
    } finally { if (request.current === operation) request.current = null; }
  };
  return <section className={cn('profile-settings__section', className)} aria-label="Availability" data-slot="user-presence-settings">
    <header className="profile-settings__section-header"><h3>Availability</h3>
      <p>Your status follows real activity and connection state. Busy or Away stays selected until you change it{expiresAfterMs === null ? '.' : ' or its time limit expires.'}</p></header>
    <div className="profile-settings__field">
      <Label className="profile-settings__label" htmlFor={id}>Status</Label>
      <div className="min-w-0 space-y-1.5">
        {readOnly || ready && !presence.capabilities?.canSetIntent
          ? <Input id={id} value={label} readOnly aria-label="Status" />
          : <Select value={selected ?? ''} disabled={locked} onValueChange={status => { void update(status); }}>
            <SelectTrigger id={id} aria-label="Status"><SelectValue placeholder="Loading availability…" /></SelectTrigger>
            <SelectContent>{definitions.filter(status => status.selectable).map(status =>
              <SelectItem key={status.key} value={status.key}>{status.label}</SelectItem>)}</SelectContent>
          </Select>}
        {presence.saving && <p className="profile-settings__hint" role="status">Saving availability…</p>}
        {!ready && <p className="profile-settings__hint" role="status">{presence.status === 'error'
          ? 'Presence is unavailable. Other profile settings are still usable.' : 'Connecting to presence…'}</p>}
        {(error || presence.error) && <p className="profile-settings__contact-error" role="alert">{error ?? presence.error}</p>}
        {(error || presence.error || presence.status === 'error') && <Button type="button" size="sm" variant="ghost" disabled={presence.saving}
          onClick={() => { setError(null); if (ready) { request.current?.controller.abort(); const operation = { controller: new AbortController(), kind: 'read' as const }; request.current = operation;
            void presence.getSelf(operation.controller.signal).catch(() => { if (!operation.controller.signal.aborted && request.current === operation) setError('Availability could not be loaded. Please retry.'); });
          } else void presence.refresh(); }}><RefreshCw />Retry availability</Button>}
      </div>
    </div>
  </section>;
}
