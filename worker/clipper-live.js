// Clipper live stats — a Cloudflare Worker.
//
// Holds the platform API keys, checks the tracked accounts every hour
// (cron trigger) and serves the latest numbers to the Clipper app.
//
// Bindings (set in the Cloudflare dashboard, see README.md):
//   STATS            KV namespace — stores one JSON blob under "state"
//   APP_TOKEN        secret — the app sends it as "Authorization: Bearer …"
//   YT_API_KEY       secret — YouTube Data API v3 key
//   ALLOWED_ORIGINS  variable — comma-separated origins allowed to call this
//                    (e.g. https://ivanbyer-design.github.io,http://localhost:8765)
//
// Routes:
//   POST /track          {accounts:[{id,platform,handle}], videos:[youtubeVideoId]}
//                        replaces what is tracked, refreshes, returns stats
//   GET  /stats          latest stats; ?refresh=1 refreshes if older than 5 min

const MIN_REFRESH_MS = 5 * 60e3;
const MAX_DAYS = 400;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Vary': 'Origin',
  };
}

const today = () => new Date().toISOString().slice(0, 10);

async function loadState(env) {
  return (await env.STATS.get('state', 'json')) || { accounts: [], videos: [], data: {}, vids: {}, ranAt: 0, errors: [] };
}

async function youtube(path, params, env) {
  if (!env.YT_API_KEY) throw new Error('YT_API_KEY secret is not set on the worker');
  const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', env.YT_API_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function refresh(env, st) {
  const errors = [];
  const d = today();

  for (const a of st.accounts.filter(a => a.platform === 'YouTube')) {
    try {
      const handle = a.handle.startsWith('@') ? a.handle : '@' + a.handle;
      const r = await youtube('channels', { part: 'statistics', forHandle: handle }, env);
      const ch = r.items && r.items[0];
      if (!ch) { errors.push(`${a.handle}: no YouTube channel with that handle`); continue; }
      const s = ch.statistics;
      const rec = st.data[a.id] || { hist: {} };
      Object.assign(rec, {
        platform: 'YouTube', handle: a.handle, channelId: ch.id,
        followers: s.hiddenSubscriberCount ? null : Number(s.subscriberCount),
        views: Number(s.viewCount), videos: Number(s.videoCount), updated: Date.now(),
      });
      if (rec.followers != null) rec.hist[d] = rec.followers;
      const days = Object.keys(rec.hist).sort();
      while (days.length > MAX_DAYS) delete rec.hist[days.shift()];
      st.data[a.id] = rec;
    } catch (e) {
      errors.push(`${a.handle}: ${e.message}`);
    }
  }

  const ids = [...new Set(st.videos)];
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const r = await youtube('videos', { part: 'statistics', id: ids.slice(i, i + 50).join(',') }, env);
      for (const v of r.items || []) {
        st.vids[v.id] = {
          views: Number(v.statistics.viewCount) || 0,
          likes: Number(v.statistics.likeCount) || 0,
          comments: Number(v.statistics.commentCount) || 0,
          updated: Date.now(),
        };
      }
    } catch (e) {
      errors.push(`videos: ${e.message}`);
    }
  }

  // forget anything the app no longer tracks
  for (const id of Object.keys(st.data)) if (!st.accounts.some(a => a.id === id)) delete st.data[id];
  for (const id of Object.keys(st.vids)) if (!ids.includes(id)) delete st.vids[id];

  st.ranAt = Date.now();
  st.errors = errors;
  await env.STATS.put('state', JSON.stringify(st));
  return st;
}

const publicView = st => ({ ranAt: st.ranAt, errors: st.errors || [], accounts: st.data, videos: st.vids });

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.APP_TOKEN) return json({ error: 'APP_TOKEN secret is not set on the worker' }, 500, cors);
    if ((req.headers.get('authorization') || '') !== `Bearer ${env.APP_TOKEN}`) return json({ error: 'wrong access token' }, 401, cors);
    if (!env.STATS) return json({ error: 'STATS KV namespace is not bound to the worker' }, 500, cors);

    const url = new URL(req.url);
    let st = await loadState(env);

    if (req.method === 'POST' && url.pathname === '/track') {
      const body = await req.json().catch(() => null);
      if (!body || !Array.isArray(body.accounts)) return json({ error: 'expected {accounts:[…]}' }, 400, cors);
      st.accounts = body.accounts
        .filter(a => a && a.id && a.platform && a.handle)
        .slice(0, 100)
        .map(a => ({ id: String(a.id), platform: String(a.platform), handle: String(a.handle) }));
      st.videos = (Array.isArray(body.videos) ? body.videos : [])
        .filter(v => /^[\w-]{11}$/.test(v))
        .slice(0, 500);
      st = await refresh(env, st);
      return json(publicView(st), 200, cors);
    }

    if (req.method === 'GET' && url.pathname === '/stats') {
      if (url.searchParams.get('refresh') && Date.now() - st.ranAt > MIN_REFRESH_MS) st = await refresh(env, st);
      return json(publicView(st), 200, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(loadState(env).then(st => refresh(env, st)));
  },
};
