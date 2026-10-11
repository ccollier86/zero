/**
 * Arc-owned charts reuse the existing bounded authorized reactive collection
 * bridge. Synthetic SDK-shaped data only: no application config, live DB,
 * server aggregate implementation, services or alternative transport.
 */
import {afterEach,beforeEach,describe,expect,test} from "bun:test";
import {act,createElement} from "react";
import type {Root} from "react-dom/client";
import {buildLineChartModel} from "../../components/charts/arc/line-chart/line-chart-model";
import {buildDonutModel} from "../../components/charts/arc/donut-chart/donut-chart-model";
import {buildActivityHeatmapModel} from "../../components/charts/arc/activity-heatmap/activity-heatmap-model";
import {buildTreemapModel} from "../../components/charts/arc/treemap/treemap-model";
import type {ClientTableDef,Row} from "../../sync/types";
import type {AuthClient} from "./auth-client";
import {AuthorizationDataBoundaryController} from "./authorization-data-boundary";
import {useChartQuery,type ChartQueryResult} from "./chart-query";
import {ClientProvider} from "./client-context";
import type {Collection} from "./collection";
import type {Client,InternalClient} from "./sdk";
import {createHookContainer,installMinimalHookDom} from "./test-fixtures/react-hook-dom";
type ArcRollupRow=Row&{id:string;date:string;category:string;value:number};
const roots=new Set<Root>();let restoreDom:()=>void;
beforeEach(()=>{restoreDom=installMinimalHookDom();});
afterEach(async()=>{for(const root of roots)await act(async()=>root.unmount());roots.clear();restoreDom();});
const initial=():ArcRollupRow[]=>[{id:"one",date:"2026-10-01",category:"Billing",value:10},{id:"two",date:"2026-10-02",category:"Access",value:20}];
/** A caller-owned pure application projection. Server policy still owns which rows enter this collection. */
function projectAggregates(rows:readonly ArcRollupRow[]){
 const ordered=rows.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const totals=new Map<string,number>();for(const row of rows)totals.set(row.category,(totals.get(row.category)??0)+row.value);
 const line=buildLineChartModel(ordered.map(row=>({id:row.id,label:row.date,values:{metric:row.value}})),[{id:"metric",label:"Count"}]);
 const donut=buildDonutModel([...totals].map(([id,value])=>({id,label:id,value})),0,64);
 const heatmap=buildActivityHeatmapModel(rows.map(row=>({date:row.date,count:row.value})));
 const treemap=buildTreemapModel({id:"root",label:"All categories",children:[...totals.keys()].map(category=>({id:"category:"+category,label:category,children:ordered.filter(row=>row.category===category).map(row=>({id:"row:"+row.id,label:row.id,value:row.value}))}))});
 return {line,donut,heatmap,treemap};
}
type Projection=ReturnType<typeof projectAggregates>;
async function renderArcQuery(client:Client,project:(rows:readonly ArcRollupRow[])=>Projection=projectAggregates,maxRows?:number){
 const {createRoot}=await import("react-dom/client");const root=createRoot(createHookContainer());roots.add(root);let current!:ChartQueryResult<Projection>;
 function Capture(){current=useChartQuery<ArcRollupRow,Projection>({table:"arc_rollups",project,maxRows});return null;}
 await act(async()=>root.render(createElement(ClientProvider,{client,children:createElement(Capture)})));return {root,current:()=>current};
}
describe("Arc charts authorized reactive aggregate qualification",()=>{
 test("inserts, updates and deletions recompute exact line/part/calendar/hierarchy models",async()=>{
  const fixture=createFixture();fixture.load(initial().reverse());const capture=await renderArcQuery(fixture.client);
  expect(capture.current()).toMatchObject({readable:true,connected:true,error:null,rowCount:2});expect(capture.current().data!.line.data.map(d=>d.id)).toEqual(["one","two"]);
  expect(capture.current().data!.donut.total).toBe(30);expect(capture.current().data!.heatmap.total).toBe(30);expect(capture.current().data!.treemap.get("root")!.value).toBe(30);
  await act(async()=>fixture.insert({id:"three",date:"2026-10-03",category:"Billing",value:5}));
  expect(capture.current().data!.line.data.map(d=>d.id)).toEqual(["one","two","three"]);expect(capture.current().data!.donut.data.find(d=>d.id==="Billing")!.value).toBe(15);expect(capture.current().data!.heatmap.counts).toEqual([10,20,5]);expect(capture.current().data!.treemap.get("category:Billing")!.value).toBe(15);
  await act(async()=>fixture.update("one",{value:12}));expect(capture.current().data!.line.data[0]!.values.metric).toBe(12);expect(capture.current().data!.donut.total).toBe(37);expect(capture.current().data!.treemap.get("row:one")!.value).toBe(12);
  await act(async()=>fixture.remove("two"));expect(capture.current().data!.donut.total).toBe(17);expect(capture.current().data!.heatmap.counts).toEqual([12,0,5]);expect(capture.current().data!.treemap.has("category:Access")).toBe(false);
 });
 test("bad replacement data fails admission and masks old charts, then a valid replacement recovers",async()=>{
  const fixture=createFixture();fixture.load(initial());const capture=await renderArcQuery(fixture.client);
  await act(async()=>fixture.update("one",{value:-1}));expect(capture.current().data).toBeNull();expect(capture.current().error?.code).toBe("CHART_QUERY_PROJECTION_FAILED");
  await act(async()=>fixture.update("one",{value:1.5}));expect(capture.current().data).toBeNull();expect(capture.current().error?.code).toBe("CHART_QUERY_PROJECTION_FAILED");
  await act(async()=>fixture.update("one",{value:11}));expect(capture.current().error).toBeNull();expect(capture.current().data!.donut.total).toBe(31);
  await act(async()=>capture.root.unmount());roots.delete(capture.root);expect(fixture.subscriptions()).toEqual({rows:0,connection:0,authority:0});
 });
 test("retired tenant scope does not run a projector on fallback or leak its old aggregate",async()=>{
  const fixture=createFixture(),projects:string[][]=[];fixture.load(initial());const capture=await renderArcQuery(fixture.client,rows=>{projects.push(rows.map(r=>r.id));return projectAggregates(rows);});
  await act(async()=>fixture.retireScope());expect(capture.current()).toEqual({data:null,error:null,rowCount:0,connected:false,readable:false});expect(projects).toHaveLength(1);
  await act(async()=>fixture.replaceScope([{id:"approved",date:"2026-10-09",category:"New tenant",value:7}]));expect(capture.current().data!.line.data.map(d=>d.id)).toEqual(["approved"]);expect(capture.current().data!.treemap.get("root")!.value).toBe(7);expect(projects).toHaveLength(2);
 });
 test("same-scope authority purge masks old data until an authorized replacement becomes readable",async()=>{
  const fixture=createFixture();fixture.load(initial());const capture=await renderArcQuery(fixture.client);
  await act(async()=>fixture.retireAuthority());expect(capture.current()).toEqual({data:null,error:null,rowCount:0,connected:false,readable:false});
  await act(async()=>fixture.revalidateAuthority([{id:"replacement",date:"2026-10-09",category:"Approved",value:4}]));expect(capture.current().data!.donut.total).toBe(4);expect(capture.current().data!.heatmap.total).toBe(4);expect(capture.current().data!.treemap.get("root")!.value).toBe(4);
 });
 for(const mode of ["lazy","auto"]as const)test(mode+" sources fail closed before a population chart projection",async()=>{
  const fixture=createFixture(mode);fixture.load(initial());let calls=0;const capture=await renderArcQuery(fixture.client,rows=>{calls++;return projectAggregates(rows);});
  expect(capture.current().data).toBeNull();expect(capture.current().error?.code).toBe("CHART_QUERY_SOURCE_PARTIAL");expect(calls).toBe(0);
 });
 test("bounded row admission happens before the caller projector",async()=>{
  const fixture=createFixture();fixture.load(initial());let calls=0;const capture=await renderArcQuery(fixture.client,rows=>{calls++;return projectAggregates(rows);},1);
  expect(capture.current().data).toBeNull();expect(capture.current().error?.code).toBe("CHART_QUERY_LIMIT_EXCEEDED");expect(calls).toBe(0);
 });
});
/** SDK-shaped collection and authorization stubs; this is not a server integration fixture. */
function createFixture(mode: 'full'|'lazy'|'auto'='full') {
  let byId: Record<string, ArcRollupRow> = {};
  const rowListeners = new Set<() => void>(), connectionListeners = new Set<() => void>(), authorityListeners = new Set<() => void>();
  const dataBoundary = new AuthorizationDataBoundaryController();
  const auth = {
    authorizationScopeKey: 'scope-a', user: { userId: 'user-a' }, activeTenant: { tenantId: 'tenant-a' },
    isLoading: false, isAuthenticated: true, isRestoring: false, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
    subscribe(callback: () => void) { authorityListeners.add(callback); return () => { authorityListeners.delete(callback); }; },
    subscribeAuthorization(callback: () => void) { authorityListeners.add(callback); return () => { authorityListeners.delete(callback); }; },
  } as unknown as AuthClient;
  const collection = {
    name: 'arc_rollups', primaryKey: 'id', getAll: () => byId,
    subscribe(callback: () => void) { rowListeners.add(callback); return () => { rowListeners.delete(callback); }; },
  } as unknown as Collection<ArcRollupRow>;
  const client = {
    auth, collection: () => collection, connected: true,
    onConnectionChange(callback: () => void) { connectionListeners.add(callback); return () => { connectionListeners.delete(callback); }; },
    _syncClient: { tables: { arc_rollups: { _pk: 'id', _sync: mode as ClientTableDef['_sync'] } } },
    _authorizationDataBoundary: dataBoundary,
  } as unknown as InternalClient;
  const publish = () => { for (const callback of rowListeners) callback(); };
  const setRows = (rows: ArcRollupRow[]) => { byId = Object.fromEntries(rows.map(row => [row.id, row])); };
  return {
    client,
    load(rows: ArcRollupRow[]) { setRows(rows); publish(); },
    insert(...rows: ArcRollupRow[]) { byId = { ...byId, ...Object.fromEntries(rows.map(row => [row.id, row])) }; publish(); },
    update(id: string, fields: Partial<ArcRollupRow>) { byId = { ...byId, [id]: { ...byId[id]!, ...fields } }; publish(); },
    remove(...ids: string[]) { byId = { ...byId }; for (const id of ids) delete byId[id]; publish(); },
    retireScope() {
      Object.assign(auth, { sessionTransition: { ...auth.sessionTransition, phase: 'preparing', revision: 1 } });
      for (const callback of authorityListeners) callback();
    },
    replaceScope(rows: ArcRollupRow[]) {
      Object.assign(auth, { authorizationScopeKey: 'scope-b', user: { userId: 'user-b' }, activeTenant: { tenantId: 'tenant-b' },
        sessionTransition: { ...auth.sessionTransition, phase: 'idle', revision: 2 } });
      setRows(rows); for (const callback of authorityListeners) callback();
    },
    retireAuthority() { Object.assign(auth, { authorizationState: { status: 'revoked' } }); dataBoundary.invalidate(); },
    revalidateAuthority(rows: ArcRollupRow[]) {
      setRows(rows); Object.assign(auth, { authorizationState: { status: 'ready' } });
      for (const callback of authorityListeners) callback();
    },
    subscriptions: () => ({ rows: rowListeners.size, connection: connectionListeners.size, authority: authorityListeners.size }),
  };
}
