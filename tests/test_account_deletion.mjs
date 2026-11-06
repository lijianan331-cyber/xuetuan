import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDeleteAccountHandler } from '../supabase/functions/xuetuan-delete-account/handler.mjs';

const actor = 'aaaaaaaa-0000-4000-8000-000000000001';
let files, calls, authError, rpcError, storageError, unexpectedPath;
function reset() {
  files = [actor + '/nested/photo.jpg', actor + '/avatar.jpg'];
  calls = [];
  authError = rpcError = storageError = unexpectedPath = false;
}
const handler = makeDeleteAccountHandler({
  url: 'https://synthetic.invalid', key: 'anon', serviceKey: 'service',
  createClient(_url, key) {
    if (key === 'anon') return { auth: { getUser: async () =>
      authError ? {error: true} : {data: {user: {id: actor}}}
    } };
    return {
      rpc: async (name, args) => {
        assert.equal(name, 'xuetuan_account_delete_step');
        assert.equal(args.actor, actor);
        calls.push('step');
        if (rpcError) return {error: true};
        return {data: files.length ? {status: 'pending', paths: unexpectedPath ? ['another/account.jpg'] : files.slice(0, 1)} : {status: 'deleted'}};
      },
      storage: {from(bucket) {
        assert.equal(bucket, 'photos');
        return {remove: async paths => {
          calls.push('remove');
          if (storageError) return {error: true};
          files = files.filter(path => !paths.includes(path));
          return {};
        }};
      }},
    };
  },
});
async function call(body = {confirmed: true}, origin = 'https://xuetuan.vercel.app') {
  const req = new Request('https://synthetic.invalid', {
    method: 'POST', headers: {'authorization': 'Bearer synthetic', origin},
    body: JSON.stringify(body),
  });
  const res = await handler(req);
  return (await res.json()).status;
}
reset();
assert.equal(await call({}), 'unconfirmed');
assert.equal(await call({confirmed: true}, 'https://other.vercel.app'), 'forbidden');
authError = true;
assert.equal(await call(), 'unauthenticated');
assert.deepEqual(calls, []);
reset(); rpcError = true;
assert.equal(await call(), 'unavailable');
assert.deepEqual(calls, ['step']);
reset(); unexpectedPath = true;
assert.equal(await call(), 'unavailable');
assert.deepEqual(calls, ['step']);
reset(); storageError = true;
assert.equal(await call(), 'pending');
assert.deepEqual(calls, ['step', 'remove']);
assert.equal(files.length, 2);
storageError = false;
assert.equal(await call({confirmed: true, actor: 'different-user'}), 'deleted');
assert.deepEqual(calls.slice(2), ['step', 'remove', 'step', 'remove', 'step']);
assert.deepEqual(files, []);
console.log('PASS verified identity, origin, explicit confirmation, missing RPC, cross-folder rejection, partial failure and safe retry');

const bundledSDK = fs.readFileSync(new URL('../vendor/supabase-js-2.117.3.js', import.meta.url), 'utf8');
const {createClient} = new Function(bundledSDK + '\nreturn supabase;')();
let storageRequest;
const sdk = createClient('https://synthetic.invalid', 'synthetic', {
  auth: {persistSession:false, autoRefreshToken:false, detectSessionInUrl:false},
  global: {
    headers: {'x-client-info':'xuetuan-delete-safe/1'},
    fetch: async (url, options) => {
      storageRequest = {url, headers: new Headers(options.headers)};
      return new Response('[]', {headers:{'content-type':'application/json'}});
    },
  },
});
const sdkRemove = await sdk.storage.from('photos').remove([actor+'/test.jpg']);
assert.equal(sdkRemove.error,null);
assert.match(String(storageRequest.url), /\/storage\/v1\/object\/photos$/);
assert.match(storageRequest.headers.get('x-client-info'), /xuetuan-delete-safe\/1/);
console.log('PASS bundled Storage SDK sends the safe-client marker on ordinary photo deletion');
