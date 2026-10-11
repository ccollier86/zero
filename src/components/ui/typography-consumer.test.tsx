/** SSR qualification for opt-in type consumers; no font downloads, DOM activation, app configuration or layout changes. */
import * as React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, buttonVariants } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { Label } from './label';
import { CardTitle, CardDescription } from './card';
import { StatCard } from './stat-card';
import { Select, SelectTrigger } from './select';
import { Command, CommandInput, CommandItem, CommandGroup, CommandShortcut } from './command';
import { FormField, FormDescription, FormMessage } from './form-field';

const render = (element: React.ReactElement) => renderToStaticMarkup(element);

describe('existing UI typography consumers', () => {
  test('button consumes compact type without changing action geometry or native/asChild semantics', () => {
    const classes = buttonVariants({ size: 'default' });
    expect(classes).toContain('--zero-type-control-size,var(--text-sm,.875rem)');
    expect(classes).toContain('--zero-type-control-weight,var(--font-weight-medium,500)');
    expect(classes).toContain('--zero-theme-font-body,inherit');
    expect(classes).toContain('h-9 px-4 py-2');
    expect(buttonVariants({ size: 'xs' })).toContain('--zero-type-caption-size,var(--text-xs,.75rem)');
    expect(render(<Button animateIcon={false} disabled type="submit">Save</Button>)).toContain('disabled=""');
    const link = render(<Button animateIcon={false} asChild><a href="/details">Details</a></Button>);
    expect(link).toMatch(/^<a[^>]+href="\/details"/u);
    expect(link).not.toContain('<button');
  });

  test('caller utility and inline presentation take precedence over type defaults', () => {
    const html = render(<Button animateIcon={false} className="text-lg font-mono font-bold leading-none tracking-wide"
      style={{ fontSize: '23px', fontFamily: 'serif' }}>Custom</Button>);
    expect(html).toContain('text-lg font-mono font-bold leading-none tracking-wide');
    expect(html).not.toContain('--zero-type-control-size');
    expect(html).not.toContain('--zero-type-control-weight');
    expect(html).not.toContain('--zero-type-control-leading');
    expect(html).not.toContain('--zero-type-control-tracking');
    expect(html).not.toContain('--zero-theme-font-body');
    expect(html).toContain('font-size:23px;font-family:serif');
  });

  test('native input/textarea retain the below-md 16px and md-up 14px fallbacks', () => {
    for (const html of [render(<Input readOnly name="value" defaultValue="Example" />),
      render(<Textarea readOnly name="notes" defaultValue="Example" />)]) {
      expect(html).toContain('text-[length:var(--zero-type-input-size,var(--text-base,1rem))]');
      expect(html).toContain('md:text-[length:var(--zero-type-input-small-size,var(--text-sm,.875rem))]');
      expect(html).toContain('md:leading-[var(--zero-type-input-small-leading,var(--text-sm--line-height,1.4285714286))]');
      expect(html).toContain('readOnly=""');
      expect(html).not.toContain('disabled=""');
    }
    const hidden = render(<Input type="hidden" name="identity" defaultValue="Example" />);
    expect(hidden).not.toContain('--zero-type');
    expect(hidden).not.toContain('input-wrapper');
    const custom = render(<Input className="text-xs md:text-lg font-mono" />);
    expect(custom).toContain('text-xs md:text-lg font-mono');
    expect(custom).not.toContain('--zero-type-input-size');
    expect(custom).not.toContain('--zero-type-input-small-size');
  });

  test('labels and cards retain native labels and explicit semantic headings', () => {
    const label = render(<Label htmlFor="account">Account</Label>);
    expect(label).toContain('for="account"');
    expect(label).toContain('--zero-type-label-leading,1');
    const title = render(<CardTitle asChild><h2 id="heading">Heading</h2></CardTitle>);
    expect(title).toMatch(/^<h2[^>]*data-slot="card-title"/u);
    expect(title).toContain('--zero-type-section-size,inherit');
    expect(title).toContain('--zero-type-section-weight,var(--font-weight-semibold,600)');
    const custom = render(<CardTitle className="text-2xl font-bold leading-tight">Custom</CardTitle>);
    expect(custom).not.toContain('--zero-type-section-size');
    expect(custom).not.toContain('--zero-type-section-weight');
    expect(custom).not.toContain('--zero-type-section-leading');
    expect(render(<CardDescription>Description</CardDescription>)).toContain('--zero-type-body-size,var(--text-sm,.875rem)');
  });

  test('metrics adopt a role with legacy 24px bold and tabular-number fallbacks', () => {
    const html = render(<StatCard label="Invocations" value={120} prefix="$" suffix="total"
      trend={{ direction: 'up', value: 3 }} />);
    expect(html).toContain('--zero-type-metric-size,var(--text-2xl,1.5rem)');
    expect(html).toContain('--zero-type-metric-weight,var(--font-weight-bold,700)');
    expect(html).toContain('--zero-type-metric-numeric,tabular-nums');
    expect(html).toContain('p-6');
    expect(html).toContain('sliding-number');
  });

  test('select and command controls keep existing slots, event ownership and caller overrides', () => {
    const select = render(<Select><SelectTrigger aria-label="Category">Category</SelectTrigger></Select>);
    expect(select).toContain('data-slot="select-trigger"');
    expect(select).toContain('--zero-type-control-size,var(--text-sm,.875rem)');
    const command = render(<Command label="Commands"><CommandInput placeholder="Search" />
      <CommandGroup heading="Actions"><CommandItem value="inspect">Inspect<CommandShortcut>⌘ I</CommandShortcut></CommandItem></CommandGroup></Command>);
    expect(command).toContain('--zero-type-navigation-size,var(--text-sm,.875rem)');
    expect(command).toContain('--zero-type-caption-size,var(--text-xs,.75rem)');
    expect(command).toContain('data-slot="command-input"');
    expect(command).toContain('data-slot="command-item"');
    expect(command).toContain('tracking-widest');
    const custom = render(<Command><CommandInput className="text-xs font-mono" /></Command>);
    const input = custom.match(/<input[^>]*data-slot="command-input"[^>]*>/u)?.[0];
    expect(input).toBeDefined();
    expect(input).not.toContain('--zero-type-navigation-size');
    expect(input).not.toContain('--zero-theme-font-body');
  });

  test('field help/errors retain accessible identity, error role and support fallbacks', () => {
    const html = render(<FormField name="account" description="Choose an account" error="Required">
      <FormDescription>Choose an account</FormDescription><FormMessage /></FormField>);
    expect(html).toContain('--zero-type-support-size,.8rem');
    expect(html).toContain('data-slot="form-description"');
    expect(html).toContain('data-slot="form-message"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Required');
  });
});
