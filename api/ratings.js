// /api/ratings — Supabase-cached film scores (TMDB + OMDb), so each film costs
// one OMDb call EVER instead of one per visitor.
//
// POST { films: [{ t: "Title", y: 1999 }, ...] }  (max 60)
// →   { rows: { "<norm(title)>|<year>": { imdb, tmdb, meta, rt, imdb_id, tmdb_id } }, pending: <int> }
//
// Cached rows return instantly; up to MISS_BUDGET unknown films are resolved per
// call (TMDB search → details → OMDb → upsert). The client re-POSTs while
// pending > 0 until the cache is warm.
//
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SECRET_KEY, OMDB_KEY, (optional) TMDB_KEY

const MISS_BUDGET = 20;

function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}
const keyOf = (t, y) => norm(t) + "|" + (y || "?");
const num = x => { const v = parseFloat(x); return isNaN(v) ? null : v; };

async function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1" + path;
  const r = await fetch(url, {
    ...opts,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error("supabase " + r.status + " " + (await r.text()).slice(0, 200));
  return r.status === 204 ? null : r.json();
}

async function resolveFilm(t, y) {
  const TMDB = process.env.TMDB_KEY || "678e7af359eb1c530cf8a0d81d8dfd8a";
  const row = { key: keyOf(t, y), title: t, year: y || null, tmdb_id: null, imdb_id: null, tmdb: null, imdb: null, meta: null, rt: null };
  try {
    const su = new URL("https://api.themoviedb.org/3/search/movie");
    su.searchParams.set("api_key", TMDB);
    su.searchParams.set("query", t);
    if (y) su.searchParams.set("year", y);
    su.searchParams.set("include_adult", "false");
    let sr = await (await fetch(su)).json();
    if ((!sr.results || !sr.results.length) && y) { su.searchParams.delete("year"); sr = await (await fetch(su)).json(); }
    const m = sr.results && sr.results[0];
    if (!m) return row; // unknown film: cache the nulls so we never retry it
    row.tmdb_id = m.id;
    row.tmdb = m.vote_average || null;
    const det = await (await fetch(`https://api.themoviedb.org/3/movie/${m.id}?api_key=${TMDB}`)).json();
    row.imdb_id = det.imdb_id || null;
    if (row.imdb_id && process.env.OMDB_KEY) {
      const o = await (await fetch(`https://www.omdbapi.com/?i=${row.imdb_id}&apikey=${process.env.OMDB_KEY}`)).json();
      if (o && o.Response === "True") {
        row.imdb = num(o.imdbRating);
        row.meta = num(o.Metascore);
        const rt = (o.Ratings || []).find(r => r.Source === "Rotten Tomatoes");
        row.rt = rt ? num(rt.Value) : null;
      }
    }
  } catch (e) { /* partial row is still worth caching */ }
  return row;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    return res.status(503).json({ error: "ratings cache not configured yet" });

  let films = (req.body && req.body.films) || [];
  if (!Array.isArray(films)) return res.status(400).json({ error: "films must be an array" });
  films = films.filter(f => f && typeof f.t === "string" && f.t.trim()).slice(0, 60)
    .map(f => ({ t: f.t.trim().slice(0, 300), y: f.y ? parseInt(f.y) : null }));
  if (!films.length) return res.status(200).json({ rows: {}, pending: 0 });

  const keys = [...new Set(films.map(f => keyOf(f.t, f.y)))];
  const inList = "(" + keys.map(k => '"' + k.replace(/"/g, "") + '"').join(",") + ")";
  const cached = await sbFetch("/ratings?select=*&key=in." + encodeURIComponent(inList));
  const rows = {};
  cached.forEach(r => { rows[r.key] = r; });

  const misses = films.filter(f => !rows[keyOf(f.t, f.y)]);
  const todo = misses.slice(0, MISS_BUDGET);
  const resolved = [];
  for (const f of todo) {
    const row = await resolveFilm(f.t, f.y);
    rows[row.key] = row;
    resolved.push(row);
  }
  if (resolved.length) {
    await sbFetch("/ratings?on_conflict=key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(resolved),
    });
  }
  res.status(200).json({ rows, pending: misses.length - todo.length });
};
