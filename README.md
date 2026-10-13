# FilmHunch

Describe a movie any way you like ("psychological thriller with a sad ending", "sci-fi with no
spaceships", "a heist where nobody gets caught") and get films that match your exact sentence,
ranked by Jev.

## How a search works

1. **Well-known films:** Jev reads a short card (genres, keywords, the gist, how it ends) for every
   one of the 5,000 most-rated films, 16 per call, so the films people expect can't be missed.
2. **The rest of the catalog:** vector search over embedded film text plus
   keyword search over keywords, director and cast pick 300 more films, scored the same way. This
   runs alongside step 1.
3. **Full profiles:** Jev re-scores the top 40 on full profiles (plot up to ~800 words).
4. Scores stream to the page as they land; near-ties are broken by a small popularity bonus.

About 3 s and $0.05 per search; finished searches are cached for 72 hours. On 23 test queries this
gave 8.5 good matches per 10 (graded by an independent model), up from about 7.7 with retrieval
alone, and far more of the films people actually expect.

Why read 5,000 cards instead of a short retrieved list: with 200k films, retrieval alone missed the
obvious answers to vibe requests (no Arrival or Solaris for "like Inception but slower", obscure
titles containing "Sunday" for "a rainy Sunday"). Jev reading every well-known film fixed that.

## The catalog

`scripts/backfill.mjs` builds it once (`npm run seed` or `seed:full`, see
[Self-hosting](#self-hosting)); `scripts/sync.mjs` keeps it current daily.

- **Candidates:** every film with an English Wikipedia article (one Wikidata query) plus every film
  with 5+ TMDB votes (TMDB discover, split into date windows under TMDB's 10,000-result cap). A small
  catalog (`--min-votes=100`) takes only films with 100+ votes, and its sync keeps to that line.
- **Kept** (`lib/rules.js`): released, at least 40 minutes long, has a description, and is notable:
  an English Wikipedia article, 20+ TMDB votes, or 5+ votes with an IMDb id and a poster. Films that
  aren't notable yet stay as candidates and are re-checked weekly.
- **Text:** TMDB details plus the Wikipedia plot section, fetched as wikitext 50 articles per request
  and converted to plain text (`lib/wikitext.js`).
- **Daily sync:** TMDB's changes feed, new ids from the daily export, films that left TMDB, candidates
  due for a re-check, and Wikipedia articles whose revision changed. Only films whose text changed are
  re-embedded. Every run is recorded in `sync_runs`.

## Layout

Two independent apps, each with its own `package.json`, build and deploy:

- `apps/api`: the Hono API (`server/`), search and data pipeline (`lib/`), Drizzle schema and
  migrations (`db/`), backfill and daily sync (`scripts/`), and the quality eval (`eval/`).
- `apps/web`: the React app (Vite). It calls the API at `VITE_API_URL` (empty in development, where
  Vite forwards `/api` to the local API).

## Self-hosting

You need Node 24, Docker, three API keys and an email address:
[TMDB](https://www.themoviedb.org/settings/api) (free), [OpenAI](https://platform.openai.com/api-keys)
(embeddings, under $2 for the full catalog), TypeSafe (Jev, which ranks films: about $0.045 per
search, capped at `DAILY_BUDGET_USD`, $5 a day by default), and a contact address Wikipedia asks bulk
clients for.

```sh
npm run setup                               # installs the root, api and web packages
npm run db                                  # Postgres 17 + pgvector in Docker, on port 5433
cp apps/api/.env.example apps/api/.env      # then fill in the empty values under Required
npm run seed                                # builds the catalog (see below); run it once
npm run dev                                 # API on :3000, web on http://localhost:5173
```

`apps/api/.env.example` lists every setting, what each key is for and where to get it.

### Building the catalog

`npm run seed` builds a catalog of the ~23,000 films with 100+ TMDB votes. `npm run seed:full`
builds the full ~205,000. Both run migrations first, then three phases, and both can be stopped and
re-run: each phase picks up where it stopped.

| Phase | What it does | Small seed | Full seed |
| --- | --- | --- | --- |
| seed | Lists films from TMDB and Wikidata | under 1 min | ~4 min |
| ingest | Fetches TMDB details and Wikipedia plots, applies the rules, writes film text | ~12 min | ~2 h |
| embed | Embeds the text with OpenAI, then builds the vector index | ~24 min | ~2 h (estimated) |
| **Total** | | **~37 min** | **~4 h** |
| OpenAI cost | | ~$0.35 | ~$1.60 |

Times are from real runs; the full embed is extrapolated from the small one. Ingest is limited by
TMDB and Wikipedia, embedding by `OPENAI_EMBED_TPM` (900,000 tokens a minute by default, under
OpenAI's lowest tier). If your OpenAI account allows more, raising it makes embedding faster. The
database ends up at about 480 MB (small) or 2.3 GB (full).

To grow a small catalog to the full one later, run `npm run seed:full`: films already fetched are
kept.

### Keeping it current

`npm run sync` (in `apps/api`) updates the catalog from TMDB and Wikipedia and embeds whatever
changed. Run it daily, e.g. from cron after 10:00 UTC, when TMDB publishes its daily export. On a
small catalog it only updates the films it has and adds new releases once they pass 100 votes;
older films it left out arrive only through `npm run seed:full`. A daily run on a small catalog takes
about 2 minutes: it re-checked ~1,100 films and re-embedded only the few whose text had changed.

### Other commands

In `apps/api`: `npm run search -- "the villain wins"` (one search in the terminal),
`npm run eval` (graded quality on the test queries, ~$2.50). Schema changes: edit `db/schema.js`,
then `npm run db:generate` and `npm run db:migrate`.

## Putting it online

- **API:** `npm start` in `apps/api` runs migrations, then the server (health check `/health`). Set
  `WEB_ORIGIN` to the web app's address so the browser may call it.
- **Web:** `npm run build` in `apps/web` makes a static site in `dist/`. Set `VITE_API_URL` (the API's
  address) and `VITE_SITE_URL` (the site's own address, for link previews) at build time.
- **Sync:** run `npm run sync` in `apps/api` daily.

If your database suspends when idle, as serverless Postgres does, the first searches after a quiet
spell are slow. The API reloads the search indexes into the database's cache (`lib/warm.js`,
`pg_prewarm`) on startup and when traffic resumes after an idle gap; it never wakes the database on
its own. The page asks for `/api/status` as it opens, so warming starts while the visitor types.

## Protection

`apps/api/lib/guard.js`:

- **Visitor IP:** the address your proxy reports (`X-Real-IP`, or the last `X-Forwarded-For` hop).
  Behind Cloudflare, `CF-Connecting-IP` is used instead, trusted only from Cloudflare's addresses.
- **Rate limits per IP**, kept in memory, or shared across instances through Upstash Redis when
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set: fresh searches 12 per 10 minutes
  and 60 a day, any search 60 a minute, other endpoints 240 a minute.
- **Searches in flight:** one per visitor, 12 for the site.
- **Sitewide pause:** when Jev or OpenAI reports it's out of credit (or rejects the key), new
  searches stop for 15 minutes, then retry; `DAILY_BUDGET_USD` does the same until tomorrow.
  `/api/status` drives the banner on the site; cached searches keep working.

Every limit can be changed in `.env` (see `.env.example`).

## Running costs

The footer shows what the site has cost to run (`/api/costs`), from a daily ledger in the `costs`
table: Jev per search, OpenAI per embedding call (from OpenAI's reported token counts), and hosting
from `HOSTING_USD_PER_MONTH` if you set it. Jev spend from evals and the terminal search script isn't
included.

## Evaluation

`npm run eval` runs the 50 queries in `eval/queries.json` and has an independent model
(`gpt-5.4-mini`) grade each top 10 from the films' full profiles: 2 = good match, 1 = partial,
0 = not a match. Grades are cached in `eval/judgments.json`, so reruns only pay for new films. To
compare option changes: `VARIANTS='[{"pool":3000},{"tail":0}]' npm run eval`.

## Attribution

Film data from [TMDB](https://www.themoviedb.org/) (this product uses the TMDB API but is not
endorsed or certified by TMDB). Plot text from Wikipedia, available under CC BY-SA 4.0.

## License

MIT, see [LICENSE](LICENSE).
