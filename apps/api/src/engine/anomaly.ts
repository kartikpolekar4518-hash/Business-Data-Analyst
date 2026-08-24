import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import * as A from "./analytics.js";
import { stdDev } from "./statistics.js";
export interface SeriesPoint{period:string;value:number;}
export interface AnomalyPoint{period:string;value:number;expected:number;deviation:number;zScore:number|null;method:"iqr"|"zscore";direction?:"spike"|"drop";severity?:"LOW"|"MEDIUM"|"HIGH";reason?:string;lower:number;upper:number;isAnomaly:boolean;}
export interface AnnotatedPoint extends SeriesPoint{expected:number;lower:number;upper:number;isAnomaly:boolean;}
export interface AnomalyResult{metric:string;points:AnomalyPoint[];anomalies:AnomalyPoint[];method?:string;}
function median(xs:number[]):number{if(!xs.length)return 0;const a=[...xs].sort((p,q)=>p-q),m=Math.floor(a.length/2);return a.length%2?a[m]!:(a[m-1]!+a[m]!)/2;}
// A point is anomalous when its Iglewicz–Hoaglin modified z-score (median/MAD based,
// so a single wild point cannot inflate the "normal" spread and hide itself) exceeds
// the 3.5 threshold. The drawn band is expected ± 3.5 units of normal variation, so a
// flagged point always sits outside its band by construction. MAD falls back to the
// standard deviation only when every deviation-from-median is zero-but-not-flat.
function detectSeries(series:SeriesPoint[],metric:string):AnomalyResult{if(series.length<4)return{metric,points:[],anomalies:[],method:"mad-zscore"};const values=series.map(p=>p.value),med=median(values),mad=median(values.map(v=>Math.abs(v-med))),sd=stdDev(values),T=3.5,scale=mad>0?mad/0.6745:sd,lower=Math.round((med-T*scale)*100)/100,upper=Math.round((med+T*scale)*100)/100;const points:AnomalyPoint[]=[],anomalies:AnomalyPoint[]=[];for(const p of series){const z=scale>0?(p.value-med)/scale:0,isAnomaly=Math.abs(z)>=T,deviation=Math.round((p.value-med)*100)/100;const point:AnomalyPoint={period:p.period,value:p.value,expected:med,deviation,zScore:isAnomaly?Math.round(z*100)/100:null,method:"zscore",direction:p.value>=med?"spike":"drop",severity:isAnomaly?(Math.abs(z)>=5?"HIGH":Math.abs(z)>=T?"MEDIUM":"LOW"):undefined,reason:isAnomaly?`${metric} was ${p.value} in ${p.period}, versus an expected ~${Math.round(med)} (${Math.abs(z).toFixed(1)}σ from normal).`:undefined,lower,upper,isAnomaly};points.push(point);if(isAnomaly)anomalies.push(point);}return{metric,points,anomalies,method:"mad-zscore"};}
export function detectAnomalies(rows:Row[],s:SchemaMap,metric:string|{id:string;compute:(rows:Row[],s:SchemaMap)=>number}):AnomalyResult;
export function detectAnomalies(series:SeriesPoint[],metric?:string):AnomalyResult;
export function detectAnomalies(a:Row[]|SeriesPoint[],b:SchemaMap|string="revenue",metric?:string|{id:string;compute:(rows:Row[],s:SchemaMap)=>number}):AnomalyResult{if(typeof b==="string")return detectSeries(a as SeriesPoint[],b);const m=typeof metric==="object"?metric.id:(metric??"revenue");return detectSeries(A.timeSeries(a as Row[],b,metric as any),m);}
