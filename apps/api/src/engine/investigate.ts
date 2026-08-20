import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { analyzeDrivers, decomposePriceVolumeMix, type DriverResult, type Decomposition } from "./drivers.js";
import { correlateMetric, type CorrelationResult } from "./correlate.js";
import { detectAnomalies, type AnomalyResult } from "./anomaly.js";
import { detectPack, getPack, packMetric, type PackMetric } from "./industries.js";
export interface EvidenceClaim { kind:"driver"|"decomposition"|"correlation"|"anomaly"; metric:string; period:string; dimension?:string; detail:string; rows:number; value:number; }
export interface Investigation { metric:string; metricLabel:string; pack:string; totalDelta:number; currentTotal:number; previousTotal:number; changePct:number|null; drivers:DriverResult[]; decompo[...]
const CANDIDATE_DIMENSIONS: Semantic[]=["product_name","customer_name","region","category","state","department"];
export function investigate(rows:Row[],s:SchemaMap,metricId:string,packId?:string):Investigation{
 const pack=packId?getPack(packId):detectPack(s,[],""); const metric=packMetric(pack,metricId)??packMetric(pack,"revenue")!; const drivers:DriverResult[]=[];
 for(const dim of CANDIDATE_DIMENSIONS){if(!s[dim])continue;const d=analyzeDrivers(rows,s,metric,dim,{},5);if(d.contributions.length)drivers.push(d);} drivers.sort((a,b)=>Math.abs(b.totalDelta)-Ma[...]
 const series=A.timeSeries(rows,s,metric);const fallbackPrev=series.length>=2?series[series.length-2]!.value:0;const fallbackCur=series.length>=1?series[series.length-1]!.value:0;const currentTota[...]
 const decomposition=metric.id==="revenue"?decomposePriceVolumeMix(rows,s):null;const correlation=correlateMetric(rows,s,metric);const anomalies=detectAnomalies(rows,s,metric);const claims:Evidenc[...]
 for(const d of drivers.slice(0,3)){const top=d.contributions[0];if(!top)continue;claims.push({kind:"driver",metric:metric.id,period:"current vs previous half",dimension:d.dimension,detail:`${top.[...]
 if(decomposition?.canDecompose){const parts:string[]=[];if(Math.abs(decomposition.volumeDelta)>.01)parts.push(`volume ${fmt(decomposition.volumeDelta)}`);if(Math.abs(decomposition.priceDelta)>.01[...]
 for(const f of (correlation?.factors??[]).slice(0,3)){if(f.strength==="weak")continue;claims.push({kind:"correlation",metric:metric.id,period:"monthly",dimension:f.column,detail:`${f.column} move[...]
 for(const a of (anomalies?.points??[]).slice(0,2))claims.push({kind:"anomaly",metric:metric.id,period:a.period,detail:`${a.period} was anomalous (${fmt(a.deviation)} vs median ${fmt(a.expected)})[...]
 const narrative=buildNarrative(metric,totalDelta,changePct,drivers,decomposition,correlation,anomalies);return{metric:metric.id,metricLabel:metric.label!,pack:pack.id,totalDelta,currentTotal,previ[...]
}
function buildNarrative(metric:PackMetric,totalDelta:number,changePct:number|null,drivers:DriverResult[],decomposition:Decomposition|null,correlation:CorrelationResult|null,anomalies:AnomalyResult[...]
function fmt(n:number):string{const v=A.num(n);return Math.abs(v)>=1000?v.toLocaleString(undefined,{maximumFractionDigits:0}):String(Math.round(v*100)/100);}
