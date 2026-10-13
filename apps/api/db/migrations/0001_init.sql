CREATE TABLE "chunks" (
	"film_id" integer NOT NULL,
	"n" smallint NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(512),
	CONSTRAINT "chunks_film_id_n_pk" PRIMARY KEY("film_id","n")
);
--> statement-breakpoint
CREATE TABLE "films" (
	"id" integer PRIMARY KEY NOT NULL,
	"imdb_id" text,
	"wikidata_id" text,
	"wiki_title" text,
	"title" text NOT NULL,
	"original_title" text,
	"year" integer,
	"release_date" date,
	"runtime" integer,
	"language" text,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"director" text[] DEFAULT '{}' NOT NULL,
	"cast_names" text[] DEFAULT '{}' NOT NULL,
	"overview" text,
	"tagline" text,
	"plot" text,
	"poster" text,
	"votes" integer DEFAULT 0 NOT NULL,
	"rating" real,
	"popularity" real,
	"has_plot" boolean DEFAULT false NOT NULL,
	"wiki_revid" bigint,
	"card" text,
	"profile" text,
	"text_hash" text,
	"status" text DEFAULT 'candidate' NOT NULL,
	"reject_reason" text,
	"tmdb_fetched_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', join_text(keywords) || ' ' || join_text(director) || ' ' || join_text(cast_names)), 'B') ||
          setweight(to_tsvector('english', coalesce(profile, '')), 'C')) STORED
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_film_id_films_id_fk" FOREIGN KEY ("film_id") REFERENCES "public"."films"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_pending_idx" ON "chunks" USING btree ("film_id") WHERE "chunks"."embedding" is null;--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "films_status_idx" ON "films" USING btree ("status");--> statement-breakpoint
CREATE INDEX "films_search_idx" ON "films" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "films_wikidata_idx" ON "films" USING btree ("wikidata_id");--> statement-breakpoint
CREATE INDEX "films_checked_idx" ON "films" USING btree ("status","checked_at");