import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import * as A from "./analytics.js";
import { outliersByIQR, outliersByZScore, mean, stdDev } from "./statistics.js";

export interface SeriesPoint { period:string; value:number; }
export interface AnomalyPoint { period:string; value:number; expected:number; deviation:number; zScore:number|null; method:"iqr"|"zscore"; direction?:"spike"|"drop"; severity?:"LOW"|"MEDIUM"|"HIGH"; reason?:string; lower?:number; upper?:number; }
export interface AnnotatedPoint extends SeriesPoint { expected:number; lower:number; upper:number; isAnomaly:boolean; }
export interface AnomalyResult { metric:string; points:AnomalyPoint[]; anomalies:AnomalyPoint[]; method?:string; }

function detectSeries(series:SeriesPoint[],metric:string):AnomalyResult{if(series.length<4)return{metric,points:[],anomalies:[],method:"iqr+zscore"};const values=series.map(p=>p.value),iqr=new Set(outliersByIQR(values,1.5)),z=new Set(outliersByZScore(values,2.5)),sorted=[...values].sort((a,b)=>a-b),med=sorted[Math.floor(sorted.length/2)],sd=stdDev(values);const points:AnomalyPoint[]=[];for(let i=0;i<series.length;i++){const p=series[i],zi=sd?(p.value-mean(values))/sd:0,isI=iqr.has(i),isZ=z.has(i);if(!isI&&!isZ)continue;const deviation=Math.round((p.value-med)*100)/100;points.push({period:p.period,value:p.value,expected:med,deviation,zScore:isZ?Math.round(zi*100)/100:null,method:isI?"iqr":"zscore",direction:p.value>=med?"spike":"drop",severity:Math.abs(zi)>=4?"HIGH":Math.abs(zi)>=2.5?"MEDIUM":"LOW",reason:`${metric} was ${Math.abs(deviation)} away from the median baseline.`});}return{metric,points,anomalies:points,method:"iqr+zscore"};}

export function detectAnomalies(rows:Row[],s:SchemaMap,metric:string|{id:string;compute:(rows:Row[],s:SchemaMap)=>number}):AnomalyResult;
export function detectAnomalies(series:SeriesPoint[],metric?:string):AnomalyResult;
export function detectAnomalies(a:Row[]|SeriesPoint[],b:SchemaMap|string,metric?:string|{id:string;compute:(rows:Row[],s:SchemaMap)=>number}):AnomalyResult{
 if(typeof b==="string")return detectSeries(a as SeriesPoint[],b);
 const m=typeof metric==="object"?metric.id:(metric??"revenue");return detectSeries(A.timeSeries(a as Row[],b,metric as any),m);
}
