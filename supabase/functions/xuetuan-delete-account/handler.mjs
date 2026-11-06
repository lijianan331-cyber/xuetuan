const origins = new Set([
  'https://xuetuan.vercel.app',
  'https://xuetuan-git-claude-project-thread-ze8a57-ganan1.vercel.app',
]);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function makeDeleteAccountHandler({ createClient, url, key, serviceKey }) {
  return async function (req) {
    const origin = req.headers.get('origin');
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,x-xuetuan-device',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.has(origin)) return reply(403, { status: 'forbidden' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { status: 'unavailable' });
    const token = (req.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token || token.length > 12000) return reply(401, { status: 'unauthenticated' });

    let started = false;
    try {
      const body = await req.json();
      if (body?.confirmed !== true) return reply(400, { status: 'unconfirmed' });
      const identity = await createClient(url, key, options).auth.getUser(token);
      const actor = identity.data?.user?.id;
      if (identity.error || !actor) return reply(401, { status: 'unauthenticated' });

      const admin = createClient(url, serviceKey, options);
      for (let batch = 0; batch < 8; batch++) {
        const step = await admin.rpc('xuetuan_account_delete_step', { actor });
        if (step.error) return reply(200, { status: started ? 'pending' : 'unavailable' });
        if (step.data?.status === 'deleted') return reply(200, { status: 'deleted' });
        if (step.data?.status === 'forbidden') return reply(200, { status: 'forbidden' });
        const paths = step.data?.paths;
        if (!Array.isArray(paths) || paths.length < 1 ||
            paths.some(path => typeof path !== 'string' || !path.startsWith(actor + '/'))) {
          return reply(200, { status: 'unavailable' });
        }
        started = true;
        const removed = await admin.storage.from('photos').remove(paths);
        if (removed.error) return reply(200, { status: 'pending' });
      }
      return reply(200, { status: 'pending' });
    } catch {
      return reply(200, { status: started ? 'pending' : 'unavailable' });
    }
  };
}
