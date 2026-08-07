'use strict';

const DEFAULT_WATCHLIST = ['TSLA','NVDA','AAPL','MSFT','GOOGL','AMZN','META','AVGO','AMD','ORCL','PLTR','NFLX','TSM','ASML','MU','CRDO','ALAB'];
const JSON_HEADERS = { 'content-type':'application/json; charset=utf-8', 'cache-control':'private, max-age=60', 'x-content-type-options':'nosniff' };

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
function dateOnly(value) { return String(value || '').slice(0,10); }
function safeTicker(value) { const ticker=String(value||'').trim().toUpperCase(); return /^[A-Z0-9.\-]{1,12}$/.test(ticker)?ticker:null; }
function shiftDate(date, days) { const parsed=new Date(`${date}T00:00:00Z`); parsed.setUTCDate(parsed.getUTCDate()+days); return parsed.toISOString().slice(0,10); }
function shiftMonths(date, months) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDate();
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  parsed.setUTCDate(Math.min(day, lastDay));
  return parsed.toISOString().slice(0,10);
}
function firstDayOfMonth(date) { return `${date.slice(0,7)}-01`; }
function priorYearEnd(date) { return `${Number(date.slice(0,4)) - 1}-12-31`; }
function adjusted(row, adjustedField, rawField) { const a=Number(row?.[adjustedField]); if(Number.isFinite(a)&&a>0)return a; const r=Number(row?.[rawField]); return Number.isFinite(r)&&r>0?r:null; }
async function readJson(bucket,key,fallback=null){const obj=await bucket.get(key);if(!obj)return fallback;try{return await obj.json();}catch{return fallback;}}
function average(values){const valid=values.filter(Number.isFinite);return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;}
function findAtOrBefore(rows,target){for(let i=rows.length-1;i>=0;i-=1){if(dateOnly(rows[i]?.date)<=target)return rows[i];}return null;}
function returnFromTarget(rows, latest, targetDate) {
  const baseRow = findAtOrBefore(rows, targetDate);
  const base = adjusted(baseRow,'adjClose','close');
  return Number.isFinite(base) && base > 0 ? latest / base - 1 : null;
}

async function readWatchlist(env){const stored=await readJson(env.STOCK_DATA,'config/watchlist.json',null);const symbols=Array.isArray(stored?.symbols)?stored.symbols.map(safeTicker).filter(Boolean):[];return{symbols:symbols.length?[...new Set(symbols)]:DEFAULT_WATCHLIST.slice(),updatedAt:stored?.updatedAt||null};}

async function buildItem(env,symbol){
  const manifest=await readJson(env.STOCK_DATA,`prices/${symbol}/manifest.json`,null);
  const cachedMeta=await readJson(env.STOCK_DATA,`meta/${symbol}.json`,null);
  const name=cachedMeta?.data?.name||symbol;
  const years=Object.keys(manifest?.years||{}).filter(y=>/^\d{4}$/.test(y)).sort();
  if(!years.length)return{symbol,name,initialized:false,rows:0,lastDate:null,lastSyncAt:manifest?.lastSyncAt||null};
  const chunks=await Promise.all(years.slice(-2).map(y=>readJson(env.STOCK_DATA,`prices/${symbol}/${y}.json`,[])));
  const rows=chunks.flatMap(v=>Array.isArray(v)?v:[]).filter(r=>dateOnly(r?.date)&&adjusted(r,'adjClose','close')).sort((a,b)=>dateOnly(a.date).localeCompare(dateOnly(b.date)));
  if(!rows.length)return{symbol,name,initialized:false,rows:0,lastDate:null,lastSyncAt:manifest?.lastSyncAt||null};

  const last=rows.at(-1),prev=rows.at(-2)||null;
  const lastDate=dateOnly(last.date);
  const latest=adjusted(last,'adjClose','close'),previous=adjusted(prev,'adjClose','close');
  const monthStart=firstDayOfMonth(lastDate);
  const changeMtd=returnFromTarget(rows,latest,shiftDate(monthStart,-1));
  const change1m=returnFromTarget(rows,latest,shiftMonths(lastDate,-1));
  const change3m=returnFromTarget(rows,latest,shiftMonths(lastDate,-3));
  const changeYtd=returnFromTarget(rows,latest,priorYearEnd(lastDate));
  const change1y=returnFromTarget(rows,latest,shiftMonths(lastDate,-12));
  const week52=rows.slice(-252);const week52High=Math.max(...week52.map(r=>adjusted(r,'adjHigh','high')||adjusted(r,'adjClose','close')||0));
  const totalRows=Object.values(manifest?.years||{}).reduce((sum,info)=>sum+Number(info?.rows||0),0);

  return{
    symbol,name,initialized:true,latest,
    change1d:previous?latest/previous-1:null,
    changeMtd,change1m,change3m,changeYtd,change1y,
    distance52:week52High?latest/week52High-1:null,
    lastDate,lastSyncAt:manifest?.lastSyncAt||null,rows:totalRows,
    spark:rows.slice(-44).map(r=>adjusted(r,'adjClose','close')).filter(Number.isFinite)
  };
}

export async function handleOverview(env){
  if(!env.STOCK_DATA)return json({error:'Cloudflare R2 绑定 STOCK_DATA 尚未配置。'},503);
  const watchlist=await readWatchlist(env);const items=[];
  for(let i=0;i<watchlist.symbols.length;i+=8)items.push(...await Promise.all(watchlist.symbols.slice(i,i+8).map(s=>buildItem(env,s))));
  const initialized=items.filter(i=>i.initialized);const sorted=initialized.filter(i=>Number.isFinite(i.change1d)).sort((a,b)=>b.change1d-a.change1d);
  const summary={total:items.length,initialized:initialized.length,pending:items.length-initialized.length,advancers:initialized.filter(i=>Number.isFinite(i.change1d)&&i.change1d>0).length,decliners:initialized.filter(i=>Number.isFinite(i.change1d)&&i.change1d<0).length,unchanged:initialized.filter(i=>i.change1d===0).length,averageDay:average(initialized.map(i=>i.change1d)),averageMonth:average(initialized.map(i=>i.change1m)),leader:sorted.length?{symbol:sorted[0].symbol,change:sorted[0].change1d}:null,laggard:sorted.length?{symbol:sorted.at(-1).symbol,change:sorted.at(-1).change1d}:null};
  return json({generatedAt:new Date().toISOString(),watchlistUpdatedAt:watchlist.updatedAt,summary,items});
}
