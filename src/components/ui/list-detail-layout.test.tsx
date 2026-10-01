import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineSchema, field } from '../../schema';
import { MasterDetailPage } from '../master-detail';
import { ListDetailLayout } from './list-detail-layout';

const itemSchema = defineSchema({
  name: field.text({ label: 'Name' }),
}, { pk: 'id' });

describe('ListDetailLayout mobile navigation', () => {
  test('renders a visible, accessible return action only for an open mobile detail', () => {
    const openMarkup = renderToStaticMarkup(
      <ListDetailLayout
        list={<p>People list</p>}
        detail={<p>Selected person</p>}
        hasSelection
        mobileDetailOpen
        mobileBackLabel="Back to people"
        onMobileBack={() => {}}
      />,
    );
    const listMarkup = renderToStaticMarkup(
      <ListDetailLayout
        list={<p>People list</p>}
        detail={<p>Selected person</p>}
        hasSelection
        mobileDetailOpen={false}
        mobileBackLabel="Back to people"
        onMobileBack={() => {}}
      />,
    );

    expect(openMarkup).toContain('type="button"');
    expect(openMarkup).toContain('Back to people');
    expect(openMarkup.match(/People list/g)).toHaveLength(1);
    expect(openMarkup.match(/Selected person/g)).toHaveLength(1);
    expect(listMarkup).not.toContain('Back to people');
    expect(listMarkup.match(/People list/g)).toHaveLength(1);
    expect(listMarkup.match(/Selected person/g)).toHaveLength(1);
  });

  test('mounts one shared detail tree so responsive panes cannot duplicate IDs or effects', () => {
    const markup = renderToStaticMarkup(
      <ListDetailLayout
        list={<button type="button">Select person</button>}
        detail={<section id="person-access-panel">Selected access</section>}
        hasSelection
        mobileDetailOpen
        onMobileBack={() => {}}
      />,
    );

    expect(markup.match(/id="person-access-panel"/g)).toHaveLength(1);
    expect(markup.match(/Selected access/g)).toHaveLength(1);
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('Back to list');
  });

  test('wires the reusable return path into MasterDetailPage', () => {
    const markup = renderToStaticMarkup(
      <MasterDetailPage
        schema={itemSchema}
        primaryKey="id"
        listColumns={['name']}
        data={[{ id: 'one', name: 'One' }]}
        renderDetail={(item) => <p>Detail for {item.name}</p>}
        primaryAction={{
          label: 'Add person',
          ariaHasPopup: 'dialog',
          onClick() {},
        }}
      />,
    );

    expect(markup).toContain('Back to list');
    expect(markup).toContain('Detail for One');
    expect(markup).toContain('aria-label="Previous record"');
    expect(markup).toContain('aria-haspopup="dialog"');
  });
});
