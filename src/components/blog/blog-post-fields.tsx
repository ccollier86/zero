'use client';

/** Controlled post metadata and composition. Persistence, Guardian and save/recovery stay in the workspace controller. */
import type { BlogAuthorRecord } from '../../blog/types';
import type { BlogPostContent, BlogTaxonomyTerm } from '../../blog/content-types';
import type { BlogBrowserMediaApi } from '../../blog/media-types';
import type { ComponentProps, ReactNode } from 'react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { BlogDocumentEditor, BlogImageFields } from './blog-document-editor';
import { BlogMediaPicker } from './blog-media-picker';
import type { BlogInlineInputProps } from './blog-inline-input';

export interface BlogPostFieldsProps { value: BlogPostContent; onChange(value: BlogPostContent): void; authors: readonly BlogAuthorRecord[]; terms: readonly BlogTaxonomyTerm[]; media: BlogBrowserMediaApi; disabled?: boolean; moreAuthors?: ReactNode; moreTerms?: ReactNode; renderSelectionMenu?: BlogInlineInputProps['renderSelectionMenu'] }
/** No implicit slug changes after a writer has chosen a permanent address. */
export function BlogPostFields({ value, onChange, authors, terms, media, disabled, moreAuthors, moreTerms, renderSelectionMenu }: BlogPostFieldsProps) {
  const patch = (changes: Partial<BlogPostContent>) => onChange({ ...value, ...changes });
  const picker: NonNullable<ComponentProps<typeof BlogImageFields>['renderMediaPicker']> = props => <BlogMediaPicker api={media} {...props} />;
  return <div className="zero-blog-post-fields">
    <div className="zero-blog-post-writing"><label>Article title<Input value={value.title} disabled={disabled} maxLength={240} onChange={event => patch({ title: event.target.value })} /></label>
      <label>Excerpt<Textarea value={value.excerpt} disabled={disabled} maxLength={2000} onChange={event => patch({ excerpt: event.target.value })} /></label>
      <BlogDocumentEditor value={value.document} onChange={document => patch({ document })} disabled={disabled} renderMediaPicker={picker} renderSelectionMenu={renderSelectionMenu} />
    </div>
    <aside className="zero-blog-post-settings" aria-label="Article settings">
      <label>Permanent slug<Input value={value.slug} disabled={disabled} maxLength={120} onChange={event => patch({ slug: event.target.value })} /></label>
      <p className="zero-blog-muted">Use lowercase letters, numbers and hyphens. Previous published slugs redirect while the article stays published.</p>
      <label>Author<Select value={value.authorId} disabled={disabled} onValueChange={authorId => patch({ authorId })}><SelectTrigger aria-label="Article author"><SelectValue placeholder="Select an author" /></SelectTrigger><SelectContent>{value.authorId && !authors.some(author => author.id === value.authorId) && <SelectItem value={value.authorId}>Current author (outside loaded directory)</SelectItem>}{authors.filter(author => author.status === 'active').map(author => <SelectItem key={author.id} value={author.id}>{author.profile.displayName || 'Author profile not completed'}</SelectItem>)}</SelectContent></Select></label>
      {moreAuthors}
      <details><summary>Heading image</summary>{value.featuredImage ? <><BlogImageFields value={value.featuredImage} onChange={featuredImage => patch({ featuredImage })} disabled={disabled} renderMediaPicker={picker} /><Button type="button" variant="ghost" disabled={disabled} onClick={() => patch({ featuredImage: null })}>Remove heading image</Button></>
        : <Button type="button" variant="outline" disabled={disabled} onClick={() => patch({ featuredImage: { mediaId: '', alt: '' } })}>Add heading image</Button>}</details>
      {(['category', 'tag'] as const).map(kind => <fieldset key={kind} disabled={disabled}><legend>{kind === 'category' ? 'Categories' : 'Tags'}</legend><ScrollArea className="zero-blog-taxonomy-choices">{terms.filter(term => term.kind === kind).map(term => {
        const key = kind === 'category' ? 'categoryIds' : 'tagIds', selected = value[key].includes(term.id);
        return <label key={term.id} className="zero-blog-check"><input type="checkbox" checked={selected} onChange={event => patch({ [key]: event.target.checked ? [...value[key], term.id] : value[key].filter(id => id !== term.id) })} />{term.name}</label>;
      })}</ScrollArea></fieldset>)}
      {moreTerms}
      <details><summary>Search and social metadata</summary><label>SEO title<Input value={value.seo.title ?? ''} maxLength={240} disabled={disabled} placeholder="Defaults to the article title" onChange={event => patch({ seo: { ...value.seo, title: event.target.value || null } })} /></label>
        <label>SEO description<Textarea value={value.seo.description ?? ''} maxLength={2000} disabled={disabled} placeholder="Defaults to the excerpt" onChange={event => patch({ seo: { ...value.seo, description: event.target.value || null } })} /></label>
        <label className="zero-blog-check"><input type="checkbox" checked={value.seo.noIndex} disabled={disabled} onChange={event => patch({ seo: { ...value.seo, noIndex: event.target.checked } })} />Ask search engines not to index this article</label>
        {value.seo.socialImage ? <><BlogImageFields value={value.seo.socialImage} onChange={socialImage => patch({ seo: { ...value.seo, socialImage } })} disabled={disabled} renderMediaPicker={picker} /><Button type="button" variant="ghost" disabled={disabled} onClick={() => patch({ seo: { ...value.seo, socialImage: null } })}>Use heading image for social cards</Button></>
          : <Button type="button" variant="outline" disabled={disabled} onClick={() => patch({ seo: { ...value.seo, socialImage: { mediaId: '', alt: '' } } })}>Choose a separate social image</Button>}
      </details>
    </aside>
  </div>;
}
