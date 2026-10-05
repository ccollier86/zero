/** Long synthetic layout only: no app/client/service/database setup. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ListDetailLayout } from './list-detail-layout';
import { DetailPanel } from './detail-panel';
import { RecordNavigationBar } from './record-navigation-bar';
import { AppShell } from '../app-shell';
import { MasterDetailPage } from '../master-detail';
import { defineSchema, field } from '../../schema';
import { Tabs, TabsList, TabsTrigger, TabsContents, TabsContent } from '../animate-ui/components/animate/tabs';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './resizable';

const rows = Array.from({ length: 80 }, (_, index) => ({ id: String(index), name: `Record ${index}` }));
const schema = defineSchema({ name: field.text({ label: 'Name' }) });
const longDetail = <>{rows.map(row => <p className="h-10" key={row.id}>Long detail {row.id}</p>)}</>;
const actions = rows.slice(0, 8).map(row => ({ icon: <span aria-hidden="true">+</span>, label: `Action ${row.id}`, onClick() {} }));
const primary = { label: 'Create record', onClick() {} };

function Fixture() {
  const [selection, setSelection] = useState('0');
  const [detailVisible, setDetailVisible] = useState(() => new URLSearchParams(location.search).get('hidden') !== '1');
  const query = new URLSearchParams(location.search);
  const mode = query.get('mode') ?? 'raw';
  if (mode === 'tabs') return <TabsHeightFixture />;
  const layout = mode === 'master' ? (
    <MasterDetailPage schema={schema} listColumns={['name']} data={rows}
      renderDetail={() => longDetail} detailHeader={() => <h2>Detail header</h2>}
      detailFooter={<button>Detail footer</button>} navigationActions={() => actions}
      primaryAction={primary} resizable detailVisible={detailVisible} className="min-h-0 flex-1" />
  ) : (
    <ListDetailLayout hasSelection selectedKey={selection} detailVisible={detailVisible} resizable
      listWidth="minmax(0, 1fr)" detailWidth="minmax(18rem, 22rem)"
      list={<>{mode === 'nested' && <div className="h-10"><ResizablePanelGroup disabled>
        <ResizablePanel>Nested list</ResizablePanel><ResizableHandle className="w-20" aria-label="Nested separator" /><ResizablePanel>Nested detail</ResizablePanel>
      </ResizablePanelGroup></div>}{rows.map(row => <button className="block h-10" key={row.id}
        onClick={() => setSelection(row.id)}>Select {row.id}</button>)}</>}
      detail={<DetailPanel header={<h2>Detail header</h2>} footer={<button>Detail footer</button>}><input aria-label="Draft note" defaultValue="Initial draft" />{longDetail}</DetailPanel>}
      bottomBar={<RecordNavigationBar currentIndex={Number(selection)} totalCount={rows.length}
        showNavigation={mode !== 'status'} status={mode === 'status' ? '80 records' : undefined}
        onPrevious={() => setSelection(String(Math.max(0, Number(selection) - 1)))}
        onNext={() => setSelection(String(Math.min(79, Number(selection) + 1)))}
        actions={actions} primaryAction={primary} />} />
  );
  const content = <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="workspace-page">
    <div className="flex shrink-0 items-center gap-2"><h1>Workspace title</h1>
      <button onClick={() => setDetailVisible(value => !value)}>Toggle detail</button></div>{layout}</div>;
  return mode === 'shell' ? <AppShell sidebar={false} header={{ title: 'Shell header' }}>{content}</AppShell>
    : mode === 'sidebar' ? <AppShell brand={{ name: 'Synthetic workspace' }} nav={[{ items: [{ label: 'Overview', href: '/overview' }] }]} header={{ title: 'Shell header' }}>{content}</AppShell>
    : mode === 'simple' ? <AppShell preset="simple-sidebar" sidebar={<nav>{rows.map(row => <p className="h-10" key={row.id}>Navigation {row.id}</p>)}</nav>} header={{ title: 'Shell header' }}>{content}</AppShell>
    : mode === 'topbar-workspace' ? <AppShell preset="topbar" contentMode="workspace" header={{ title: 'Shell header' }}>{content}</AppShell>
    : mode === 'minimal-workspace' ? <AppShell preset="minimal" contentMode="workspace">{content}</AppShell>
    : mode === 'document' ? <AppShell preset="minimal" contentMode="document">{longDetail}</AppShell>
    : <div className="flex h-svh min-h-0 flex-col p-4">{content}</div>;
}

function TabsHeightFixture() {
  const [fill, setFill] = useState(false), [tab, setTab] = useState('long');
  return <div className="flex h-svh min-h-0 flex-col gap-2 p-4">
    <button type="button" onClick={() => setFill(value => !value)}>Toggle tab height</button>
    <span data-testid="height-mode">{fill ? 'fill' : 'content'}</span>
    <div data-testid="tabs-owner" className="flex h-80 min-h-0 flex-col overflow-hidden border">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 overflow-hidden">
        <TabsList className="shrink-0"><TabsTrigger value="long">Long tab</TabsTrigger><TabsTrigger value="short">Short tab</TabsTrigger></TabsList>
        <TabsContents heightMode={fill ? 'fill' : 'content'}
          className={fill ? 'min-h-0 min-w-0 flex-1 overflow-hidden' : 'shrink-0'}>
          <TabsContent value="long" className="h-full"><div data-testid="long-tab-body" className="h-full overflow-auto">{longDetail}</div></TabsContent>
          <TabsContent value="short" className="h-full"><div className="h-full overflow-auto"><p className="h-10">Short content</p></div></TabsContent>
        </TabsContents>
      </Tabs>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
