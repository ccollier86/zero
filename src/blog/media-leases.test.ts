/** Expired/replaced media workers cannot publish late or erase another worker's lease. Synthetic in-memory SYSTEM only. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { installBlogContentOwnerSchema } from './content-owner-schema';
import { withBlogMediaLease } from './media-leases';

test('crashed/expired work is reclaimable and the previous owner remains fenced after replacement', async () => {
  const db = createReactiveDB({ mode: 'memory' }); installBlogContentOwnerSchema(db, true);
  let entered!: () => void, release!: () => void, secondEntered!: () => void, secondRelease!: () => void;
  const firstStarted = new Promise<void>(resolve => { entered = resolve; }), firstHold = new Promise<void>(resolve => { release = resolve; });
  const nextStarted = new Promise<void>(resolve => { secondEntered = resolve; }), nextHold = new Promise<void>(resolve => { secondRelease = resolve; });
  const failures: string[] = [];
  try {
    const first = withBlogMediaLease(db, 'asset', () => {}, async fence => { entered(); await firstHold; fence(); return 'late'; }, () => failures.push('cleanup'));
    await firstStarted;
    await expect(withBlogMediaLease(db, 'asset', () => {}, async () => 'must-not-run', () => {})).rejects.toMatchObject({ code: 'BLOG_MEDIA_BUSY' });
    db.prepare('UPDATE _blog_media_leases SET expires_at=0 WHERE id=?').run('asset');
    const second = withBlogMediaLease(db, 'asset', () => {}, async fence => { secondEntered(); await nextHold; fence(); return 'replacement'; }, () => failures.push('cleanup'));
    await nextStarted;
    const next = db.prepare('SELECT nonce FROM _blog_media_leases WHERE id=?').get('asset');
    release(); await expect(first).rejects.toMatchObject({ code: 'BLOG_MEDIA_BUSY' });
    expect(db.prepare('SELECT nonce FROM _blog_media_leases WHERE id=?').get('asset')).toEqual(next);
    secondRelease(); expect(await second).toBe('replacement');
    expect(db.prepare('SELECT id FROM _blog_media_leases').all()).toEqual([]); expect(failures).toEqual([]);
  } finally { release?.(); secondRelease?.(); db.dispose(); }
});
test('cleanup failure and a throwing diagnostic never change an accepted media outcome', async () => {
  const db = createReactiveDB({ mode: 'memory' }); installBlogContentOwnerSchema(db, true); let notified = 0;
  expect(await withBlogMediaLease(db, 'accepted', () => {}, async fence => { fence(); db.dispose(); return 'accepted'; }, () => { notified++; throw new Error('diagnostic-only'); })).toBe('accepted');
  expect(notified).toBe(1);
});
