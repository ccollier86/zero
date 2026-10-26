'use client';

/** Optional low-stakes foreground observations. No identity, raw URL, fingerprint, document text or third-party analytics service. */
import { useEffect } from 'react';
import { createPublicBlogClient } from '../../frontend/client/blog-client';

/** One view plus one 30-second foreground observation per short-lived signed ticket; no attention or unique-person claim. */
export function useBlogPublicObservations(enabled: boolean, site: string, slug: string | undefined): void {
  useEffect(() => {
    if (!enabled || !slug) return;
    const owner = new AbortController(), client = createPublicBlogClient(window.location.origin);
    let timer: ReturnType<typeof setTimeout> | undefined, visibleMs = 0, visibleSince = document.hidden ? null : performance.now(), sent = false;
    const settle = () => { if (visibleSince !== null) { visibleMs += Math.max(0, performance.now() - visibleSince); visibleSince = null; } };
    let report: (() => void) | null = null;
    const schedule = () => {
      clearTimeout(timer); if (sent || document.hidden || !report) return;
      timer = setTimeout(report, Math.max(0, 30000 - visibleMs));
    };
    const visibility = () => { settle(); if (!document.hidden) visibleSince = performance.now(); schedule(); };
    document.addEventListener('visibilitychange', visibility);
    void client.metricTicket(site, slug, { signal: owner.signal }).then(async ticket => {
      if (owner.signal.aborted) return;
      await client.observe(site, slug, ticket.ticket, { kind: 'view', observedAt: Date.now(), visibleMs: 0 }, { signal: owner.signal });
      if (owner.signal.aborted) return;
      report = () => {
        settle(); if (sent || document.hidden || owner.signal.aborted || ticket.expiresAt <= Date.now()) return;
        sent = true;
        void client.observe(site, slug, ticket.ticket, { kind: 'engagement', observedAt: Date.now(), visibleMs: Math.min(300000, Math.round(visibleMs)) }, { signal: owner.signal }).catch(() => {});
      };
      // Context accumulated before the ticket is not evidence within that ticket's lifetime.
      visibleMs = 0; visibleSince = document.hidden ? null : performance.now(); schedule();
    }).catch(() => { /* Optional observations are best effort, never a page-access or audit-admission gate. */ });
    return () => { owner.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [enabled, site, slug]);
}
