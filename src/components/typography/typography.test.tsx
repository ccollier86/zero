/** Native SSR semantics and composition; no provider, font loader or browser. */

import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Heading, Text } from './index';

describe('optional typography components', () => {
  test('default text and heading are native span/h2 with shared CSS recipes', () => {
    expect(renderToStaticMarkup(<Text>Body</Text>)).toBe('<span data-slot="text" data-zero-typography="body">Body</span>');
    expect(renderToStaticMarkup(<Heading>Section</Heading>)).toBe('<h2 data-slot="heading" data-zero-typography="section">Section</h2>');
  });

  test('heading meaning is independent from visual recipe at every level', () => {
    const levels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
    for (const level of levels) {
      const html = renderToStaticMarkup(<Heading as={level} variant="caption" id="outline-title">Title</Heading>);
      expect(html).toStartWith(`<${level} `);
      expect(html).toEndWith(`</${level}>`);
      expect(html).toContain('data-zero-typography="caption"');
      expect(html).not.toContain('role=');
      expect(html).not.toContain('aria-level');
    }
  });

  test('all native text tags preserve markup rather than substituting visual semantics', () => {
    const tags = ['span', 'p', 'div', 'small', 'strong', 'em', 'code', 'kbd', 'label'] as const;
    for (const tag of tags) {
      const html = renderToStaticMarkup(<Text as={tag} variant="support" lang="ar" dir="rtl">مرحبا</Text>);
      expect(html).toStartWith(`<${tag} `);
      expect(html).toEndWith(`</${tag}>`);
      expect(html).toContain('lang="ar"');
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('مرحبا');
    }
  });

  test('native labels, accessible names, classes and explicit styles stay caller-owned', () => {
    const html = renderToStaticMarkup(<Text as="label" variant="label" htmlFor="field" id="field-label" className="text-lg custom" style={{ fontSize: '23px', color: 'red' }} aria-label="Visible field label" role="note">Name</Text>);
    expect(html).toContain('for="field"');
    expect(html).toContain('id="field-label"');
    expect(html).toContain('class="text-lg custom"');
    expect(html).toContain('style="font-size:23px;color:red"');
    expect(html).toContain('aria-label="Visible field label"');
    expect(html).toContain('role="note"');
    expect(html).not.toContain('variant=');
    expect(html).not.toContain('as=');
    expect(html).not.toContain('tabindex');
  });

  test('asChild preserves one supplied semantic element and merges class/style overrides', () => {
    const html = renderToStaticMarkup(<Text asChild variant="support" className="parent-class" style={{ color: 'red', fontSize: '15px' }} aria-describedby="help"><a href="/help" className="child-class" style={{ color: 'blue' }}>Help</a></Text>);
    expect(html).toStartWith('<a ');
    expect(html).toEndWith('</a>');
    expect(html).toContain('href="/help"');
    expect(html).toContain('data-zero-typography="support"');
    expect(html).toContain('class="parent-class child-class"');
    expect(html).toContain('style="color:blue;font-size:15px"');
    expect(html).toContain('aria-describedby="help"');
    expect(html).not.toContain('<span');
    const heading = renderToStaticMarkup(<Heading asChild variant="page"><h3 id="nested">Native outline</h3></Heading>);
    expect(heading).toStartWith('<h3 ');
    expect(heading).toEndWith('</h3>');
    expect(heading).not.toContain('<h2');
  });

  test('content is canonical selectable text, not copied announcements or animated glyphs', () => {
    const html = renderToStaticMarkup(<Text as="code" variant="technical">{'<tag>  ١٢٣ 👩🏽‍💻'}</Text>);
    expect(html).toContain('&lt;tag&gt;  ١٢٣ 👩🏽‍💻');
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('aria-hidden');
    expect(html).not.toContain('aria-label');
    expect(html).not.toContain('style=');
  });

  test('invalid Slot children cannot silently drop their typography and refs', () => {
    expect(() => renderToStaticMarkup(<Text asChild><><span>Fragment child</span></></Text>)).toThrow('one non-Fragment React element');
    expect(() => renderToStaticMarkup(<Heading asChild><><h3>Fragment child</h3></></Heading>)).toThrow('one non-Fragment React element');
    // Untyped callers still receive a clear composition error, not missing text.
    for (const children of [null, 'Plain text', [<span key="a">A</span>, <span key="b">B</span>]]) {
      expect(() => renderToStaticMarkup(React.createElement(Text, { asChild: true, children } as any))).toThrow(TypeError);
    }
  });
});
