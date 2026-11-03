// 点评翻译（用户 2026-11-03 选了 Google 翻译）：网页把要翻的文字发来，这里用后端的 GOOGLE_TRANSLATE_KEY 调
// Google Cloud Translation v2，key 不进网页。每次最多 20 段、合计 3000 字，只收雪团支持的目标语言。
// 额度上限请在 Google Cloud 控制台给 Translation API 设每日配额，防止被刷。
const TARGETS = new Set(['zh-CN', 'en', 'kk', 'ar', 'id', 'ms']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-xuetuan-device',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const key = Deno.env.get('GOOGLE_TRANSLATE_KEY');
  if (!key) return json({ error: 'no_key' }, 503);
  let body: { q?: unknown; target?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const target = String(body.target || '');
  const q = Array.isArray(body.q) ? body.q.map((s) => String(s ?? '')).filter((s) => s.trim()) : [];
  if (!TARGETS.has(target) || !q.length || q.length > 20 || q.join('').length > 3000) return json({ error: 'bad_request' }, 400);
  const r = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, target, format: 'text' }),
  });
  if (!r.ok) return json({ error: 'upstream', status: r.status }, 502);
  const d = await r.json();
  const out = (d?.data?.translations || []).map((x: { translatedText?: string; detectedSourceLanguage?: string }) => ({ text: x.translatedText || '', src: x.detectedSourceLanguage || '' }));
  return json({ translations: out });
});
