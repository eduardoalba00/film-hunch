// Drizzle schema, for Postgres with the pgvector extension.
// Migrations are generated into db/migrations with `npm run db:generate`.

import { sql } from "drizzle-orm";
import {
  pgTable, integer, text, date, real, boolean, bigint, bigserial, smallint, timestamp, jsonb, halfvec, index,
  primaryKey, customType, doublePrecision,
} from "drizzle-orm/pg-core";

const tsvector = customType({ dataType: () => "tsvector" });

// Every TMDB movie we have looked at. Only status = 'indexed' rows are searchable.
export const films = pgTable(
  "films",
  {
    id: integer("id").primaryKey(), // TMDB id
    imdbId: text("imdb_id"),
    wikidataId: text("wikidata_id"),
    wikiTitle: text("wiki_title"),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    year: integer("year"),
    releaseDate: date("release_date"),
    runtime: integer("runtime"),
    language: text("language"),
    countries: text("countries").array().notNull().default(sql`'{}'`),
    genres: text("genres").array().notNull().default(sql`'{}'`),
    keywords: text("keywords").array().notNull().default(sql`'{}'`),
    director: text("director").array().notNull().default(sql`'{}'`),
    castNames: text("cast_names").array().notNull().default(sql`'{}'`),
    overview: text("overview"),
    tagline: text("tagline"),
    poster: text("poster"),
    backdrop: text("backdrop"), // TMDB backdrop image path (wide still), for the top-match spotlight
    votes: integer("votes").notNull().default(0),
    rating: real("rating"),
    popularity: real("popularity"),
    hasPlot: boolean("has_plot").notNull().default(false),
    wikiRevid: bigint("wiki_revid", { mode: "number" }), // Wikipedia revision the plot came from
    card: text("card"), // stage-1 text (~150 tokens)
    profile: text("profile"), // stage-2 text (~1,100 tokens)
    textHash: text("text_hash"), // hash of card + profile; chunks are rebuilt when it changes
    status: text("status").notNull().default("candidate"), // candidate | indexed | rejected
    rejectReason: text("reject_reason"),
    tmdbFetchedAt: timestamp("tmdb_fetched_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }), // last time the keep/reject rules ran
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // join_text is an IMMUTABLE wrapper around array_to_string, created in the first migration.
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', join_text(keywords) || ' ' || join_text(director) || ' ' || join_text(cast_names)), 'B') ||
          setweight(to_tsvector('english', coalesce(profile, '')), 'C')`,
    ),
  },
  (t) => [
    index("films_status_idx").on(t.status),
    index("films_search_idx").using("gin", t.searchTsv),
    index("films_wikidata_idx").on(t.wikidataId),
    index("films_checked_idx").on(t.status, t.checkedAt),
  ],
);

// Embedded pieces of each indexed film (its card plus plot chunks).
export const chunks = pgTable(
  "chunks",
  {
    filmId: integer("film_id").notNull().references(() => films.id, { onDelete: "cascade" }),
    n: smallint("n").notNull(),
    kind: text("kind").notNull(), // card | plot
    text: text("text"), // only kept until embedded; cleared afterwards to save space
    embedding: halfvec("embedding", { dimensions: 512 }), // half precision: same candidates, half the size; null until embedded
  },
  (t) => [
    primaryKey({ columns: [t.filmId, t.n] }),
    index("chunks_pending_idx").on(t.filmId).where(sql`${t.embedding} is null`),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("halfvec_cosine_ops")),
  ],
);

// One row per pipeline run, for monitoring the backfill and the daily sync.
export const syncRuns = pgTable("sync_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  job: text("job").notNull(), // backfill | daily
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  stats: jsonb("stats").notNull().default({}),
});

// Finished searches, so repeated queries are answered without calling Jev.
export const searchCache = pgTable("search_cache", {
  query: text("query").primaryKey(), // normalised query text
  results: jsonb("results").notNull(), // [{ id, s1, s2 }] best first
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  hits: integer("hits").notNull().default(0),
});

// Jev spend per day, for the daily budget cap.
export const usage = pgTable("usage", {
  day: date("day").primaryKey(),
  searches: integer("searches").notNull().default(0),
  cached: integer("cached").notNull().default(0),
  cost: real("cost").notNull().default(0),
});

// What running FilmHunch costs, per day and source: "jev" (search ranking), "openai" (embeddings),
// "catalog" (one-time builds). Shown on the site; hosting is added from HOSTING_USD_PER_MONTH.
export const costs = pgTable(
  "costs",
  {
    day: date("day").notNull(),
    source: text("source").notNull(),
    usd: doublePrecision("usd").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.source] })],
);

export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
