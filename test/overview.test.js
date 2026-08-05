import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOverview } from '../src/overview.js';

class MemoryR2 {
  constructor(){ this.map=new Map(); }
  async get(key){ if(!this.map.has(key)) return null; const value=this.map.get(key); return { async json(){ return JSON.parse(value); } }; }
  async put(key,value){ this.map.set(key,String(value)); }
}

test('overview reads R2 only and reports pending symbols',async()=>{
  const bucket=new MemoryR2();
  await bucket.put('config/watchlist.json',JSON.stringify({symbols:['TSLA','NVDA']}));
  await bucket.put('prices/TSLA/manifest.json',JSON.stringify({years:{'2026':{rows:3}},lastSyncAt:'2026-08-05T00:00:00Z'}));
  await bucket.put('prices/TSLA/2026.json',JSON.stringify([
    {date:'2026-07-01',adjClose:100,adjHigh:102},
    {date:'2026-08-03',adjClose:110,adjHigh:112},
    {date:'2026-08-04',adjClose:121,adjHigh:122}
  ]));
  await bucket.put('meta/TSLA.json',JSON.stringify({data:{name:'Tesla, Inc.'}}));
  const response=await handleOverview({STOCK_DATA:bucket});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.summary.total,2);
  assert.equal(data.summary.initialized,1);
  assert.equal(data.summary.pending,1);
  assert.equal(data.items[0].name,'Tesla, Inc.');
  assert.ok(data.items[0].change1d>0);
  assert.equal(data.items[1].initialized,false);
});
