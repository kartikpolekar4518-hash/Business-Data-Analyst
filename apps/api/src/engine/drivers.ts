import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import type { PackMetric } from "./industries.js";

export type DriverMetric = "revenue" | "profit" | "quantity" | "orders";
export interface DriverContribution { dimension:Semantic; label:string; delta:number; currentValue:number; previousValue:number; changePct:number|null; shareOfDelta:number; }
export interface DriverResult {
  metric:string; dimension:Semantic|null; totalDelta:number; currentTotal:number; previousTotal:number; contributions:DriverContribution[];
  totalPrevious:number; totalCurrent:number; totalChange:number; totalChangePct:number|null;
  drivers: Array<DriverContribution & {current:number;previous:number;contribution:number;shareOfChange:number|null;direction:"up"|"down"|"flat";explanation:string}>;
  otherCount:number; otherContribution:number; reconciled:boolean;
}
function splitPeriods(rows:Row[],s:SchemaMap){if(!s.date)return{current:rows,previous:[]};const d=rows.map(r=>({r,d:A.parseDate(r[s.date!])})).filter(x=>x.d) as {r:Row;d:Date}[];if(d.length<4)return{current:rows,previous:[]};d.sort((a,b)=>a.d.getTime()-b.d.getTime());const mid=d[Math.floor(d.length/2)].d.getTime(),current:Row[]=[],previous:Row[]=[];for(const x of d)(x.d.getTime()>=mid?current:previous).push(x.r);return{current,previous};}
function sumMetric(rows:Row[],s:SchemaMap,m:PackMetric|string):number{if(typeof m==="object")return m.compute(rows,s);switch(m){case"revenue":return rows.reduce((a,r)=>a+A.rowRevenue(r,s),0);case"profit":return rows.reduce((a,r)=>a+A.rowProfit(r,s),0);case"quantity":return rows.reduce((a,r)=>a+(s.quantity?A.num(r[s.quantity]):1),0);case"orders":return s.order_id?new Set(rows.map(r=>A.str(r[s.order_id!]))).size:rows.length;default:return 0;}}
export function analyzeDrivers(rows:Row[],s:SchemaMap,metric:PackMetric|string="revenue",dimension?:Semantic,_f:A.Filters={},limit=10):DriverResult{
 const {current,previous}=splitPeriods(rows,s);const col=dimension?(s[dimension]?dimension:null):(s.product_name?"product_name":s.category?"category":s.region?"region":s.customer_name?"customer_name":null);const m=typeof metric==="object"?metric.id:metric;
 const curTotal=sumMetric(current,s,metric),prevTotal=sumMetric(previous,s,metric),delta=curTotal-prevTotal;
 const empty:DriverResult={metric:m,dimension:col,totalDelta:round(delta),currentTotal:round(curTotal),previousTotal:round(prevTotal),contributions:[],totalPrevious:round(prevTotal),totalCurrent:round(curTotal),totalChange:round(delta),totalChangePct:prevTotal?round(delta/Math.abs(prevTotal)*100):null,drivers:[],otherCount:0,otherContribution:0,reconciled:true};
 if(!col)return empty;
 const c=s[col];const bucket=(rs:Row[])=>{const map=new Map<string,Row[]>();for(const r of rs){const k=A.str(r[c!])||"Unknown";const b=map.get(k)??[];b.push(r);map.set(k,b);}return map;};
 const cm=bucket(current),pm=bucket(previous);const keys=new Set([...cm.keys(),...pm.keys()]);
 const all:DriverContribution[]=[...keys].map(k=>{const cv=sumMetric(cm.get(k)??[],s,metric),pv=sumMetric(pm.get(k)??[],s,metric),d=cv-pv;return{dimension:col!,label:k,delta:round(d),currentValue:round(cv),previousValue:round(pv),changePct:pv?round(d/Math.abs(pv)*100):null,shareOfDelta:delta?Math.abs(d)/Math.abs(delta):0};}).filter(x=>x.delta!==0).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
 const sumAll=all.reduce((a,x)=>a+x.delta,0);const top=all.slice(0,limit);const rest=all.slice(limit);const aliases=top.map(x=>({ ...x,current:x.currentValue,previous:x.previousValue,contribution:x.delta,shareOfChange:delta?x.delta/delta*100:null,direction:x.delta>0?"up" as const:x.delta<0?"down" as const:"flat" as const,explanation:`${x.label} changed by ${A.fmtMoney(Math.abs(x.delta))}.`}));
 return{...empty,contributions:top,drivers:aliases,otherCount:rest.length,otherContribution:round(rest.reduce((a,x)=>a+x.delta,0)),reconciled:Math.abs(sumAll-delta)<0.01};
}
export interface Decomposition{metric:"revenue";volumeDelta:number;priceDelta:number;mixDelta:number;totalDelta:number;currentUnits:number;previousUnits:number;currentAvgPrice:number;previousAvgPrice:number;canDecompose:boolean;}
export function decomposePriceVolumeMix(rows:Row[],s:SchemaMap):Decomposition{const{current,previous}=splitPeriods(rows,s);const z:Decomposition={metric:"revenue",volumeDelta:0,priceDelta:0,mixDelta:0,totalDelta:0,currentUnits:0,previousUnits:0,currentAvgPrice:0,previousAvgPrice:0,canDecompose:false};if(!s.quantity||!s.unit_price)return z;const q=(r:Row[])=>r.reduce((a,x)=>a+A.num(x[s.quantity!]),0),rev=(r:Row[])=>r.reduce((a,x)=>a+A.rowRevenue(x,s),0);const q2=q(current),q1=q(previous),r2=rev(current),r1=rev(previous);if(!q1||!q2)return z;const p1=r1/q1,p2=r2/q2,vd=(q2-q1)*p1,pd=q2*(p2-p1),td=r2-r1;return{metric:"revenue",volumeDelta:round(vd),priceDelta:round(pd),mixDelta:round(td-vd-pd),totalDelta:round(td),currentUnits:round(q2),previousUnits:round(q1),currentAvgPrice:round(p2),previousAvgPrice:round(p1),canDecompose:true};}
function round(n:number){return Math.round(n*100)/100;}
