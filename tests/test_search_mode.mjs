import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const requests = [];
const state = {scope:'mine', mode:'food', homeMode:'all'};
const cache = {homes:[], places:[], reviews:[]};
const result = rows => ({data:{version:2, actor:null, wishlist:[], homes:[], rows, more:false}});
const client = {rpc(_name, {kind, args}) {
  if (kind !== 'search') return Promise.resolve(result([]));
  return new Promise(resolve => requests.push({args, resolve}));
}};
const window = {dispatchEvent() {}};
vm.runInNewContext(fs.readFileSync('js/00-reads.js','utf8'), {
  window, CustomEvent:class {}, state, navigator:{onLine:true}, performance, TextEncoder,
});
const reader = window.XueReads.create(client, {
  uid:()=>null, cache:()=>cache, home:x=>x, place:x=>x, anon:{}, save() {},
});
await reader.refresh();
const food = reader.search('KL');
state.mode = 'travel';
const travel = reader.search('kl');
assert.deepEqual(requests.map(r=>r.args.mode), ['food','travel']);
requests[1].resolve(result([{place:{id:'travel-point'}}]));
requests[0].resolve(result([{place:{id:'stale-food-point'}}]));
await Promise.all([food,travel]);
assert.equal(cache.places.map(p=>p.id).join(','),'travel-point');
console.log('PASS same query searches the new mode and drops late results from the previous mode');
