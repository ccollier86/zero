/** Verify SSR composition, native control semantics and token-only group styling. */
import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select, SelectTrigger, SelectValue } from '../ui/select';
import { ButtonGroup, ButtonGroupText, ButtonGroupSeparator, ButtonGroupToggle, ButtonGroupToggleItem, buttonGroupVariants, type ButtonGroupToggleProps } from './index';

function render(node: React.ReactNode): string { return renderToStaticMarkup(node); }
function openingTags(html: string, element: string): string[] { return html.match(new RegExp(`<${element}\\b[^>]*>`, 'g')) ?? []; }

describe('ButtonGroup composition', () => {
  test('ordinary actions preserve their native props, Button size and variant without selection', () => {
    const html = render(<ButtonGroup aria-label="File actions"><Button type="submit" name="intent" value="save" size="sm">Save</Button><Button disabled variant="destructive">Delete</Button></ButtonGroup>);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="File actions"');
    expect(html).toContain('data-orientation="horizontal"');
    expect(html).toContain('data-spacing="joined"');
    expect(openingTags(html, 'button')).toHaveLength(2);
    expect(openingTags(html, 'button')[0]).toContain('type="submit"');
    expect(openingTags(html, 'button')[0]).toContain('name="intent"');
    expect(openingTags(html, 'button')[0]).toContain('value="save"');
    expect(openingTags(html, 'button')[0]).toContain('data-size="sm"');
    expect(openingTags(html, 'button')[1]).toContain('disabled=""');
    expect(openingTags(html, 'button')[1]).toContain('data-variant="destructive"');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('role="radio"');
  });

  test('the default Button remains unchanged rather than getting a new submit or selected contract', () => {
    const html = render(<ButtonGroup><Button>Ordinary</Button></ButtonGroup>);
    const button = openingTags(html, 'button')[0]!;
    expect(button).not.toContain('type=');
    expect(button).not.toContain('data-state=');
    expect(button).toContain('data-slot="button"');
    expect(html).not.toContain('<span');
  });

  test('separated vertical and nested groups retain explicit orientation and addon separation', () => {
    const html = render(<ButtonGroup spacing="separated" aria-label="Editing tools"><ButtonGroup orientation="vertical" aria-label="Navigate"><Button>Up</Button><ButtonGroupSeparator /><Button>Down</Button></ButtonGroup><ButtonGroup aria-label="Zoom"><Button>Minus</Button><ButtonGroupText>100%</ButtonGroupText><Button>Plus</Button></ButtonGroup></ButtonGroup>);
    expect(html).toContain('data-spacing="separated"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain('data-slot="button-group-separator"');
    expect(openingTags(html, 'div').find((tag) => tag.includes('data-slot="button-group-separator"'))).toContain('data-orientation="horizontal"');
    expect(html).toContain('data-slot="button-group-text"');
    expect(html).toContain('bg-muted/50');
    expect(html).toContain('text-muted-foreground');
    expect(html).toContain('100%');
  });

  test('separators are perpendicular by default and honor explicit accessible orientation', () => {
    const html = render(<ButtonGroup><Button>First</Button><ButtonGroupSeparator /><ButtonGroupSeparator orientation="horizontal" decorative={false} /><Button>Last</Button></ButtonGroup>);
    const separators = openingTags(html, 'div').filter((tag) => tag.includes('data-slot="button-group-separator"'));
    expect(separators).toHaveLength(2);
    expect(separators[0]).toContain('data-orientation="vertical"');
    expect(separators[0]).toContain('role="none"');
    expect(separators[1]).toContain('role="separator"');
    expect(separators[1]).toContain('data-orientation="horizontal"');
  });

  test('asChild preserves links, fieldset disabling and user classes without extra wrappers', () => {
    const html = render(<ButtonGroup asChild aria-label="Locked actions" className="custom-group"><fieldset disabled><Button>Save</Button><ButtonGroupText asChild><label htmlFor="reference">Ref</label></ButtonGroupText><Button asChild><a href="/history">History</a></Button></fieldset></ButtonGroup>);
    expect(openingTags(html, 'fieldset')).toHaveLength(1);
    expect(openingTags(html, 'fieldset')[0]).toContain('disabled=""');
    expect(openingTags(html, 'fieldset')[0]).toContain('role="group"');
    expect(openingTags(html, 'fieldset')[0]).toContain('custom-group');
    expect(html).not.toContain('<div');
    expect(openingTags(html, 'label')[0]).toContain('for="reference"');
    expect(openingTags(html, 'a')[0]).toContain('href="/history"');
    expect(openingTags(html, 'a')[0]).toContain('data-slot="button"');
  });

  test('actual Zero Input, Select and Badge composition stays native with no new data layer', () => {
    const html = render(<ButtonGroup aria-label="Search tasks"><ButtonGroupText>Tasks</ButtonGroupText><Input aria-label="Task name" name="query" /><Select defaultValue="active"><SelectTrigger aria-label="Status"><SelectValue placeholder="Active" /></SelectTrigger></Select><ButtonGroupText asChild><Badge variant="outline">4</Badge></ButtonGroupText><Button type="button">Search</Button></ButtonGroup>);
    expect(html).toContain('data-slot="input"');
    expect(html).toContain('name="query"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).toContain('data-slot="button-group-text"');
    expect(html).toContain('aria-label="Task name"');
  });

  test('layout variants preserve focus rings, logical RTL corners and explicit joining rules', () => {
    const horizontal = buttonGroupVariants({ orientation: 'horizontal', spacing: 'joined' });
    expect(horizontal).toContain('rounded-s-none');
    expect(horizontal).toContain('rounded-e-none');
    expect(horizontal).toContain('-ms-px');
    expect(horizontal).toContain('focus-visible]:z-10');
    expect(horizontal).toContain('focus-within]:z-10');
    expect(horizontal).toContain('[data-slot=input]');
    expect(horizontal).toContain('[data-orientation=horizontal]');
    const vertical = buttonGroupVariants({ orientation: 'vertical', spacing: 'joined' });
    expect(vertical).toContain('rounded-t-none');
    expect(vertical).toContain('rounded-b-none');
    expect(vertical).toContain('-mt-px');
    expect(buttonGroupVariants({ spacing: 'separated' })).not.toContain('rounded-s-none');
  });
});

describe('ButtonGroupToggle native selection', () => {
  test('the public type contract keeps scalar and array selections distinct', () => {
    const single: ButtonGroupToggleProps = { type: 'single', value: 'grid', onValueChange: (value: string) => void value };
    const multiple: ButtonGroupToggleProps = { type: 'multiple', value: ['bold'], onValueChange: (value: string[]) => void value };
    // @ts-expect-error A single-selection value must not accept an array.
    const invalidSingle: ButtonGroupToggleProps = { type: 'single', value: ['grid'] };
    // @ts-expect-error A multiple-selection value must not accept a scalar.
    const invalidMultiple: ButtonGroupToggleProps = { type: 'multiple', value: 'bold' };
    expect(single.value).toBe('grid');
    expect(multiple.value).toEqual(['bold']);
    expect(invalidSingle.type).toBe('single');
    expect(invalidMultiple.type).toBe('multiple');
  });

  test('single mode preserves Radix radio/aria-checked semantics and explicit value', () => {
    const html = render(<ButtonGroupToggle type="single" defaultValue="grid" aria-label="View" size="sm"><ButtonGroupToggleItem value="list">List</ButtonGroupToggleItem><ButtonGroupToggleItem value="grid">Grid</ButtonGroupToggleItem></ButtonGroupToggle>);
    const buttons = openingTags(html, 'button');
    expect(html).toContain('role="group"');
    expect(html).not.toContain('role="radiogroup"');
    expect(buttons[0]).toContain('role="radio"');
    expect(buttons[0]).toContain('aria-checked="false"');
    expect(buttons[1]).toContain('aria-checked="true"');
    expect(buttons[1]).toContain('data-state="on"');
    expect(buttons[1]).not.toContain('aria-pressed');
    expect(buttons[1]).toContain('data-size="sm"');
    expect(buttons[1]).toContain('type="button"');
    expect(html).not.toContain('<input');
  });

  test('multiple mode preserves aria-pressed and explicit selections without a form value', () => {
    const html = render(<ButtonGroupToggle type="multiple" defaultValue={['bold', 'italic']} aria-label="Formatting"><ButtonGroupToggleItem value="bold">Bold</ButtonGroupToggleItem><ButtonGroupToggleItem value="italic">Italic</ButtonGroupToggleItem><ButtonGroupToggleItem value="underline">Underline</ButtonGroupToggleItem></ButtonGroupToggle>);
    const buttons = openingTags(html, 'button');
    expect(buttons[0]).toContain('aria-pressed="true"');
    expect(buttons[1]).toContain('aria-pressed="true"');
    expect(buttons[2]).toContain('aria-pressed="false"');
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('<input');
  });

  test('group disabled remains native and item size/variant override only affects that item', () => {
    const html = render(<ButtonGroupToggle type="multiple" disabled orientation="vertical" size="xs" variant="default"><ButtonGroupToggleItem value="first">First</ButtonGroupToggleItem><ButtonGroupToggleItem value="second" size="lg" variant="outline">Second</ButtonGroupToggleItem></ButtonGroupToggle>);
    const buttons = openingTags(html, 'button');
    expect(buttons.every((tag) => tag.includes('disabled=""'))).toBe(true);
    expect(buttons[0]).toContain('data-size="xs"');
    expect(buttons[0]).toContain('data-variant="ghost"');
    expect(buttons[1]).toContain('data-size="lg"');
    expect(buttons[1]).toContain('data-variant="outline"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain('bg-primary/10');
    expect(html).toContain('text-primary');
  });

  test('controlled values and item asChild respect caller owned markup', () => {
    const html = render(<ButtonGroupToggle type="single" value="preview" onValueChange={() => {}}><ButtonGroupToggleItem value="preview" asChild animateIcon={false}><button aria-label="Preview result"><span>Preview</span></button></ButtonGroupToggleItem><ButtonGroupToggleItem value="edit" disabled>Edit</ButtonGroupToggleItem></ButtonGroupToggle>);
    expect(openingTags(html, 'button')).toHaveLength(2);
    expect(openingTags(html, 'button')[0]).toContain('aria-label="Preview result"');
    expect(openingTags(html, 'button')[0]).toContain('aria-checked="true"');
    expect(openingTags(html, 'button')[1]).toContain('disabled=""');
  });
});
