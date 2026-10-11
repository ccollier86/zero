/** Native/SSR Card composition remains additive; no manager admission or global theme activation during render. */
import * as React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card, CardAction, CardByline, CardContent, CardDescription, CardFooter, CardHeader,
  CardMedia, CardMeta, CardSection, CardStatus, CardTitle } from './card';
import { ContentCard } from './content-card';
import { modalStore } from '../../../modals/modal-store';

describe('composable Cards', () => {
  test('native Card retains native title/asChild, caller overrides and original unrequested padding', () => {
    const html = renderToStaticMarkup(<Card title="Native tooltip" className="rounded-none p-1" style={{ borderRadius: 3 }}>
      <CardHeader className="p-2"><CardTitle asChild><h2>Native heading</h2></CardTitle><CardDescription>Description</CardDescription></CardHeader>
      <CardContent>Body</CardContent><CardFooter>Footer</CardFooter></Card>);
    expect(html).toContain('title="Native tooltip"'); expect(html).toContain('rounded-none p-1');
    expect(html).toContain('border-radius:3px'); expect(html).not.toContain('data-zero-card-density');
    expect(html).toContain('--zero-card-padding,1.25rem'); expect(html).not.toContain('zero-theme-card-padding-compact');
    expect(html).toMatch(/<h2[^>]+data-slot="card-title"/u);
    const actionHeader = html.match(/<div[^>]+data-slot="card-header"[^>]*>/u)?.[0];
    expect(actionHeader).toContain('p-2'); expect(actionHeader).not.toContain('p-[var(--zero-card-padding');
    const article = renderToStaticMarkup(<Card asChild density="comfortable" style={{ '--zero-card-padding': '9px' } as React.CSSProperties}>
      <article aria-label="Article"><CardContent>Native article</CardContent></article></Card>);
    expect(article).toMatch(/^<article/u); expect(article).toContain('aria-label="Article"');
    expect(article).toContain('data-zero-card-density="comfortable"'); expect(article).toContain('--zero-card-padding:9px');
  });
  test('parts expose explicit native slots and reserve header actions without inventing form behavior', () => {
    const html = renderToStaticMarkup(<Card><CardMedia><img alt="Synthetic media" src="data:," /></CardMedia>
      <CardHeader><CardTitle>Heading</CardTitle><CardDescription>Supporting text</CardDescription>
        <CardAction><button type="submit" form="caller-form">Submit</button></CardAction></CardHeader>
      <CardSection id="extra">Custom section</CardSection>
      <CardFooter><CardByline avatar={<span>AB</span>}><CardMeta>Source metadata</CardMeta>
        <CardStatus animate={false}>Live updates connected</CardStatus></CardByline></CardFooter></Card>);
    for (const slot of ['card-media', 'card-action', 'card-section', 'card-byline', 'card-avatar', 'card-meta', 'card-status']) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
    expect(html).toContain('has-[[data-slot=card-action]]:grid'); expect(html).toContain('form="caller-form"');
    expect(html).toContain('type="submit"'); expect(html).toContain('role="status"'); expect(html).toContain('aria-hidden="true"');
  });
  test('ContentCard is a compact article with title-only dialog trigger and deliberate details body', () => {
    const before = modalStore.getSnapshot().context.modals.length;
    const html = renderToStaticMarkup(<ContentCard title="Readable title" htmlTitle="Native article title" description="Description"
      details={<input aria-label="Details only" />} defaultOpen action={<button type="button">Custom action</button>}>
      <form id="caller-form"><input name="preview" defaultValue="Preview only" /></form></ContentCard>);
    expect(html).toMatch(/^<article/u); expect(html).toContain('title="Native article title"');
    expect(html).toContain('data-zero-card-density="compact"'); expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('role="button"');
    expect(html).toContain('id="caller-form"'); expect(html).not.toContain('Details only');
    expect(modalStore.getSnapshot().context.modals.length).toBe(before);
  });
});
