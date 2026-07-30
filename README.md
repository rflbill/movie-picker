# What should I watch tonight? 🎬

A movie-night decision tool: set the mood, hit the button — movie night solved!

**Live:** deployed on Vercel from this repo (auto-deploys on every push to `main`).

## What it does

- **Our lists** — roll a random pick from a Letterboxd watchlist, an uploaded CSV export, or a pasted list. Merge several people's lists for group nights ("on any list" / "on every list").
- **Whole database** — roll across ~1M films via TMDB, with vibe/genre/decade/rating/runtime filters, text search, and a streaming-only filter.
- Every pick shows poster, synopsis, director, streaming availability by country (JustWatch data via TMDB), and scores from Letterboxd/TMDB/IMDb/Metacritic plus a blended 0–100 rating (Rotten Tomatoes is displayed but kept out of the blend — it's an approval meter, not a rating).

## Stack

Single static `index.html` — no build step, no framework. TMDB + OMDb APIs called client-side.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
Streaming availability data powered by JustWatch.
Ratings via OMDb API.
