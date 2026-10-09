/**
 * Matchday API proxy  (Cloudflare Worker)
 * ----------------------------------------------------------------------------
 * The game talks to THIS worker instead of Supabase. The Supabase key lives only
 * here (as a secret), never in the page. The worker also:
 *   - only lets your own site call it (Origin allow-list)
 *   - only exposes the exact queries the game uses (no free-form table access)
 *   - validates every write (types, ranges, plausible progress vs. the stored row)
 *   - rate-limits per IP
 *   - passes the realtime (matchmaking / live match) WebSocket through, adding the key
 *
 * Deploy:  see matchday-proxy-README.md
 * Env:     SUPABASE_URL      e.g. https://uioscnsawpgoysfvajix.supabase.co
 *          SUPABASE_KEY      (secret)  your publishable / anon key
 *          ALLOWED_ORIGINS   comma list, e.g. https://mygame.example,https://me.github.io
 */

/* ---- tune these to your game ------------------------------------------------ */
const LIMITS = {
  nameMax: 16,
  ratingStart: 1000, ratingStepMax: 40,      // one ranked game moves rating by at most ~36
  ratingMax: 4000,
  careerGamesPerSeason: 80,                  // generous upper bound on matches per season
  trophiesPerSeason: 4,
  scoreStepMax: 260,                         // one save may add at most this much career score
  winsStepMax: 3,
  rpmRead: 120, rpmWrite: 30,                // requests per minute per IP (best effort, per isolate)
};

const ID_RX = /^[a-z0-9][a-z0-9-]{3,47}$/i;
const POS = new Set(['GK', 'DF', 'MF', 'FW']);

const GET_ALLOW = {
  leaderboard: new Set(['select=id,name,club,score,trophies,seasons&order=score.desc&limit=20']),
  scorers: new Set(['select=manager,club,num,pos,goals,season&order=goals.desc&limit=10']),
  ranked: new Set(['select=id,name,rating,wins,draws,losses&order=rating.desc&limit=20']),
  dream_ranked: new Set(['select=id,name,rating,wins,draws,losses&order=rating.desc&limit=20']),
};

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const str = (v, max, rx) => typeof v === 'string' && v.length >= 1 && v.length <= max && !/[\u0000-\u001f<>]/.test(v) && (!rx || rx.test(v));
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every(k => k in o);

/* ---- per-table validation. `old` is the stored row (or null). Return error string or null ---- */
const VALIDATE = {
  leaderboard(r, old) {
    if (!exact(r, ['id', 'name', 'club', 'score', 'trophies', 'seasons', 'wins'])) return 'shape';
    if (!str(r.id, 48, ID_RX) || !str(r.name, LIMITS.nameMax) || !str(r.club, 6, /^[A-Za-z0-9]+$/)) return 'text';
    if (!int(r.seasons, 1, 200) || !int(r.trophies, 0, 200) || !int(r.wins, 0, 20000) || !int(r.score, 0, 200000)) return 'range';
    const maxGames = r.seasons * LIMITS.careerGamesPerSeason;
    if (r.wins > maxGames || r.trophies > r.seasons * LIMITS.trophiesPerSeason) return 'implausible';
    if (r.score > r.wins * 3 + (maxGames - r.wins) + r.trophies * 100) return 'implausible';
    if (old) {
      if (r.score > old.score + LIMITS.scoreStepMax) return 'score jump';
      if (r.wins > old.wins + LIMITS.winsStepMax) return 'wins jump';
      if (r.seasons > old.seasons + 1) return 'season jump';
    }
    return null;
  },
  scorers(r) {
    if (!exact(r, ['id', 'manager', 'club', 'num', 'pos', 'goals', 'season'])) return 'shape';
    if (!str(r.id, 64, /^[a-z0-9-]+$/i) || !str(r.manager, LIMITS.nameMax) || !str(r.club, 6, /^[A-Za-z0-9]+$/)) return 'text';
    if (!POS.has(r.pos) || !int(r.num, 1, 99) || !int(r.season, 1, 200) || !int(r.goals, 0, 300)) return 'range';
    if (r.goals > r.season * LIMITS.careerGamesPerSeason * 3) return 'implausible';
    return null;
  },
  ranked(r, old) {
    if (!exact(r, ['id', 'name', 'rating', 'wins', 'draws', 'losses', 'games'])) return 'shape';
    if (!str(r.id, 48, ID_RX) || !str(r.name, LIMITS.nameMax)) return 'text';
    if (!int(r.rating, 0, LIMITS.ratingMax) || !int(r.games, 1, 100000) || !int(r.wins, 0, 100000) || !int(r.draws, 0, 100000) || !int(r.losses, 0, 100000)) return 'range';
    if (r.wins + r.draws + r.losses !== r.games) return 'record mismatch';
    if (old) {
      if (r.games < old.games || r.games > old.games + 1) return 'games jump';
      if (Math.abs(r.rating - old.rating) > LIMITS.ratingStepMax) return 'rating jump';
      if (r.wins < old.wins || r.draws < old.draws || r.losses < old.losses) return 'record went down';
    } else if (Math.abs(r.rating - LIMITS.ratingStart) > LIMITS.ratingStepMax * r.games) return 'implausible start';
    return null;
  },
};
VALIDATE.dream_ranked = VALIDATE.ranked;
const TABLE_ID_LIMIT = { scorers: 30, leaderboard: 1, ranked: 1, dream_ranked: 1 };

/* ---- helpers -------------------------------------------------------------------- */
const buckets = new Map();
function limited(ip, write, now = Date.now()) {
  const k = ip + (write ? 'w' : 'r'), cap = write ? LIMITS.rpmWrite : LIMITS.rpmRead;
  let b = buckets.get(k);
  if (!b || now > b.reset) { b = { n: 0, reset: now + 60000 }; buckets.set(k, b); if (buckets.size > 5000) buckets.clear(); }
  return ++b.n > cap;
}
function corsHeaders(origin) {
  return { 'access-control-allow-origin': origin, 'vary': 'origin', 'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,apikey,authorization,x-client-info,prefer', 'access-control-max-age': '600' };
}
const json = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(origin ? corsHeaders(origin) : {}) } });
const sbHeaders = env => {
  const h = { apikey: env.SUPABASE_KEY };
  if (env.SUPABASE_KEY.startsWith('eyJ')) h.authorization = 'Bearer ' + env.SUPABASE_KEY;
  return h;
};

export { VALIDATE, GET_ALLOW, limited, LIMITS };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';

    if (req.method === 'OPTIONS') return originOk ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403 });
    if (!originOk) return json(403, { error: 'origin not allowed' });

    /* realtime WebSocket pass-through (matchmaking + live matches) */
    if (req.headers.get('upgrade') === 'websocket') {
      if (!url.pathname.startsWith('/realtime/v1/')) return json(404, { error: 'not found' }, origin);
      if (limited(ip, false)) return json(429, { error: 'slow down' }, origin);
      const t = new URL(env.SUPABASE_URL);
      t.pathname = url.pathname;
      const q = new URLSearchParams(url.search);
      q.set('apikey', env.SUPABASE_KEY);
      t.search = q.toString();
      return fetch(new Request(t.toString(), req));
    }

    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !(m[1] in VALIDATE)) return json(404, { error: 'not found' }, origin);
    const table = m[1];
    const q = url.search.replace(/^\?/, '');

    if (req.method === 'GET') {
      if (!GET_ALLOW[table].has(decodeURIComponent(q))) return json(400, { error: 'query not allowed' }, origin);
      if (limited(ip, false)) return json(429, { error: 'slow down' }, origin);
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${q}`, { headers: sbHeaders(env) });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', ...corsHeaders(origin) } });
    }

    if (req.method === 'POST') {
      if (q !== 'on_conflict=id') return json(400, { error: 'query not allowed' }, origin);
      if (limited(ip, true)) return json(429, { error: 'slow down' }, origin);
      const raw = await req.text();
      if (raw.length > 8000) return json(413, { error: 'too large' }, origin);
      let body; try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad json' }, origin); }
      const rows = Array.isArray(body) ? body : [body];
      if (!rows.length || rows.length > TABLE_ID_LIMIT[table]) return json(400, { error: 'row count' }, origin);

      for (const r of rows) {
        let old = null;
        if ((table === 'ranked' || table === 'dream_ranked' || table === 'leaderboard') && r && typeof r.id === 'string' && ID_RX.test(r.id)) {
          const cols = table === 'leaderboard' ? 'score,wins,seasons' : 'rating,games,wins,draws,losses';
          const g = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=${cols}&id=eq.${encodeURIComponent(r.id)}&limit=1`, { headers: sbHeaders(env) });
          if (g.ok) { const a = await g.json(); old = a[0] || null; }
        }
        const err = VALIDATE[table](r, old);
        if (err) return json(422, { error: 'rejected: ' + err }, origin);
      }
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: { ...sbHeaders(env), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(Array.isArray(body) ? rows : rows[0]),
      });
      return new Response(null, { status: r.ok ? 204 : r.status, headers: corsHeaders(origin) });
    }
    return json(405, { error: 'method not allowed' }, origin);
  },
};
