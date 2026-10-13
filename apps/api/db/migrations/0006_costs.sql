CREATE TABLE "costs" (
	"day" date NOT NULL,
	"source" text NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "costs_day_source_pk" PRIMARY KEY("day","source")
);
--> statement-breakpoint
-- History: Jev spend already logged per day, and the one-time catalog build (467,725 chunks of
-- ~690 characters embedded with text-embedding-3-small: ~81M tokens at $0.02 per million).
INSERT INTO "costs" ("day", "source", "usd") SELECT "day", 'jev', "cost" FROM "usage" WHERE "cost" > 0 ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "costs" ("day", "source", "usd") VALUES ('2026-10-11', 'catalog', 1.61) ON CONFLICT DO NOTHING;
