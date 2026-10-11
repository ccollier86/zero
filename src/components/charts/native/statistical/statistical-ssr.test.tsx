/** Native statistical SSR exact companions. Synthetic data only, no chart engine, providers or application bootstrap. */
import{expect,test}from"bun:test";
import{createElement}from"react";
import{renderToStaticMarkup}from"react-dom/server";
import{HistogramChart}from"./histogram-chart";
import{MatrixHeatmap}from"./matrix-heatmap";
import{BoxPlotChart}from"./box-plot-chart";
import{WaterfallChart}from"./waterfall-chart";
import{CandlestickChart}from"./candlestick-chart";
test("all five statistical organisms SSR with owned SVG and exact tables",()=>{
 const fixtures=[createElement(HistogramChart,{label:"Histogram",observations:[{id:"a",value:0},{id:"b",value:1},{id:"c",value:2}],binning:{edges:[0,1,2]}}),createElement(MatrixHeatmap,{label:"Matrix",data:{rows:[{id:"r",label:"Requests"}],columns:[{id:"c",label:"Count"}],cells:[{id:"zero",rowId:"r",columnId:"c",value:0}]}}),createElement(BoxPlotChart,{label:"Box",series:[{id:"a",label:"Observed",values:[1,2,3,4,5,100]}]}),createElement(WaterfallChart,{label:"Balance",steps:[{id:"a",label:"Revenue",kind:"contribution",value:5},{id:"b",label:"Costs",kind:"contribution",value:-8},{id:"c",label:"Balance",kind:"subtotal"}]}),createElement(CandlestickChart,{label:"Prices",data:[{id:"a",label:"Period A",time:1780000000000,open:10,high:14,low:8,close:12}]})];
 for(const fixture of fixtures){const html=renderToStaticMarkup(fixture);expect(html).toContain("<svg");expect(html).toContain("<table");expect(html).not.toContain("NaN");expect(html).not.toContain("Infinity");expect(html).not.toContain("recharts");expect(html).toContain("data-zero-native-chart");}
 expect(renderToStaticMarkup(fixtures[2]!)).toContain("3.5");expect(renderToStaticMarkup(fixtures[4]!)).toContain("1780000000000");
});
test("empty organisms have honest empty language and null statistical readouts",()=>{
 const fixtures=[createElement(HistogramChart,{label:"H",observations:[]}),createElement(MatrixHeatmap,{label:"M",data:{rows:[],columns:[],cells:[]}}),createElement(BoxPlotChart,{label:"B",series:[{id:"empty",label:"Empty distribution",values:[]}]}),createElement(WaterfallChart,{label:"W",steps:[]}),createElement(CandlestickChart,{label:"C",data:[]})];
 for(const fixture of fixtures){const html=renderToStaticMarkup(fixture);expect(html).toContain("No ");expect(html).not.toContain("NaN");expect(html).not.toContain("Infinity");}
 const html=renderToStaticMarkup(fixtures[2]!);expect(html).toContain("—");expect(html).toContain("Empty distribution");
});
test("full exact statistics survive summary-only inputs and very narrow high-magnitude domains",()=>{
 const html=renderToStaticMarkup(createElement(BoxPlotChart,{label:"Exact",series:[{id:"s",label:"Summary only",summary:{n:1,min:1e12,q1:1e12,median:1e12,q3:1e12,max:1e12,whiskerLow:1e12,whiskerHigh:1e12,outliers:[]}}],motion:false}));expect(html).toContain("Summary only");expect(html).toContain("summary");expect(html).not.toContain("NaN");expect(html).toContain('data-motion="off"');
 expect(()=>renderToStaticMarkup(createElement(HistogramChart,{label:"Invalid",observations:[{id:"x",value:Infinity}]}))).toThrow();
});
test("accessible companions preserve full precision independently of decorative value formatting",()=>{
 const fixtures=[createElement(HistogramChart,{label:"Tiny intervals",observations:[{id:"a",value:.0000123}],binning:{edges:[.00001,.00002]},formatValue:()=>"rounded"}),createElement(MatrixHeatmap,{label:"Precise matrix",data:{rows:[{id:"r",label:"R"}],columns:[{id:"c",label:"C"}],cells:[{id:"value",rowId:"r",columnId:"c",value:.0000123}]},formatValue:()=>"rounded"}),createElement(BoxPlotChart,{label:"Precise boxes",series:[{id:"a",label:"A",values:[.0000123]}],formatValue:()=>"rounded"}),createElement(WaterfallChart,{label:"Precise balance",steps:[{id:"a",label:"A",kind:"contribution",value:.0000123}],formatValue:()=>"rounded"}),createElement(CandlestickChart,{label:"Precise candles",data:[{id:"a",label:"A",time:0,open:.0000123,low:.00001,high:.00002,close:.0000123}],formatValue:()=>"rounded"})];
 for(const fixture of fixtures){const html=renderToStaticMarkup(fixture),table=html.slice(html.indexOf("<table"));expect(table).toContain("0.0000123");}
});
test("untyped opt-out cannot remove any of the five guaranteed exact companions",()=>{
 const untyped={showTable:false},fixtures=[createElement(HistogramChart,{label:"H",observations:[],...untyped}),createElement(MatrixHeatmap,{label:"M",data:{rows:[],columns:[],cells:[]},...untyped}),createElement(BoxPlotChart,{label:"B",series:[],...untyped}),createElement(WaterfallChart,{label:"W",steps:[],...untyped}),createElement(CandlestickChart,{label:"C",data:[],...untyped})];for(const fixture of fixtures)expect(renderToStaticMarkup(fixture)).toContain("<table");
});
