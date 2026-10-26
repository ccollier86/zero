/** Persistence acknowledgment, uncertainty, concurrent edits and revision guards independent of a browser. */
import { expect, test } from 'bun:test';
import { BlogDraftController } from './blog-draft-controller';
import type { BlogPostContent, BlogPostRecord, BlogPostsApi } from '../../blog/content-types';
const content: BlogPostContent = { title: 'A thoughtful article', slug: 'thoughtful', excerpt: '', authorId: 'writer', categoryIds: [], tagIds: [], featuredImage: null, seo: { title: null, description: null, noIndex: false, socialImage: null }, document: { version: 1, blocks: [] } };
const record = (value = content, revision = 1): BlogPostRecord => ({ id: 'article', siteId: 'site', revision, publicRevision: 0, status: 'draft', createdBy: 'user', createdAt: 1, updatedAt: 1, publishedAt: null, hasUnpublishedChanges: true, content: structuredClone(value) });
test('an uncertain retry retains the exact original identity and body while preserving later edits', async () => {
  const calls: { id: string; content: BlogPostContent }[] = []; let count = 0;
  const api = { create: async (value: BlogPostContent, options: { requestId: string }) => {
    calls.push({ id: options.requestId, content: structuredClone(value) }); if (!count++) throw new Error('network lost after commit'); return record(value);
  } } as BlogPostsApi;
  const draft = new BlogDraftController(api, content); draft.setContent({ ...content, title: 'Original write' });
  expect((await draft.save()).kind).toBe('failed'); expect(draft.getSnapshot().uncertain).toBe(true);
  draft.setContent({ ...content, title: 'Later local edit' });
  expect((await draft.act('publish')).kind).toBe('blocked'); expect(() => draft.reset()).toThrow();
  expect((await draft.retry()).kind).toBe('accepted'); expect(calls[1]).toEqual(calls[0]);
  expect(draft.getSnapshot()).toMatchObject({ dirty: true, uncertain: false, content: { title: 'Later local edit' }, record: { content: { title: 'Original write' } } });
});
test('competing revisions never overwrite a dirty draft and conflict cannot silently rebase it', async () => {
  const api = { update: async () => { throw { status: 409, body: { code: 'BLOG_REVISION_CONFLICT' } }; } } as unknown as BlogPostsApi;
  const draft = new BlogDraftController(api, content, record()); draft.setContent({ ...content, title: 'My draft' }); draft.incoming(record({ ...content, title: 'Other writer' }, 2));
  expect(draft.getSnapshot()).toMatchObject({ incomingRevision: 2, content: { title: 'My draft' } });
  expect(await draft.save()).toMatchObject({ kind: 'failed', conflict: true });
  expect((await draft.save()).kind).toBe('failed'); draft.reload(record({ ...content, title: 'Other writer' }, 2));
  expect(draft.getSnapshot()).toMatchObject({ conflict: false, dirty: false, record: { revision: 2 } });
});
test('edits during an admitted save remain dirty and retired acknowledgments cannot repopulate a prior user workspace', async () => {
  let resolve!: (value: BlogPostRecord) => void;
  const api = { update: () => new Promise<BlogPostRecord>(done => { resolve = done; }) } as unknown as BlogPostsApi;
  const draft = new BlogDraftController(api, content, record()); draft.setContent({ ...content, title: 'Admitted edit' });
  const save = draft.save(); draft.setContent({ ...content, title: 'Typing continued' }); resolve(record({ ...content, title: 'Admitted edit' }, 2)); await save;
  expect(draft.getSnapshot()).toMatchObject({ dirty: true, content: { title: 'Typing continued' }, record: { revision: 2 } });
  const second = draft.save(); draft.close(); resolve(record({ ...content, title: 'Typing continued' }, 3)); expect((await second).kind).toBe('retired'); expect(draft.getSnapshot().record?.revision).toBe(2);
});
